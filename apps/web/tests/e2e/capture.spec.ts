import { expect, test, type Page, type TestInfo } from "@playwright/test";

const backendURL = process.env.VITE_INFERENCE_URL!;
const deploymentId = process.env.HANDWAVE_DEPLOYMENT_ID!;

test.afterEach(async ({ page }, testInfo) => {
  // Save the last visible state before unloading the real MediaPipe workers.
  await screenshot(page, testInfo, "final-state");
  await page.goto("about:blank");
});

test("camera reaches the real backend, runs both detectors, and restarts cleanly", async ({
  page,
  request,
}, testInfo) => {
  const evidence = observeSession(page);
  try {
    const health = await request.get(`${backendURL}/v1/health`);
    expect(health.ok()).toBe(true);
    evidence.health = await health.json();
    expect(evidence.health).toEqual({ ok: true, deployment_id: deploymentId });

    const warmup = page.waitForResponse(
      (response) =>
        response.url() === `${backendURL}/v1/predict` &&
        response.request().method() === "POST",
    );
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Hand Wave" }),
    ).toBeAttached();
    await page
      .getByRole("button", { name: "Start camera", exact: true })
      .click();
    await expectCameraReady(page, evidence, 1);
    expect((await warmup).ok()).toBe(true);
    await page
      .getByRole("button", { name: "Show dev panel", exact: true })
      .click();
    for (const label of ["Hand FPS", "Pose FPS"]) {
      await expect
        .poll(
          async () => {
            const value = await page
              .getByText(label, { exact: true })
              .locator("..")
              .innerText();
            return Number(value.replace(label, "").trim());
          },
          {
            message: `${label} must show real worker inference`,
            timeout: 60_000,
          },
        )
        .toBeGreaterThan(0);
    }
    await screenshot(page, testInfo, "camera-ready");

    const tracks = await page
      .getByLabel("Camera preview")
      .evaluateHandle((video) =>
        ((video as HTMLVideoElement).srcObject as MediaStream).getTracks(),
      );
    await page
      .getByRole("button", { name: "Stop sharing", exact: true })
      .click();
    await expect(
      page.getByText("No active stream", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        tracks.evaluate((items) =>
          items.every((track) => track.readyState === "ended"),
        ),
      )
      .toBe(true);
    await tracks.dispose();
    await expect.poll(() => evidence.closedSockets).toBe(1);

    await page
      .getByRole("button", { name: "Start camera", exact: true })
      .click();
    await expectCameraReady(page, evidence, 2);
    await page
      .getByRole("button", { name: "Stop sharing", exact: true })
      .click();
    await expect(
      page.getByText("No active stream", { exact: true }),
    ).toBeVisible();
    expect(evidence.errors).toEqual([]);
  } finally {
    await testInfo.attach("session-evidence", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
  }
});

test("camera permission denial gives an error and can be retried", async ({
  page,
  context,
}, testInfo) => {
  const evidence = observeSession(page);
  try {
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    await cdp.send("Browser.setPermission", {
      browserContextId: targetInfo.browserContextId,
      permission: { name: "camera" },
      setting: "denied",
      origin: "http://localhost:3000",
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Start camera", exact: true })
      .click();
    await expect(
      page.getByText("Camera access was denied.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Camera preview")).toHaveCount(0);
    await screenshot(page, testInfo, "camera-denied");

    await cdp.send("Browser.setPermission", {
      browserContextId: targetInfo.browserContextId,
      permission: { name: "camera" },
      setting: "granted",
      origin: "http://localhost:3000",
    });
    await page
      .getByRole("button", { name: "Start camera", exact: true })
      .click();
    await expectCameraReady(page, evidence, 1);
    await page
      .getByRole("button", { name: "Stop sharing", exact: true })
      .click();
    await expect(
      page.getByText("No active stream", { exact: true }),
    ).toBeVisible();
    expect(evidence.errors).toEqual([]);
  } finally {
    await testInfo.attach("session-evidence", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
  }
});

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

function observeSession(page: Page) {
  const evidence = {
    backendURL,
    deploymentId,
    health: null as unknown,
    errors: [] as string[],
    sockets: [] as string[],
    replies: [] as unknown[],
    handshakes: 0,
    closedSockets: 0,
  };
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // Vercel injects analytics only on its hosted service. The trace keeps this
    // expected local 404; fail on all application errors.
    if (
      message.location().url ===
      "http://localhost:3000/_vercel/insights/script.js"
    )
      return;
    if (
      message.text() ===
      "INFO: Created TensorFlow Lite XNNPACK delegate for CPU."
    )
      return;
    evidence.errors.push(message.text());
  });
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/v1/stream") return;
    evidence.sockets.push(socket.url());
    socket.on("framereceived", ({ payload }) => {
      const reply = JSON.parse(payload.toString());
      evidence.replies.push(reply);
      if (reply.type === "pong" && reply.protocol === 1)
        evidence.handshakes += 1;
    });
    socket.on("close", () => {
      evidence.closedSockets += 1;
    });
  });
  return evidence;
}

async function expectCameraReady(
  page: Page,
  evidence: ReturnType<typeof observeSession>,
  handshakes: number,
) {
  await expect(page.getByLabel("Camera preview")).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByLabel("Camera preview")
        .evaluate((video) => (video as HTMLVideoElement).videoWidth),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() => evidence.handshakes, { timeout: 120_000 })
    .toBe(handshakes);
  const streamURL = new URL("/v1/stream", backendURL);
  streamURL.protocol = streamURL.protocol === "https:" ? "wss:" : "ws:";
  expect(evidence.sockets.filter((url) => url === streamURL.href)).toHaveLength(
    handshakes,
  );
  await expect(
    page.getByText("Starting recognition…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Still connecting…", { exact: true }),
  ).toHaveCount(0);
}

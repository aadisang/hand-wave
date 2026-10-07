import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const { VITE_INFERENCE_URL: backendURL, HANDWAVE_DEPLOYMENT_ID: deploymentId } =
  process.env;
if (!backendURL || !deploymentId) {
  throw new Error(
    "Run browser E2E through pnpm test, which sets VITE_INFERENCE_URL and HANDWAVE_DEPLOYMENT_ID.",
  );
}

const artifactRoot = process.env.HANDWAVE_E2E_OUTPUT ?? ".";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  outputDir: resolve(artifactRoot, "test-results"),
  metadata: {
    backend: backendURL,
    deploymentId,
    camera: "Chromium synthetic video; no sign-accuracy claim",
  },
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: resolve(artifactRoot, "playwright-report"),
      },
    ],
    [
      "json",
      { outputFile: resolve(artifactRoot, "playwright-report/results.json") },
    ],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3000",
    permissions: ["camera"],
    channel: "chromium",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
    trace: "on",
    screenshot: "off",
    video: "on",
  },
  webServer: {
    command: "pnpm exec vite build && node .output/server/index.mjs",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 90_000,
    env: { VITE_INFERENCE_URL: backendURL, PORT: "3000" },
  },
});

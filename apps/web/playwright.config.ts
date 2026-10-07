import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const backend = process.env.VITE_INFERENCE_URL
  ? {
      url: process.env.VITE_INFERENCE_URL,
      deployment_id: process.env.HANDWAVE_DEPLOYMENT_ID,
    }
  : JSON.parse(
      readFileSync(
        new URL("../../.handwave/development.json", import.meta.url),
        "utf8",
      ),
    );
if (!backend.url || !backend.deployment_id) {
  throw new Error(
    "Start pnpm dev:mobile, or set VITE_INFERENCE_URL and HANDWAVE_DEPLOYMENT_ID.",
  );
}
process.env.VITE_INFERENCE_URL = backend.url;
process.env.HANDWAVE_DEPLOYMENT_ID = backend.deployment_id;

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
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    workingTree: execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }),
    backend: backend.url,
    deploymentId: backend.deployment_id,
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
    env: { VITE_INFERENCE_URL: backend.url, PORT: "3000" },
  },
});

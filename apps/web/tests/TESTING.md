# Web test scope

Written before this test cleanup. No product code changes are part of the cleanup.

## Failures that matter

| Failure                                                                                                                                | Evidence that can detect it                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The page cannot start a camera, load real MediaPipe workers, or connect to the configured backend.                                     | Browser E2E starts capture, requires decoded video frames and both worker FPS values, and waits for the real backend handshake. |
| Stop leaves capture running, or a second session cannot connect.                                                                       | Browser E2E stops and restarts through the visible controls and checks the old video tracks have ended.                         |
| Camera denial leaves a stuck spinner or prevents retry.                                                                                | Browser E2E denies the browser permission, checks the error, grants permission, and retries.                                    |
| A late failure closes a newer connection.                                                                                              | Retain the existing isolated socket race test. A normal successful browser session does not force this event order.             |
| A full-window resend appends duplicate frames on the server.                                                                           | Retain the existing cursor-resync test. The synthetic camera has no hands and cannot fill the recognition window.               |
| A sign made during warmup is lost, a result vanishes when hands leave, or a short hold prematurely ends a sign.                        | Retain those existing stream tests. They control asynchronous ordering that the available camera input cannot reproduce.        |
| Different camera frame rates change model time, or a stalled camera appends old frames.                                                | Retain the existing frame-rate equivalence and stalled-frame tests. No rate-controlled sign video fixture exists.               |
| Left-handed input is mirrored incorrectly, invalid pose anchors reach the model, or the active hand changes in the middle of a phrase. | Retain the existing model-input and active-hand regression tests. The synthetic video cannot check these failures.              |
| An old pose remains attached to a new hand after a detector gap.                                                                       | Retain the existing stale-pose expiry test. The current E2E input has no person.                                                |

A dropped transport can also fail to reconnect while capture stays active. Keep
the existing transport reconnect regression: stopping and restarting from the UI
does not reproduce this network event. A live Chromium check with
`context.setOffline(true)` left the existing WebSocket open after three seconds,
so that control does not replace the isolated fault test.

## Removed checks

Remove arithmetic/configuration checks, basic getters/resets, diagnostic FPS tests,
mocked WASM factory tests, and connection lifecycle checks covered by the browser
journeys. A fake MediaPipe constructor cannot prove the shipped worker loads.
Deleted 26 of the 39 checks. No new isolated tests are added. Vitest remains
only for the 13 listed exceptions.

## Repeatable browser evidence

Run `pnpm dev:mobile` from the repository root to start an isolated backend. In
another terminal, run `pnpm --filter @hand-wave/web test:e2e`. The runner reads
`.handwave/development.json`; CI can instead set `VITE_INFERENCE_URL` and
`HANDWAVE_DEPLOYMENT_ID`. It builds and starts the production app on port 3000
and refuses to reuse an unknown server. Install Chromium once with
`pnpm --filter @hand-wave/web exec playwright install chromium`.

Every run writes `playwright-report/index.html`, `playwright-report/results.json`,
and per-test traces, screenshots, console errors, and endpoint evidence in
`test-results/`. Open the report with `pnpm --filter @hand-wave/web exec playwright
show-report`. Set `HANDWAVE_E2E_OUTPUT` to put both folders under one run directory.
Upload both folders even when tests fail.

The browser uses Chromium's synthetic camera, SwiftShader software graphics, real
MediaPipe assets, and the real inference service. No application module or API response is mocked. These tests
prove startup and capture lifecycle; they do **not** prove sign-recognition
accuracy. A licensed, labeled sign-video fixture is required before removing the
remaining signal-processing and timing exceptions. Physical camera, screen-share
picker, Safari, and mobile browser behavior still require separate device checks.

## CI worker-startup failure (2026-10-07)

The a86e945 CI artifact shows a working camera and backend handshake. Both
MediaPipe loaders, WASM binaries, and model downloads return 200 and finish in
less than four seconds. The video continues to present frames, but Hand FPS,
Pose FPS, and the app's Presented FPS remain zero for 60 seconds. The app starts
its frame callback only after both worker `warm()` calls return. No worker-ready
or model initialization message appears in the captured console.

Do not treat this as a slow network or raise the assertion timeout. Record the
browser's native GPU information, worker lifecycle, and worker resource timings
on the next run to distinguish failed graphics initialization from a blocked
worker. These are observations of the shipped workers; no worker, model, or API
response is replaced. Keep the real detector-output assertion unchanged.

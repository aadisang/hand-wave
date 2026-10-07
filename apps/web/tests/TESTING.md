# Web test scope

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

Vitest runs only these listed exceptions; a fake MediaPipe constructor cannot
prove the shipped worker loads, so worker startup stays in browser E2E.

## Browser evidence

Run browser E2E through `pnpm test`; it supplies the backend URL and deployment
ID. Commands and evidence verification are in
[the shared testing guide](../../../tests/README.md). Playwright builds and starts
the production app on port 3000 and refuses to reuse an unknown server. Each run
keeps the HTML and JSON reports, per-test traces with console output, video,
screenshots, and endpoint/session evidence, including when tests fail.

The browser uses Chromium's synthetic camera, SwiftShader software graphics, real
MediaPipe assets, and the real inference service. No application module or API response is mocked. These tests
prove startup and capture lifecycle; they do **not** prove sign-recognition
accuracy. A licensed, labeled sign-video fixture is required before removing the
remaining signal-processing and timing exceptions. Physical camera, screen-share
picker, Safari, and mobile browser behavior still require separate device checks.

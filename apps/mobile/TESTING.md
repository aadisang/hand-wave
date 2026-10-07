# Native verification

Write failure modes before test code. Prefer a complete product flow. Do not add
unit tests after implementation. Keep an isolated test only when it exposes a
specific serious failure that the end-to-end flow cannot reliably cause.

## Failure and coverage inventory

This inventory was written before changing the tests.

| User-visible failure | Verification |
| --- | --- |
| A built app uses a missing or wrong backend address. | The real `InferClient` reads the built app configuration, connects to the configured service (TLS normally; loopback HTTP in simulator E2E), and records backend identity. A missing address fails the live run. |
| The client repeats frames, loses a stream cursor, or carries a previous phrase into a new connection. | The real client sends overlapping windows, a window with a lost cursor, a final request, and a new connection. Check the real service's buffered frame counts and finalization trace. |
| Warmup, recognition, or reset hangs because a send or receive does not stop at its deadline. | All exchanges share the same deadline. Keep the existing isolated timeout test: it requires the timeout error to survive socket closure. A healthy remote service cannot reliably create a permanently blocked transport. The fixture deliberately models I/O that only ends when the socket closes. |
| An immediate connection error waits for the whole warmup deadline before reaching the user. | Keep the existing immediate-I/O-failure deadline test. The remote happy path does not force this race. |
| Opening a physical camera crashes because a nominal 60 FPS duration is slightly outside its hardware limits. | Keep the existing fractional-frame-duration regression. A simulator has no physical capture formats; a device run covers only that device's formats. |
| Camera capture, MediaPipe, hand selection, model recognition, displayed text, or speech is wrong. | Requires the physical-device flow below. Synthetic landmark requests do not cover these parts or prove recognition accuracy. This is an explicit coverage gap. |
| Glasses pairing, frame orientation, camera switching, or background/foreground recovery fails. | Requires the physical-device flow below. Simulator navigation is not evidence for this path. |

## Automated live client/service flow

This is a client/service integration flow, not a camera-to-speech E2E test. It uses
the real app configuration, Swift client, network, service, and deployed model.
Input landmarks are synthetic. The assertions verify protocol state, not words.
Run it through `pnpm test`; commands and evidence verification are in
[the shared testing guide](../../tests/README.md).

`scripts/test.sh live` refuses to start without `HANDWAVE_DEPLOYMENT_ID`, so a
stale or wrong service cannot pass. It requires the expected test count with
zero skipped tests. Its evidence directory holds `Tests.xcresult`,
`xcodebuild.log`, `summary.json`, exported attachments, and `run.json`, which
starts as `running` and changes only when the command completes. The result
bundle keeps a JSON attachment with the endpoint, backend deployment ID, input
frames, actual responses, and completed steps, including when a later step fails.
`scripts/test.sh isolated` runs only the three regression tests above; that
result must not be reported as a live pass. The Release workflow runs
`scripts/test.sh live Release` against the release backend. `E2E_INFERENCE_URL`
is an explicit build-only endpoint override; HTTP is accepted only for loopback
on a simulator.

Project generation uses local sources without a Tuist account. An explicit
`TUIST_TOKEN` opts into the existing Tuist cloud project.

## Physical-device E2E gate

Run the same commit and verified backend used by the release build. Record the
commit, app build, backend deployment ID, phone and glasses models, OS/firmware,
and each result in the run directory. Keep screen video and exported app logs.

1. Start with the backend stopped or cold. Open the phone camera. Verify that the
   warmup state ends within its deadline, then sign a known phrase with both hands.
   Record the expected phrase and the visible/spoken result. Synthetic landmarks
   are not an acceptable replacement for this step.
2. Stop and restart. Sign a different phrase. Verify no previous text is spoken.
3. Change front/back camera; verify handedness and overlay alignment in each.
4. Block network access during streaming. Verify an error appears and controls
   still work. Restore the network, restart, and recognize a new phrase.
5. Pair physical glasses through Meta AI. Repeat sign, stop, reconnect, and
   background/foreground cases. Verify orientation, text, and speech.

A release has not passed full native E2E until these artifacts exist and a human
can repeat the recorded steps. The automated client/service result alone does
not clear this gate.

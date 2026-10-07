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
| Warmup never exits because socket I/O does not stop at its deadline. | Keep the existing isolated timeout test. A healthy remote service cannot reliably create a permanently blocked transport. The fixture deliberately models I/O that only ends when the socket closes. |
| An immediate connection error waits for the whole warmup deadline before reaching the user. | Keep the existing immediate-I/O-failure deadline test. The remote happy path does not force this race. |
| Opening a physical camera crashes because a nominal 60 FPS duration is slightly outside its hardware limits. | Keep the existing fractional-frame-duration regression. A simulator has no physical capture formats; a device run covers only that device's formats. |
| Camera capture, MediaPipe, hand selection, model recognition, displayed text, or speech is wrong. | Requires the physical-device flow below. Synthetic landmark requests do not cover these parts or prove recognition accuracy. This is an explicit coverage gap. |
| Glasses pairing, frame orientation, camera switching, or background/foreground recovery fails. | Requires the physical-device flow below. Simulator navigation is not evidence for this path. |

## Removed tests

Remove helper arithmetic, enum/string mappings, URL/envelope encoding, synthetic
landmark transforms, model-file sizes, frame-stat subtraction, and mocked
`InferSession` assertions. They do not verify that the user can recognize signs.
Remove the deadline success case, the cancellation case that never checks its
claimed immediate-return behavior, and the ordinary camera-duration case: they
add no unique, reliable failure coverage. Do not describe removal as new E2E coverage. Vision and
session behavior still need the physical flow.

## Automated live client/service flow

This is a client/service integration flow, not a camera-to-speech E2E test. It uses
the real app configuration, Swift client, network, service, and deployed model.
Input landmarks are synthetic. The assertions verify protocol state, not words.

Keep `pnpm dev:mobile` running in a separate terminal, then run from the repo root:

```sh
moon run mobile:test
```

The runner writes a unique directory under `apps/mobile/Derived/Evidence/` with
`Tests.xcresult`, `xcodebuild.log`, `summary.json`, exported attachments, and
`run.json`. The runner requires the expected test count with zero skipped tests.
The manifest starts as `running` and changes only when the command completes. The result bundle keeps a JSON
attachment containing the endpoint, backend deployment ID, input frames, actual
responses, and completed steps, including when a later step fails. Open it with
`open apps/mobile/Derived/Evidence/<run>/Tests.xcresult`.

A live run fails when its endpoint is absent. CI can explicitly run only the three
isolated regression tests with `scripts/test.sh isolated`; that result must not
be reported as a live pass. `scripts/test.sh live Release` verifies the configured
Release build. Both modes save the same artifacts. Set `IOS_DESTINATION` to use a
specific simulator or connected device. `IOS_EVIDENCE_DIR` selects the output
directory. The root E2E runner uses `E2E_INFERENCE_URL` as an explicit build-only
override and `HANDWAVE_DEPLOYMENT_ID` to reject a stale service. HTTP is accepted
only for loopback on a simulator; normal app configuration remains unchanged.

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

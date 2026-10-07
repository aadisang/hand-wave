# Inference verification

## Failure inventory, written before the E2E runner

The service can fail to load its real checkpoint or language model, serve a
different build, reject the client's WebSocket protocol, lose frame deltas,
retain a previous segment after reset or finalize, share state between clients,
accept oversized batches, let its rolling window grow without a bound, or stop
accepting valid input after a bad request. A closed connection can also
prevent a later client from reconnecting. These are service boundary failures;
test them through a real process and the real model.

Record each request and response, failures, process logs, elapsed times, Git
revision and source hashes, and model hashes. A failed run must still write its
report and exit nonzero. A repeat run must use the same command and assets. A
synthetic landmark stream proves execution and protocol behavior, not sign
recognition accuracy. This repository has no labeled trace fixtures; there is no
recognition quality claim and no passing or skipped placeholder for that gap.

## Audit of the old tests

| File | Decision and reason |
| --- | --- |
| `test_development.py` | Delete. Mocked Modal lookup and URL/string checks do not prove a working deployment or client configuration. Live deployment verification and client E2E must check these boundaries. |
| `test_stream_protocol.py` | Delete. Its fake model hides model startup and inference failures. Move protocol cases to the real-service E2E. |
| `test_runtime.py` | Delete. Decoder construction is covered by real startup and inference; fake beam objects restate transformation code. |
| `test_recognition.py` | Delete. Hand-picked predictions test internal policy without showing that a signed phrase works. Labeled recordings are required for useful recognition regressions. |
| `test_text_normalizer.py` | Delete. Phrase lookup examples do not validate real recognition. Real service startup detects missing language model assets. |
| `test_trace_fixtures.py` | Delete. The fixture directory is empty, so this only produces a skip. |
| `test_model_queue.py` | Retain the existing cancellation race test. A cancelled await must not release the single native inference worker while that worker is still running. An HTTP/WS client cannot observe simultaneous runtime entry; fixed timing in a live-model test cannot prove this property. Controlled blocking is needed to expose it. |

The retained isolated test predates this cleanup. No new unit tests are added.
For any future isolated change, first document its complete failure modes, then
write the tests, then implement the code. Prefer E2E verification otherwise.

## Run and inspect

`pnpm exec moon run inference:e2e` starts a real local service and writes
`.handwave/e2e/backend/report.json`, `transcript.json`, and `server.log`.
The report includes hashes for its transcript and log, and for the local source,
checkpoint, and language model. The transcript contains the actual requests and
responses. The process exits nonzero on failure; a report with `status: failed`
is evidence of failure, never a passing test. Existing services can be checked
with `python -m tools.e2e --url URL --deployment-id ID --output DIRECTORY`.

An external service's returned deployment ID is checked, but the current API
does not attest its source or asset hashes. Local source hashes are explicitly
labeled as local. Native camera, MediaPipe, GPU scheduling, Modal routing, and
recognition accuracy each require separate evidence.

This audit found that the old launcher smoke request finalized an empty session.
It returned a valid result without executing inference. The launcher now sends
a normal recognition request and requires a real prediction and decode trace
before it tests finalization. The E2E runner applies the same evidence check.

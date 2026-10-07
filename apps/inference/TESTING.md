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

## Retained isolated regression

`test_model_queue.py` keeps the existing cancellation race test. A cancelled
await must not release the single native inference worker while that worker is
still running. An HTTP/WS client cannot observe simultaneous runtime entry;
fixed timing in a live-model test cannot prove this property. Controlled
blocking is needed to expose it. For any future isolated change, first document
its complete failure modes, then write the tests, then implement the code.

## Limits

An external service's returned deployment ID is checked, but the current API
does not attest its source or asset hashes. Native camera, MediaPipe, GPU
scheduling, Modal routing, and recognition accuracy each require separate
evidence. Run commands and evidence verification are in
[the shared testing guide](../../tests/README.md).

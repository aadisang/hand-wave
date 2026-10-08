# Inference verification

## Failure inventory, written before the E2E runner

The service can fail to load its real checkpoint or language model, serve a
different build, reject the client's WebSocket protocol, lose frame deltas,
retain a previous segment after reset or finalize, share state between clients,
accept oversized batches, let its rolling window grow without a bound, or stop
accepting valid input after a bad request. A closed connection can also
prevent a later client from reconnecting. These are service boundary failures;
test them through a real process and the real model.

Configuration can also be wrong. The server must refuse to start, with the
error in its log, when the deployment ID is missing or blank, `CORS_ORIGINS` is
not a JSON list of origins, an origin has credentials, a path, a query, or a
fragment, or a checkpoint, KenLM model, or unigram file is missing. The decoder
and text normalizer must load the same configured language model assets. The
Modal app must not be defined without a `dev` or `release` deployment kind and a
deployment ID, and must not check model files on the host, where `/models` does
not exist. A backend manifest must name an HTTPS origin on the default port, a
deployment ID, and the `dev` or `main` environment; the runner must reject any
other manifest with a failed report. Readiness must reject a backend whose
health reports another deployment ID.

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

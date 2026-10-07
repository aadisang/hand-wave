# Hand Wave Inference

FastAPI inference service for Hand Wave.

The iOS and browser clients use `wss://<host>/v1/stream` with the `handwave.v1` subprotocol. Each
connection retains its rolling frame window and recognition state; reconnects resynchronize from the
active window. `POST /v1/recognize` is also available for direct HTTP API calls;
the clients do not switch to it when a WebSocket fails.

## Modal

The Modal app wraps the existing `inference.main:app` ASGI application. It packages the local
`inference` package and the checkpoint under `models/`, then points the runtime at that checkpoint
with `MODEL_DIR=/models`.

Before deploying, authenticate the Modal CLI:

```sh
uv run --group deploy modal setup
```

Develop against an ephemeral Modal endpoint:

```sh
moon run inference:modalServe
```

Deploy the persistent endpoint:

```sh
moon run inference:modalDeploy
```

The web app's `VITE_INFERENCE_URL` and the iOS build setting `HANDWAVE_INFERENCE_URL`
name this service. They are public endpoint configuration, not credentials.
The iOS Release configuration pins the production Modal address; Debug can use
a local override. Changing the production service address requires an app rebuild.
Both clients convert the configured `https` URL to `wss` for streaming.

See [compute and network boundaries](../../README.MD#compute-and-network-boundaries)
for data flow, configuration, and current access-control limits.

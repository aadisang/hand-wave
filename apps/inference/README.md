# Hand Wave Inference

FastAPI inference service for Hand Wave.

The iOS and browser clients use `wss://<host>/v1/stream` with the `handwave.v1` subprotocol. Each
connection retains its rolling frame window and recognition state; reconnects resynchronize from the
active window. `POST /v1/recognize` remains available as a fallback.

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

After deploy, set the web app's `VITE_INFERENCE_URL` and the iOS build setting
`HANDWAVE_INFERENCE_URL` to the Modal endpoint printed by the CLI. The iOS client converts the
configured `https` URL to `wss` automatically.

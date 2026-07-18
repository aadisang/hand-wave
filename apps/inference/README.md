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

### Optional Wikipedia language model

The default profile uses the bundled checkpoint and language model. To use the optional Wikipedia
model, seed the Modal Volume once and deploy with the wiki profile:

```sh
cd apps/inference
uv run --group deploy modal volume create hand-wave-lm
uv run --group deploy modal volume put hand-wave-lm models/lm/wiki_en_token.arpa.bin wiki_en_token.arpa.bin
uv run --group deploy modal volume put hand-wave-lm models/lm/wiki_en_token.unigrams.txt wiki_en_token.unigrams.txt
HAND_WAVE_MODAL_LM=wiki uv run --group deploy modal deploy modal_app.py
```

Set `HAND_WAVE_MODAL_LM_VOLUME` if you want a different Volume name. The serving function mounts
the Volume read-only at `/lm` and uses:

```sh
KENLM_MODEL_PATH=/lm/wiki_en_token.arpa.bin
KENLM_UNIGRAMS_PATH=/lm/wiki_en_token.unigrams.txt
```

# Hand Wave Inference

FastAPI inference service for Hand Wave.

## Modal

The Modal app wraps the existing `inference.main:app` ASGI application. It packages the local
`inference` package and the checkpoint under `models/`, then points the runtime at that checkpoint
with `MODEL_DIR=/models`.

Before deploying, authenticate the Modal CLI:

```sh
uv run --group deploy modal setup
```

Run an ephemeral Modal endpoint while developing:

```sh
moon run inference:modalServe
```

Deploy the persistent endpoint:

```sh
moon run inference:modalDeploy
```

After deploy, set the web app's `VITE_INFERENCE_URL` to the Modal endpoint printed by the CLI.

GitHub Actions deploys the Modal app on pushes to `main` when inference or contract files change.
The workflow expects these repository secrets:

- `MODAL_TOKEN_ID`
- `MODAL_TOKEN_SECRET`

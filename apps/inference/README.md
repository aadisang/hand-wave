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

Create a Modal service user token from the Modal workspace token settings, then store each value as
a GitHub Actions secret:

```sh
gh secret set MODAL_TOKEN_ID --repo sinarck/hand-wave
gh secret set MODAL_TOKEN_SECRET --repo sinarck/hand-wave
```

Paste the token ID into the first prompt and the token secret into the second prompt. Modal only
shows the token secret once when the service user is created.

Verify the secrets exist and trigger a deploy:

```sh
gh secret list --repo sinarck/hand-wave
gh workflow run modal-inference.yml --repo sinarck/hand-wave
```

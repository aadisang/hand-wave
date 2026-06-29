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

### Optional Wikipedia LM

The default Modal app bundles `best.ckpt` and `neutral_english_4gram.kenlm` in the image. The
14 GB `wiki_en_token.arpa.bin` file is intentionally not committed. To test it on Modal, seed a
Volume once, then deploy with the wiki profile:

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

For GitHub Actions deploys, set repository variable `HAND_WAVE_MODAL_LM=wiki` after the Volume is
seeded. Leave it unset to deploy the default bundled language model.

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

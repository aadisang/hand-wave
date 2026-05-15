# Hand Wave

Clean-room rewrite of Hand Wave: a browser-first sign recognition app with a small Python inference service.

## Architecture

```txt
apps/web        TanStack Start frontend (Vite + Nitro v3)
apps/inference  FastAPI inference service (uv)
```

The frontend owns camera capture and browser APIs. The inference app owns model loading and prediction. Keep the API boundary small: landmarks in, predictions out.

The repo is orchestrated by [moon](https://moonrepo.dev) as a polyglot task graph.

## Requirements

- pnpm 10.33+
- Node 22+
- Python 3.13+
- uv
- moon (`pnpm add -g @moonrepo/cli`)

## Setup

```sh
cp .env.example .env
pnpm install
uv sync --project apps/inference
```

The web app validates required environment variables with T3 Env and Zod. Set `VITE_INFERENCE_URL` in `.env` locally and in Vercel.

## Development

Run web + inference together:

```sh
moon run :dev
# or, equivalently
pnpm dev
```

Run one service at a time:

```sh
moon run web:dev
moon run inference:dev
```

Open `http://localhost:3000` for the web app and `http://localhost:8000/docs` for the inference API.

## Inference API

The inference service is session-based because live CTC recognition is not a
stateless single-frame classifier. Clients create a session, append landmark
frames, and receive both a revisable `partial_text` and conservative
`stable_text`.

```sh
moon run inference:dev
```

Core endpoints:

| Method | Path | Use |
|---|---|---|
| `POST` | `/v1/sessions` | Create a streaming recognition session |
| `POST` | `/v1/sessions/{id}/frames` | Append landmark frames and decode the rolling window |
| `POST` | `/v1/sessions/{id}/reset` | Clear buffer/decoder state |
| `DELETE` | `/v1/sessions/{id}` | End a session |
| `POST` | `/v1/predict` | Compatibility endpoint for one-off checks |

To serve a real checkpoint, the backend needs more than the `.ckpt` file:

- the Lightning checkpoint, usually `last.ckpt` or best `step*-cer*.ckpt`
- the exact model class and config used for training
- vocab order, including the CTC blank token
- feature layout, e.g. which MediaPipe landmarks and coordinate order
- preprocessing rules, especially normalization and frame masking

Set `HANDWAVE_CHECKPOINT_PATH` only after that bundle is available inside
`apps/inference`; otherwise the service fails loudly rather than returning fake
predictions.

## Quality

```sh
moon check --all          # format + lint + typecheck + test, both languages, cached
moon run web:typecheck    # one task at a time
moon run inference:lint   # python via ruff
```

| Layer | Tools |
|---|---|
| TypeScript | Vite, Prettier, ESLint, `tsc`, Vitest |
| Python | Ruff (format + lint), Pyright, pytest |

moon caches each task by input hash, so re-runs without changes finish in tens of milliseconds.

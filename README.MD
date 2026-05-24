# Hand Wave

Clean-room rewrite of Hand Wave: a browser-first sign recognition app with a small Python inference service.

## Architecture

```txt
apps/web        TanStack Start frontend (Vite + Nitro v3)
apps/inference  FastAPI inference service (uv)
apps/mobile     SwiftUI iOS client (Tuist)
```

The frontend owns camera capture and browser APIs. The inference app owns model loading and prediction. Keep the API boundary small: landmarks in, predictions out.

The repo is orchestrated by [moon](https://moonrepo.dev) as a polyglot task graph.

## Requirements

- pnpm 10.33+
- Node 22+
- Python 3.11 or 3.12
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
pnpm dev
```

Run one service at a time:

```sh
moon run web:dev
moon run inference:dev
```

Open `http://localhost:3000` for the web app and `http://localhost:8000/docs` for the inference API.

## Inference API

The inference service is stateless. Clients keep their own rolling landmark
window and send that window to the model for each decode.

```sh
moon run inference:dev
```

Core endpoint:

| Method | Path          | Use                                   |
| ------ | ------------- | ------------------------------------- |
| `POST` | `/v1/predict` | Decode a client-owned landmark window |

Inference expects exactly one `.ckpt` file in `apps/inference/models/`.
The checked-in local bundle uses `apps/inference/models/best.ckpt`.

The backend still needs the checkpoint to match the code beside it:

- the Lightning checkpoint, usually `last.ckpt` or best `step*-cer*.ckpt`
- the exact model class and config used for training
- vocab order, including the CTC blank token
- feature layout, e.g. which MediaPipe landmarks and coordinate order
- preprocessing rules, especially normalization and frame masking

## Quality

```sh
pnpm check           # format check + lint + typecheck + test, cached
pnpm check:affected  # same checks for affected projects
pnpm fix             # format + autofix lint
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

| Layer      | Tools                               |
| ---------- | ----------------------------------- |
| TypeScript | Vite, Oxfmt, ESLint, `tsc`, Vitest |
| Python     | Ruff, Pyright, pytest              |
| Swift      | Tuist, swift-format                 |

moon caches each task by input hash. Use `pnpm check` before shipping and
`pnpm check:affected` while iterating.

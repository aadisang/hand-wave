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

## Deployment

- Deploy `apps/web` to Vercel.
- Deploy `apps/inference` to Railway as a Python app, or to Runpod with `apps/inference/Dockerfile`.
- Set `VITE_INFERENCE_URL` for the web app to the deployed inference URL.

## Principles

- No compatibility layer for deleted code.
- No tRPC between TypeScript and Python.
- No model files in git by default.
- Generate typed OpenAPI clients only once the inference API stabilizes.
- Use TanStack Start for the app shell.
- moon owns task orchestration; per-tool config (Vite, ESLint, Ruff, Pyright) lives in each project's standard files.

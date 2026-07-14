# Hand Wave Web

TanStack Start client for browser camera capture and real-time sign recognition.

## Setup

Install the repository dependencies and create the local environment file:

```sh
pnpm install
cp .env.example .env
```

Set `VITE_INFERENCE_URL` to the inference service URL. The default points to the local service on
port 8000.

Start the web app from the repository root:

```sh
moon run web:dev
```

The app runs on `http://localhost:3000`.

## Quality

```sh
moon run web:test
moon run web:build
```

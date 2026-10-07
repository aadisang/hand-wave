# Hand Wave Web

TanStack Start client for browser camera capture and real-time sign recognition.

## Setup

Follow the repository setup, then start development from the repository root:

```sh
pnpm dev
```

The launcher starts an isolated Modal backend and supplies its URL to Vite.
The app runs on `http://localhost:3000`. No copied URL or local IP is needed.

## Quality

```sh
pnpm test --web-only
```

This runs the real local model service and browser journeys against a production
build. See [the shared testing guide](../../tests/README.md) for setup, commands,
and evidence, and [test scope](tests/TESTING.md) for retained isolated regressions.

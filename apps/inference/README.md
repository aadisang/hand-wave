# Hand Wave Inference

FastAPI inference service shared by the iOS and browser clients.

Both clients use `wss://<host>/v1/stream` with `handwave.v1`. Each connection holds
its rolling landmark window and recognition state. Reconnects resynchronize from
the active window. `/v1/health` reports readiness and the deployment ID; release
verification checks that ID before accepting the endpoint.

## Development

Run `pnpm dev` at the repository root, or `pnpm dev:mobile` without Vite. The
launcher uses Modal's native `serve` command in the `dev` environment, hot reloads
source changes, and configures both clients after a real streaming smoke test.
It keeps one development container warm, with a maximum of one. Stop the command
to stop the temporary cloud app and clear generated client settings.

For local Python debugging only, use `moon run inference:local`. This runs the
same FastAPI app and model on this computer without Modal.

## Verification

Run `pnpm exec moon run inference:e2e` to start the real checkpoint and language
model in a local service, exercise HTTP and WebSocket boundaries, and stop the
service. The report, complete protocol transcript, and server log are saved to
`.handwave/e2e/backend/`. Failed checks also write artifacts and exit nonzero.

To verify the active isolated Modal service, run from this directory:

```sh
uv run --frozen --group deploy python -m tools.e2e \
  --manifest ../../.handwave/development.json \
  --output ../../.handwave/e2e/modal
```

For a service managed by the full-stack E2E runner, use `--url` and
`--deployment-id` instead. HTTP is accepted only for loopback E2E servers.
Production endpoint generation still requires HTTPS.

These checks prove real model execution and protocol behavior with synthetic
landmarks. They do not prove sign recognition accuracy. See [the failure
inventory and test audit](TESTING.md) for the limits and the one retained
isolated cancellation regression.

## Release

Use the manual Release workflow from `main`. The `tools.release` command creates
or reuses a backend named `hand-wave-<full Git SHA>` in Modal's `main` environment.
It rejects a dirty checkout or a revision other than HEAD, verifies the real
model and protocol, and generates the release manifest and iOS endpoint setting.
The workflow builds both clients from that same commit and backend address.

Do not deploy `modal_app.py` directly or replace a published backend with new
code. Modal settings, model assets, code, and dependencies belong to the release
commit. Previous clients retain their original service until they are retired.

See [development and releases](../../README.MD#development) for setup and limits.

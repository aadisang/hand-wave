# Hand Wave Inference

FastAPI inference service shared by the iOS and browser clients.

Both clients use `wss://<host>/v1/stream` with `handwave.v1`. Each connection holds
its rolling landmark window and recognition state. Reconnects resynchronize from
the active window. `/v1/health` reports readiness and the deployment ID; release
verification checks that ID before accepting the endpoint.

## Configuration

`inference.settings` reads the environment once and validates it at server
startup. No `.env` file is loaded; the launchers own these values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HANDWAVE_DEPLOYMENT_ID` | required, nonblank | Identity reported by `/v1/health` |
| `CORS_ORIGINS` | handwave.sh and localhost/127.0.0.1 on ports 3000 and 3001 | JSON list of HTTP(S) origins, for example `["http://localhost:3000"]` |
| `MODEL_DIR` | `apps/inference/models` (Modal: `/models`) | Base for the default asset paths |
| `MODEL_CHECKPOINT_PATH` | `$MODEL_DIR/best.ckpt` | Checkpoint file |
| `KENLM_MODEL_PATH` | `$MODEL_DIR/lm/neutral_english_4gram.kenlm` | Language model for the decoder and text normalizer |
| `KENLM_UNIGRAMS_PATH` | `$MODEL_DIR/lm/neutral_english_unigrams.txt` | Unigrams for the decoder and text normalizer |

The asset paths must name existing files. The Modal descriptor also reads
`HANDWAVE_DEPLOYMENT_KIND` (`dev` or `release`). Decoder and recognition tuning
comes only from the shared contract in `packages/contract/config.json`; change
it there and run `moon run contract:generateTunings`.

## Development

Run `pnpm dev` at the repository root, or `pnpm dev:mobile` without Vite. The
launcher uses Modal's native `serve` command in the `dev` environment, hot reloads
source changes, and configures both clients after a real streaming smoke test.
It keeps one development container warm, with a maximum of one. Stop the command
to stop the temporary cloud app and clear generated client settings.

## Verification

`pnpm test` at the repository root starts the real checkpoint and language model
in a local service, then `tools.e2e` exercises its HTTP and WebSocket boundaries
and saves the protocol transcript. See [the shared testing guide](../../tests/README.md)
for commands and evidence. These checks prove real model execution and protocol
behavior with synthetic landmarks, not sign recognition accuracy. See
[the failure inventory](TESTING.md) for the limits and the one retained isolated
cancellation regression.

## Release

Use the manual Release workflow from `main`. The `tools.release` command creates
or reuses a backend named `hand-wave-<full Git SHA>` in Modal's `main` environment.
It takes the revision from HEAD, rejects a dirty checkout, verifies the real
model and protocol, and generates the release manifest and iOS endpoint setting.
The workflow builds both clients from that same commit and backend address.

Do not deploy `modal_app.py` directly or replace a published backend with new
code. Modal settings, model assets, code, and dependencies belong to the release
commit. Previous clients retain their original service until they are retired.

See [development and releases](../../README.MD#development) for setup and limits.

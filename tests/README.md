# Testing policy and evidence

E2E is the main test mechanism. Start with observable failures, run the real
system, and save evidence. Do not add unit tests after implementation. An
isolated test needs a failure inventory written first and a specific explanation
of what it catches that the E2E suite cannot.

## Failure inventory

These are the failures the shared runner must expose before its implementation:

- The model cannot load, or an old process answers on the selected port. Wait for
  health with the expected deployment ID; reject a different ID.
- A protocol check passes without running inference. Require a real prediction
  and decode evidence before testing finalize and reset.
- The browser cannot load MediaPipe, start or restart capture, reach the real
  backend, or recover from denied permission. Run the browser UI with a synthetic
  camera source and real workers/network/model.
- The native client cannot recognize, finalize, reset, or reconnect through its
  real networking implementation. Exercise it from the simulator against the
  same service, and retain its result bundle.
- A child hangs, fails, or the run is interrupted. Bound each process, retain its
  logs and failed report, stop owned processes, and return a failing exit code.
- A result has no identifiable source or model. Record Git revision, source
  changes, model hashes, test commands, deployment identity, and evidence hashes.

Synthetic frames and synthetic camera video do not establish sign accuracy.
The native client test is a service integration test, not a glasses or UI test.
Real sign recordings and physical glasses capture remain separate evidence gaps.
The browser check runs a local production build. It does not exercise the later
Vercel deployment artifact or its hosted routing; a deployed release smoke test
is still required before claiming that boundary is verified.

## Repeat the run

Install the repo dependencies and Git LFS model files as described in the root
README. Install Chromium once with
`pnpm --filter @hand-wave/web exec playwright install chromium`.

Run `pnpm test` on a Mac with the iOS toolchain installed. It starts one real
local inference process for backend, browser, and native checks. It generates
the native workspace before running the simulator suite. Set `IOS_DESTINATION`
to an Xcode simulator destination when needed. Use `pnpm test --web-only` where
the iOS toolchain is unavailable; the report records that reduced scope.

To use a running isolated Modal development service instead, start
`pnpm dev:mobile` in another terminal and run
`pnpm test --backend-manifest .handwave/development.json`.

Each run writes a new directory under `artifacts/e2e`. `report.json` records the
inputs, commands, status, and SHA-256 of each evidence file. Backend transcripts,
browser traces/screenshots/reports, and the native `.xcresult` remain available
even when a check fails. CI uploads the directory on success and failure.
Run `shasum -a 256 -c SHA256SUMS` from the evidence directory to verify its files.
For a dirty local run, check out the recorded revision in a separate checkout,
apply `working-tree.patch` with `git apply`, and extract `untracked-source.tar.gz`
there. `source.json` identifies the exact input files and hashes. CI uses a clean
revision; its patch and untracked archive contain no source changes.

The small retained isolated regression suites and their specific failure modes
are documented in each application's testing inventory. They run separately
from E2E and cannot stand in for it.

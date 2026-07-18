# Beam / autocorrect tuning harness

Offline optimizer for everything downstream of the neural model: CTC beam
params, confidence temperature, and the SmoothConfig commit gates. The model
forward pass is cached once per streaming window, so parameter search replays
through the production recognition code at ~7ms/window.

Tuned values ship via `packages/contract/config.json` (`inference` section) →
`moon run contract:generateTunings` → `src/inference/generated_tunings.py`.

## Workflow

```bash
# 1. Cache emissions for a directory of exported traces (schema v3)
uv run python tuning/cache_emissions.py --traces-dir ~/Downloads/Traces

# 2. Establish the bounded-memory quality baseline
uv run python tuning/benchmark.py \
  --speech-trace ~/Downloads/Traces/hand-wave-speech-1782764384.json \
  --cadences 1,2,3 \
  --details --require-zero-false-commits

# 3. Coarse decoder grid (alpha x beta), with oracle ceilings per config
uv run python tuning/optimize.py grid --workers 7 --out grid.jsonl

# 4. Optuna search over smoothing gates for one decoder config
uv run --with optuna python tuning/optimize.py study --alpha 1.6 --beta 2.0 --trials 900 --out study.json

# 5. Score a full param set with per-case outcomes
uv run python tuning/optimize.py eval tuning/results/final_spec.json

# 6. Diagnose: per-recording beam support (was the label ever reachable?)
uv run python tuning/analyze_misses.py --alpha 1.6 --beta 2.0
```

Optimization is lexicographic: keep false commits at zero, maximize recall on
recoverable recordings, suppress model failures, then minimize runtime. A case
is recoverable only when its label appears in a raw/normalized beam or a greedy
decode is within a length-scaled edit limit. This keeps tuning from rewarding
phrase-specific guesses that the acoustic model did not support.
The default `1,2,3` cadence replay also requires zero false commits when every
second or third streaming response is superseded. The speech trace audit is
historical; current mobile policy is covered separately by finalized-only tests.

`results/final_spec.json` records the selected parameter set. Shipped values
live in the contract config.

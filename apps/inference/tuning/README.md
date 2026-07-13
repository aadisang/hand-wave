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

# 2. Coarse decoder grid (alpha x beta), with oracle ceilings per config
uv run python tuning/optimize.py grid --workers 7 --out grid.jsonl

# 3. Optuna search over smoothing gates for one decoder config
uv run --with optuna python tuning/optimize.py study --alpha 1.6 --beta 2.0 --trials 900 --out study.json

# 4. Score a full param set with per-case outcomes
uv run python tuning/optimize.py eval tuning/results/final_spec.json

# 5. Diagnose: per-recording beam support (was the label ever reachable?)
uv run python tuning/analyze_misses.py --alpha 1.6 --beta 2.0
```

`results/final_spec.json` records the best parameter set from the 67-trace run:
53.7% committed exact-match with 1.5% false commits. Shipped values live in the
contract config.

Key evidence from the 2026-07 tuning run: the accuracy ceiling is set by the
model's emissions, not this layer — 16/67 recordings never contain the label
in any beam of any window (any-beam ceiling 79%). Next gains come from model
retraining / new traces, which this harness can score in seconds.

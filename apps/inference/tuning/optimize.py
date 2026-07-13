"""Two-tier optimizer over the cached emissions.

Commands:
  grid   - parallel coarse grid over CTC decoder params; each config gets oracle
           ceilings + a quick smoothing sweep. Writes results JSONL.
  study  - Optuna search over SmoothConfig + confidence_temperature for one
           decoder param set (fast: decodes once, then replays).
  eval   - score one full param set (decoder + smoothing) with per-case outcomes.

Run from apps/inference:  uv run --with optuna python tuning/optimize.py <cmd>
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import sys
from dataclasses import asdict, replace
from itertools import product
from pathlib import Path
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parent))

from harness import (
    BatchDecoder,
    DecoderParams,
    load_all_cached_cases,
    oracle_stats,
    prepare_cases,
    replay_all,
)

from inference.recognition import SmoothConfig

RESULTS_DIR = Path(__file__).resolve().parent / "results"

QUICK_TEMPERATURES = (0.8, 1.2, 2.0)
QUICK_SMOOTHS: tuple[dict, ...] = (
    {},
    {"commit_confidence": 0.6},
    {"commit_confidence": 0.6, "commit_streak": 2, "commit_count": 2},
    {"stable_commit_count": 6, "stable_commit_streak": 6},
    {"commit_confidence": 0.7, "stable_commit_count": 6, "stable_commit_streak": 6},
    {
        "commit_confidence": 0.6,
        "stable_commit_count": 6,
        "stable_commit_streak": 6,
        "alternative_commit_count": 12,
    },
)

_WORKER_CASES = None
_WORKER_DECODER = None


def _worker_init() -> None:
    global _WORKER_CASES, _WORKER_DECODER
    _WORKER_CASES = load_all_cached_cases()
    _WORKER_DECODER = BatchDecoder()


def _eval_decoder_config(params: DecoderParams) -> dict:
    assert _WORKER_CASES is not None and _WORKER_DECODER is not None
    started = perf_counter()
    decoded = [_WORKER_DECODER.decode_case(case, params) for case in _WORKER_CASES]
    decode_s = perf_counter() - started

    oracle = oracle_stats(decoded)
    best = None
    for temperature in QUICK_TEMPERATURES:
        prepared = prepare_cases(decoded, temperature)
        for overrides in QUICK_SMOOTHS:
            smooth = replace(SmoothConfig(), **overrides)
            score = replay_all(prepared, smooth)
            entry = {
                "temperature": temperature,
                "smooth_overrides": overrides,
                "accuracy": score.accuracy,
                "false_commit_rate": score.false_commit_rate,
                "objective": score.objective,
                "uncommitted": score.uncommitted,
            }
            if (
                best is None
                or entry["objective"] > best["objective"]
                or (
                    entry["objective"] == best["objective"] and entry["accuracy"] > best["accuracy"]
                )
            ):
                best = entry
    return {
        "params": asdict(params),
        "oracle": oracle,
        "quick_best": best,
        "decode_s": round(decode_s, 1),
    }


def cmd_grid(args: argparse.Namespace) -> None:
    alphas = [float(v) for v in args.alphas.split(",")]
    betas = [float(v) for v in args.betas.split(",")]
    unks = [float(v) for v in args.unks.split(",")]
    configs = [
        DecoderParams(alpha=a, beta=b, unk_score_offset=u, beam_width=args.beam_width)
        for a, b, u in product(alphas, betas, unks)
    ]
    RESULTS_DIR.mkdir(exist_ok=True)
    out_path = RESULTS_DIR / args.out
    print(f"grid: {len(configs)} configs, {args.workers} workers -> {out_path}", flush=True)

    with mp.get_context("spawn").Pool(args.workers, initializer=_worker_init) as pool:
        with out_path.open("a") as out:
            for result in pool.imap_unordered(_eval_decoder_config, configs):
                out.write(json.dumps(result) + "\n")
                out.flush()
                quick = result["quick_best"]
                print(
                    f"a={result['params']['alpha']} b={result['params']['beta']} "
                    f"u={result['params']['unk_score_offset']} "
                    f"acc={quick['accuracy']:.3f} false={quick['false_commit_rate']:.3f} "
                    f"oracle_top1={result['oracle']['top1_full']:.3f} "
                    f"oracle_any={result['oracle']['any_beam']:.3f} "
                    f"({result['decode_s']}s)",
                    flush=True,
                )
    print("grid done", flush=True)


def _smooth_from_trial(trial) -> tuple[SmoothConfig, float]:
    temperature = trial.suggest_float("confidence_temperature", 0.5, 4.0)
    smooth = SmoothConfig(
        display_confidence=trial.suggest_float("display_confidence", 0.02, 0.3),
        display_streak=trial.suggest_int("display_streak", 1, 4),
        display_count=trial.suggest_int("display_count", 1, 4),
        display_clear_misses=trial.suggest_int("display_clear_misses", 1, 5),
        instant_display_confidence=trial.suggest_float("instant_display_confidence", 0.2, 0.8),
        commit_confidence=trial.suggest_float("commit_confidence", 0.35, 0.95),
        short_commit_confidence=trial.suggest_float("short_commit_confidence", 0.7, 0.99),
        commit_streak=trial.suggest_int("commit_streak", 1, 5),
        commit_count=trial.suggest_int("commit_count", 1, 8),
        endpoint_commit_count=trial.suggest_int("endpoint_commit_count", 1, 4),
        commit_soft_oov_min_chars=trial.suggest_int("commit_soft_oov_min_chars", 4, 9),
        commit_soft_oov_confidence=trial.suggest_float("commit_soft_oov_confidence", 0.7, 0.99),
        commit_reject_uncorrected_oov_chars=trial.suggest_int(
            "commit_reject_uncorrected_oov_chars", 5, 12
        ),
        stable_commit_confidence=trial.suggest_float("stable_commit_confidence", 0.25, 0.95),
        stable_commit_count=trial.suggest_int("stable_commit_count", 2, 16),
        stable_commit_streak=trial.suggest_int("stable_commit_streak", 2, 16),
        stable_commit_min_chars=trial.suggest_int("stable_commit_min_chars", 3, 5),
        short_stable_commit_confidence=trial.suggest_float(
            "short_stable_commit_confidence", 0.25, 0.95
        ),
        short_stable_commit_count=trial.suggest_int("short_stable_commit_count", 4, 16),
        short_stable_commit_streak=trial.suggest_int("short_stable_commit_streak", 4, 16),
        majority_commit_min_count=trial.suggest_int("majority_commit_min_count", 5, 30),
        majority_commit_min_share=trial.suggest_float("majority_commit_min_share", 0.2, 0.8),
        majority_commit_min_chars=trial.suggest_int("majority_commit_min_chars", 2, 5),
        alternative_commit_confidence=trial.suggest_float(
            "alternative_commit_confidence", 0.1, 0.7
        ),
        alternative_commit_count=trial.suggest_int("alternative_commit_count", 6, 30),
        alternative_commit_min_chars=trial.suggest_int("alternative_commit_min_chars", 3, 6),
        alternative_commit_recent_misses=trial.suggest_int(
            "alternative_commit_recent_misses", 2, 10
        ),
        # negative margin = prefer newer (more recent) committing candidates
        replace_margin=trial.suggest_float("replace_margin", -0.25, 0.25),
    )
    return smooth, temperature


def cmd_study(args: argparse.Namespace) -> None:
    import optuna

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    params = DecoderParams(
        alpha=args.alpha,
        beta=args.beta,
        unk_score_offset=args.unk,
        beam_width=args.beam_width,
        beam_prune_logp=args.beam_prune_logp,
        token_min_logp=args.token_min_logp,
    )
    cases = load_all_cached_cases()
    decoder = BatchDecoder()
    print(f"decoding {len(cases)} cases with {params} ...", flush=True)
    decoded = [decoder.decode_case(case, params) for case in cases]
    print(f"oracle: {oracle_stats(decoded)}", flush=True)

    prepared_by_temp: dict[float, list] = {}

    def objective(trial) -> float:
        smooth, temperature = _smooth_from_trial(trial)
        temp_key = round(temperature, 2)
        if temp_key not in prepared_by_temp:
            if len(prepared_by_temp) > 60:
                prepared_by_temp.clear()
            prepared_by_temp[temp_key] = prepare_cases(decoded, temp_key)
        score = replay_all(prepared_by_temp[temp_key], smooth)
        trial.set_user_attr("accuracy", score.accuracy)
        trial.set_user_attr("false_commit_rate", score.false_commit_rate)
        trial.set_user_attr("uncommitted", score.uncommitted)
        return score.objective

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=7))
    default_params = {
        "confidence_temperature": 1.2,
        **{
            key: getattr(SmoothConfig(), key)
            for key in (
                "display_confidence",
                "display_streak",
                "display_count",
                "display_clear_misses",
                "instant_display_confidence",
                "commit_confidence",
                "short_commit_confidence",
                "commit_streak",
                "commit_count",
                "endpoint_commit_count",
                "commit_soft_oov_min_chars",
                "commit_soft_oov_confidence",
                "commit_reject_uncorrected_oov_chars",
                "stable_commit_confidence",
                "stable_commit_count",
                "stable_commit_streak",
                "stable_commit_min_chars",
                "short_stable_commit_confidence",
                "short_stable_commit_count",
                "short_stable_commit_streak",
                "majority_commit_min_count",
                "majority_commit_min_share",
                "majority_commit_min_chars",
                "alternative_commit_confidence",
                "alternative_commit_count",
                "alternative_commit_min_chars",
                "alternative_commit_recent_misses",
                "replace_margin",
            )
        },
    }
    study.enqueue_trial(default_params)
    started = perf_counter()
    study.optimize(objective, n_trials=args.trials, show_progress_bar=False)
    elapsed = perf_counter() - started

    best = study.best_trial
    RESULTS_DIR.mkdir(exist_ok=True)
    out_path = RESULTS_DIR / args.out
    payload = {
        "decoder_params": asdict(params),
        "best_objective": best.value,
        "accuracy": best.user_attrs.get("accuracy"),
        "false_commit_rate": best.user_attrs.get("false_commit_rate"),
        "uncommitted": best.user_attrs.get("uncommitted"),
        "smooth_params": best.params,
        "trials": len(study.trials),
        "elapsed_s": round(elapsed, 1),
    }
    out_path.write_text(json.dumps(payload, indent=2))
    print(json.dumps(payload, indent=2), flush=True)


def cmd_eval(args: argparse.Namespace) -> None:
    spec = json.loads(Path(args.spec).read_text())
    decoder_params = DecoderParams(**spec["decoder_params"])
    smooth_kwargs = dict(spec["smooth_params"])
    temperature = smooth_kwargs.pop("confidence_temperature", 1.2)
    smooth = SmoothConfig(**smooth_kwargs)

    cases = load_all_cached_cases()
    decoder = BatchDecoder()
    decoded = [decoder.decode_case(case, decoder_params) for case in cases]
    print(f"oracle: {oracle_stats(decoded)}", flush=True)
    prepared = prepare_cases(decoded, temperature)
    score = replay_all(prepared, smooth, keep_outcomes=True)
    print(
        f"cases={score.cases} acc={score.accuracy:.4f} "
        f"false={score.false_commit_rate:.4f} uncommitted={score.uncommitted}",
        flush=True,
    )
    for outcome in score.outcomes:
        if not outcome.correct:
            detail = f"committed {outcome.text!r}" if outcome.committed else "no commit"
            print(f"  MISS [{outcome.trace}] {outcome.label!r} -> {detail}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    grid = sub.add_parser("grid")
    grid.add_argument("--alphas", default="0.3,0.6,0.9,1.2,1.6,2.0")
    grid.add_argument("--betas", default="0.0,1.0,2.0,3.0")
    grid.add_argument("--unks", default="-10.0")
    grid.add_argument("--beam-width", type=int, default=50)
    grid.add_argument("--workers", type=int, default=8)
    grid.add_argument("--out", default="grid.jsonl")
    grid.set_defaults(func=cmd_grid)

    study = sub.add_parser("study")
    study.add_argument("--alpha", type=float, default=1.2)
    study.add_argument("--beta", type=float, default=2.0)
    study.add_argument("--unk", type=float, default=-10.0)
    study.add_argument("--beam-width", type=int, default=50)
    study.add_argument("--beam-prune-logp", type=float, default=-10.0)
    study.add_argument("--token-min-logp", type=float, default=-5.0)
    study.add_argument("--trials", type=int, default=600)
    study.add_argument("--out", default="study.json")
    study.set_defaults(func=cmd_study)

    evalp = sub.add_parser("eval")
    evalp.add_argument("spec")
    evalp.set_defaults(func=cmd_eval)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

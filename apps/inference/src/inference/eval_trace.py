from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any

from inference.ctc import CtcDecoderConfig
from inference.model import decoded_to_predict_out, resolve_checkpoint_path
from inference.recognition import (
    SmoothConfig,
    accept_prediction,
    clean,
    empty_state,
    finalize,
)
from inference.runtime import HandwaveRuntime
from inference.schemas import (
    EndpointReason,
    LandmarkFrame,
    PredictOut,
    RecognitionContext,
    RecognizeOut,
)

ALPHAS = (0.35, 0.5, 0.65)
BETAS = (1.0, 1.5, 2.0)
DISPLAY_THRESHOLDS = (0.06, 0.08, 0.12)
COMMIT_THRESHOLDS = (0.14, 0.18, 0.24)


@dataclass(frozen=True)
class TraceCase:
    label: str
    frames: list[LandmarkFrame]


@dataclass(frozen=True)
class EvalParams:
    alpha: float
    beta: float
    display_confidence: float
    commit_confidence: float


@dataclass(frozen=True)
class EvalResult:
    params: EvalParams
    cases: int
    display_hits: int
    commit_hits: int
    false_commits: int
    avg_decode_ms: float
    misses: dict[str, int]

    @property
    def display_accuracy(self) -> float:
        return self.display_hits / self.cases if self.cases else 0

    @property
    def committed_accuracy(self) -> float:
        return self.commit_hits / self.cases if self.cases else 0


@dataclass(frozen=True)
class DecodedCase:
    label: str
    full: PredictOut
    windows: tuple[tuple[int, PredictOut], ...]


@dataclass(frozen=True)
class DecodedBatch:
    cases: tuple[DecodedCase, ...]
    avg_decode_ms: float


def main() -> None:
    parser = argparse.ArgumentParser(description="Replay a Hand Wave trace through inference.")
    parser.add_argument("trace", type=Path)
    parser.add_argument("--grid", action="store_true")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--max-recordings", type=int)
    args = parser.parse_args()

    trace = json.loads(args.trace.read_text())
    cases = trace_cases(trace)
    if args.max_recordings:
        cases = cases[: args.max_recordings]

    results = (
        evaluate_grid(trace, cases, args.device)
        if args.grid
        else [evaluate(trace, cases, args.device)]
    )
    print_report(max(results, key=result_key), results if args.grid else [])


def evaluate(
    trace: dict[str, Any],
    cases: list[TraceCase],
    device: str,
) -> EvalResult:
    params = EvalParams(0.65, 2.0, 0.06, 0.14)
    runtime = build_runtime(params.alpha, params.beta, device)
    return score_batch(decode_batch(trace, cases, runtime), params)


def evaluate_grid(
    trace: dict[str, Any],
    cases: list[TraceCase],
    device: str,
) -> list[EvalResult]:
    results: list[EvalResult] = []
    runtime = build_runtime(ALPHAS[0], BETAS[0], device)
    for alpha in ALPHAS:
        for beta in BETAS:
            reset_decoder(runtime, alpha, beta)
            batch = decode_batch(trace, cases, runtime)
            for display in DISPLAY_THRESHOLDS:
                for commit in COMMIT_THRESHOLDS:
                    results.append(score_batch(batch, EvalParams(alpha, beta, display, commit)))
    return results


def decode_batch(
    trace: dict[str, Any],
    cases: list[TraceCase],
    runtime: HandwaveRuntime,
) -> DecodedBatch:
    stream = stream_config(trace)
    decode_ms = 0.0
    decodes = 0
    decoded_cases: list[DecodedCase] = []

    for case in cases:
        full, latency_ms = predict(runtime, case.frames)
        decode_ms += latency_ms
        decodes += 1
        windows: list[tuple[int, PredictOut]] = []
        for end in range(int(stream["min"]), len(case.frames) + 1, int(stream["stride"])):
            frames = case.frames[max(0, end - int(stream["window"])) : end]
            out, latency_ms = predict(runtime, frames)
            decode_ms += latency_ms
            decodes += 1
            windows.append((end, out))
        decoded_cases.append(DecodedCase(case.label, full, tuple(windows)))

    return DecodedBatch(tuple(decoded_cases), decode_ms / decodes if decodes else 0)


def build_runtime(alpha: float, beta: float, device: str) -> HandwaveRuntime:
    base_decoder_config = CtcDecoderConfig.from_env()
    return HandwaveRuntime(
        resolve_checkpoint_path(),
        device=device,
        decoder_config=CtcDecoderConfig(
            kenlm_model_path=base_decoder_config.kenlm_model_path,
            unigram_path=base_decoder_config.unigram_path,
            alpha=alpha,
            beta=beta,
            unk_score_offset=base_decoder_config.unk_score_offset,
        ),
    )


def reset_decoder(runtime: HandwaveRuntime, alpha: float, beta: float) -> None:
    runtime.decoder.reset_params(alpha=alpha, beta=beta)


def score_batch(batch: DecodedBatch, params: EvalParams) -> EvalResult:
    smooth = SmoothConfig(
        display_confidence=params.display_confidence,
        commit_confidence=params.commit_confidence,
    )
    display_hits = 0
    commit_hits = 0
    false_commits = 0
    misses: dict[str, int] = {}

    for case in batch.cases:
        expected = clean(case.label)
        if clean(case.full.prediction.label) == expected:
            display_hits += 1

        committed = replay_predictions(case, smooth)
        committed_label = (
            clean(committed.display_prediction.label) if committed.display_prediction else ""
        )
        if committed.committed and committed_label == expected:
            commit_hits += 1
        elif committed.committed:
            false_commits += 1
            misses[expected] = misses.get(expected, 0) + 1
        else:
            misses[expected] = misses.get(expected, 0) + 1

    return EvalResult(
        params=params,
        cases=len(batch.cases),
        display_hits=display_hits,
        commit_hits=commit_hits,
        false_commits=false_commits,
        avg_decode_ms=batch.avg_decode_ms,
        misses=dict(sorted(misses.items(), key=lambda item: (-item[1], item[0]))),
    )


def replay_predictions(case: DecodedCase, smooth: SmoothConfig) -> RecognizeOut:
    state = empty_state()

    for end, prediction in case.windows:
        context = RecognitionContext(
            idle_frames=0,
            missing_frames=0,
            segment_frames=end,
            motion=0,
        )
        out = accept_prediction(
            state,
            prediction,
            context,
            end,
            0,
            smooth,
        )
        state = out.state

    return finalize(
        state,
        RecognitionContext(
            idle_frames=0,
            missing_frames=0,
            segment_frames=case.windows[-1][0] if case.windows else 0,
            motion=0,
            endpoint_reason=EndpointReason.idle,
        ),
        smooth,
    )


def predict(runtime: HandwaveRuntime, frames: list[LandmarkFrame]) -> tuple[PredictOut, float]:
    started = perf_counter()
    out = decoded_to_predict_out(runtime.predict(frames))
    return out, (perf_counter() - started) * 1_000


def trace_cases(trace: dict[str, Any]) -> list[TraceCase]:
    cases: list[TraceCase] = []
    for recording in trace.get("recordings", []):
        expected_texts = recording.get("expectedTexts") or []
        label = clean(
            recording.get("expectedText")
            or recording.get("label")
            or next(iter(expected_texts), "")
        )
        frames = [
            LandmarkFrame(root=frame["features"])
            for frame in recording.get("frames", [])
            if frame.get("features") is not None
        ]
        if label and frames:
            cases.append(TraceCase(label, frames))
    return cases


def stream_config(trace: dict[str, Any]) -> dict[str, int | float]:
    stream = trace.get("config", {}).get("stream", {})
    decode = trace.get("config", {}).get("decode", {})
    return {
        "min": int(stream.get("min", 18)),
        "stride": int(stream.get("stride", 3)),
        "window": int(decode.get("window", 192)),
    }


def result_key(result: EvalResult) -> tuple[float, int, float]:
    return (
        result.committed_accuracy,
        -result.false_commits,
        -result.avg_decode_ms,
    )


def print_report(best: EvalResult, grid: list[EvalResult]) -> None:
    print(json.dumps(summary(best), indent=2))
    if not grid:
        return
    print("\nTop grid results:")
    for result in sorted(grid, key=result_key, reverse=True)[:10]:
        print(json.dumps(summary(result), sort_keys=True))


def summary(result: EvalResult) -> dict[str, Any]:
    return {
        "params": result.params.__dict__,
        "cases": result.cases,
        "display_accuracy": round(result.display_accuracy, 4),
        "committed_accuracy": round(result.committed_accuracy, 4),
        "false_commits": result.false_commits,
        "avg_decode_ms": round(result.avg_decode_ms, 2),
        "misses": result.misses,
    }


if __name__ == "__main__":
    main()

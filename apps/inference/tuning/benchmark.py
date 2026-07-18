"""Bounded-memory quality gate for exported Hand Wave traces.

The benchmark is deliberately lexicographic: false commits must remain zero,
then recoverable recall is maximized, then runtime is minimized. A recording is
"recoverable" only when its expected text appears in a beam or is acoustically
close to a greedy decode. Everything else is classified as a model failure.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, replace
from math import ceil
from pathlib import Path
from time import perf_counter
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from inference.ctc import CtcDecoderConfig
from inference.recognition import SmoothConfig, clean
from inference.text_normalizer import normalize_prediction_text
from tuning.harness import (
    CACHE_DIR,
    BatchDecoder,
    DecodedCase,
    DecoderParams,
    iter_cached_cases,
    prepare_cases,
    replay_case,
)


@dataclass(frozen=True)
class Reachability:
    kind: str
    raw_beam_exact: bool
    normalized_beam_exact: bool
    top1_window_exact: bool
    raw_beam_windows: int
    normalized_beam_windows: int
    top1_windows: int
    greedy_near_windows: int
    min_greedy_edits: int
    greedy_edit_limit: int

    @property
    def recoverable(self) -> bool:
        return self.kind != "model_failure"


@dataclass(frozen=True)
class CaseResult:
    trace: str
    recording_id: str
    expected: str
    output: str | None
    status: str
    reachability: Reachability


def normalized_key(text: str) -> str:
    return clean(normalize_prediction_text(text))


def collapsed(text: str) -> str:
    return clean(text).replace(" ", "")


def edit_distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for row_index, left_char in enumerate(left, start=1):
        current = [row_index]
        for column_index, right_char in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[column_index] + 1,
                    previous[column_index - 1] + (left_char != right_char),
                )
            )
        previous = current
    return previous[-1]


def greedy_edit_limit(expected: str) -> int:
    length = len(collapsed(expected))
    if length <= 3:
        return 0
    return min(3, max(1, ceil(length * 0.18)))


def classify_reachability(case: DecodedCase) -> Reachability:
    expected = clean(case.label)
    target = collapsed(expected)
    raw_beam_exact = False
    normalized_beam_exact = False
    top1_window_exact = False
    raw_beam_windows = 0
    normalized_beam_windows = 0
    top1_windows = 0
    greedy_edits: list[int] = []
    greedy_window_edits: list[int] = []
    limit = greedy_edit_limit(expected)

    for window in (*case.windows, case.full):
        if window.greedy_text:
            raw_greedy = collapsed(window.greedy_text)
            normalized_greedy = collapsed(normalized_key(window.greedy_text))
            window_min = min(
                edit_distance(target, raw_greedy),
                edit_distance(target, normalized_greedy),
            )
            greedy_edits.append(window_min)
            greedy_window_edits.append(window_min)
        window_raw_exact = False
        window_normalized_exact = False
        window_top1_exact = False
        for rank, (text, _logit, _lm) in enumerate(window.beams):
            if clean(text) == expected:
                raw_beam_exact = True
                window_raw_exact = True
            if rank < 3 and normalized_key(text) == expected:
                normalized_beam_exact = True
                window_normalized_exact = True
            if rank == 0 and normalized_key(text) == expected:
                top1_window_exact = True
                window_top1_exact = True
        raw_beam_windows += int(window_raw_exact)
        normalized_beam_windows += int(window_normalized_exact)
        top1_windows += int(window_top1_exact)

    minimum = min(greedy_edits, default=10_000)
    greedy_near_windows = sum(edits <= limit for edits in greedy_window_edits)
    if raw_beam_exact:
        kind = "raw_beam"
    elif normalized_beam_exact:
        kind = "normalized_beam"
    elif minimum <= limit:
        kind = "greedy_near"
    else:
        kind = "model_failure"
    return Reachability(
        kind,
        raw_beam_exact,
        normalized_beam_exact,
        top1_window_exact,
        raw_beam_windows,
        normalized_beam_windows,
        top1_windows,
        greedy_near_windows,
        minimum,
        limit,
    )


def result_status(correct: bool, committed: bool, recoverable: bool) -> str:
    if correct:
        return "correct"
    if committed:
        return "false_commit_recoverable" if recoverable else "false_commit_model_failure"
    return "missed_recoverable" if recoverable else "suppressed_model_failure"


def run_benchmark(
    cache_dir: Path,
    max_cases: int | None = None,
    cadences: tuple[int, ...] = (1, 2, 3),
) -> dict[str, Any]:
    if not cadences or any(cadence < 1 for cadence in cadences):
        raise ValueError("cadences must contain positive integers")
    cadences = tuple(dict.fromkeys((1, *cadences)))
    decoder_config = CtcDecoderConfig.from_env()
    smooth = SmoothConfig.from_env()
    params = DecoderParams(
        alpha=decoder_config.alpha,
        beta=decoder_config.beta,
        unk_score_offset=decoder_config.unk_score_offset,
        beam_width=decoder_config.beam_width,
        beam_prune_logp=decoder_config.beam_prune_logp,
        token_min_logp=decoder_config.token_min_logp,
        hotwords=decoder_config.hotwords,
        hotword_weight=decoder_config.hotword_weight,
    )
    decoder = BatchDecoder()
    results: list[CaseResult] = []
    cadence_statuses = {cadence: Counter[str]() for cadence in cadences}
    decode_seconds = 0.0
    replay_seconds = 0.0

    for index, cached in enumerate(iter_cached_cases(cache_dir)):
        if max_cases is not None and index >= max_cases:
            break
        started = perf_counter()
        decoded = decoder.decode_case(cached, params)
        prepared = prepare_cases([decoded], decoder_config.confidence_temperature)[0]
        decode_seconds += perf_counter() - started

        reachability = classify_reachability(decoded)
        primary_outcome = None
        primary_status = ""
        for cadence in cadences:
            cadence_case = (
                prepared
                if cadence == 1
                else replace(prepared, windows=prepared.windows[::cadence])
            )
            started = perf_counter()
            outcome = replay_case(cadence_case, smooth)
            replay_seconds += perf_counter() - started
            status = result_status(outcome.correct, outcome.committed, reachability.recoverable)
            cadence_statuses[cadence][status] += 1
            if cadence == 1:
                primary_outcome = outcome
                primary_status = status
        assert primary_outcome is not None
        results.append(
            CaseResult(
                trace=cached.trace,
                recording_id=cached.recording_id,
                expected=cached.label,
                output=primary_outcome.text if primary_outcome.committed else None,
                status=primary_status,
                reachability=reachability,
            )
        )

    if not results:
        raise RuntimeError(f"no cached cases found under {cache_dir}")

    statuses = Counter(item.status for item in results)
    reachability = Counter(item.reachability.kind for item in results)
    recoverable_cases = sum(item.reachability.recoverable for item in results)
    correct_recoverable = sum(
        item.status == "correct" and item.reachability.recoverable for item in results
    )
    false_commits = statuses["false_commit_recoverable"] + statuses["false_commit_model_failure"]
    by_trace: dict[str, Counter[str]] = defaultdict(Counter)
    for item in results:
        by_trace[item.trace][item.status] += 1

    cadence_summary = {
        str(cadence): summarize_statuses(counts, len(results))
        for cadence, counts in cadence_statuses.items()
    }
    passes_cadence_safety = all(item["false_commits"] == 0 for item in cadence_summary.values())

    return {
        "definition": {
            "priority": [
                "zero false commits",
                "maximize correct recoverable cases",
                "suppress model failures",
                "minimize decode and replay time",
            ],
            "recoverable": (
                "expected text in raw/normalized beam, or greedy decode within a "
                "length-scaled edit limit"
            ),
        },
        "config": {
            "decoder": asdict(params),
            "confidence_temperature": decoder_config.confidence_temperature,
            "smooth": asdict(smooth),
        },
        "summary": {
            "cases": len(results),
            "correct": statuses["correct"],
            "false_commits": false_commits,
            "uncommitted": len(results) - statuses["correct"] - false_commits,
            "recoverable_cases": recoverable_cases,
            "correct_recoverable": correct_recoverable,
            "recoverable_recall": (
                correct_recoverable / recoverable_cases if recoverable_cases else 0
            ),
            "suppressed_model_failures": statuses["suppressed_model_failure"],
            "missed_recoverable": statuses["missed_recoverable"],
            "decode_seconds": round(decode_seconds, 3),
            "replay_seconds": round(replay_seconds, 3),
            "passes_safety_gate": false_commits == 0 and passes_cadence_safety,
        },
        "cadences": cadence_summary,
        "reachability": dict(sorted(reachability.items())),
        "by_trace": {
            trace: dict(sorted(counts.items())) for trace, counts in sorted(by_trace.items())
        },
        "cases": [
            {
                **{key: value for key, value in asdict(item).items() if key != "reachability"},
                "reachability": asdict(item.reachability),
            }
            for item in results
        ],
    }


def summarize_statuses(statuses: Counter[str], cases: int) -> dict[str, int | bool]:
    false_commits = statuses["false_commit_recoverable"] + statuses["false_commit_model_failure"]
    correct = statuses["correct"]
    return {
        "correct": correct,
        "false_commits": false_commits,
        "uncommitted": cases - correct - false_commits,
        "passes_safety_gate": false_commits == 0,
    }


def analyze_speech_trace(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    entries = payload.get("entries", [])
    event_counts = Counter(entry.get("event", "unknown") for entry in entries)
    speech_requests = [entry for entry in entries if entry.get("event") == "speechRequested"]
    finalized_requests = 0
    previous_event: dict[str, Any] | None = None
    for entry in entries:
        if entry.get("event") == "speechRequested":
            if (
                previous_event is not None
                and previous_event.get("event") == "finalizedSeen"
                and previous_event.get("text") == entry.get("spokenText")
            ):
                finalized_requests += 1
        previous_event = entry
    partial_requests = len(speech_requests) - finalized_requests
    return {
        "path": str(path),
        "entries": len(entries),
        "events": dict(sorted(event_counts.items())),
        "speech_requests": len(speech_requests),
        "finalized_requests": finalized_requests,
        "partial_requests": partial_requests,
        "passes_finalized_only_gate": partial_requests == 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--speech-trace", type=Path)
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--max-cases", type=int)
    parser.add_argument("--cadences", default="1,2,3")
    parser.add_argument("--details", action="store_true")
    parser.add_argument("--require-zero-false-commits", action="store_true")
    args = parser.parse_args()

    cadences = tuple(int(value) for value in args.cadences.split(",") if value.strip())
    payload = run_benchmark(args.cache_dir, args.max_cases, cadences)
    if args.speech_trace:
        payload["speech"] = analyze_speech_trace(args.speech_trace)
    if args.json_out:
        args.json_out.write_text(json.dumps(payload, indent=2) + "\n")

    print(json.dumps(payload["summary"], indent=2))
    print(json.dumps({"cadences": payload["cadences"]}, indent=2))
    if "speech" in payload:
        print(json.dumps(payload["speech"], indent=2))
    if args.details:
        for item in payload["cases"]:
            if item["status"] != "correct":
                print(
                    f"{item['status']}: {item['expected']!r} -> {item['output']!r} "
                    f"({item['reachability']['kind']})"
                )

    if args.require_zero_false_commits and not payload["summary"]["passes_safety_gate"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

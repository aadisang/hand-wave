"""Shared tooling for offline beam/autocorrect tuning against exported traces.

The neural forward pass is cached once per (recording, streaming window); every
tunable knob downstream of the emissions (CTC beam params, confidence
temperature, SmoothConfig commit gates) replays from the cache at high speed
using the production recognition code paths.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from inference.ctc import CtcDecoderConfig, build_decoder, softmax
from inference.recognition import (
    SmoothConfig,
    accept_endpoint_prediction,
    accept_prediction,
    clean,
    empty_state,
    finalize,
)
from inference.schemas import (
    EndpointReason,
    LandmarkFrame,
    Prediction,
    PredictOut,
    RecognitionContext,
)

REPO_TRACES_DIR = Path(__file__).resolve().parents[3] / "Traces"
CACHE_DIR = Path(__file__).resolve().parents[1] / ".tuning-cache"
MAX_CACHED_BEAMS = 16


def _install_normalizer_caches() -> None:
    """Memoize the pure text-normalizer entry points used inside recognition.

    normalize_prediction_text and is_uncorrected_oov are deterministic per
    input but run an expensive segmentation DP every call; replaying thousands
    of smoothing configs re-normalizes the same beam texts endlessly without
    these caches.
    """
    import inference.recognition as recognition
    from inference.text_normalizer import is_uncorrected_oov as raw_oov

    @lru_cache(maxsize=500_000)
    def cached_oov(text: str, *, min_chars: int) -> bool:
        return raw_oov(text, min_chars=min_chars)

    recognition.normalize_prediction_text = _normalized
    recognition.is_uncorrected_oov = cached_oov


@dataclass(frozen=True)
class StreamConfig:
    min_frames: int = 18
    stride: int = 3
    window: int = 192


@dataclass(frozen=True)
class TraceCase:
    trace: str
    recording_id: str
    label: str
    frames: list[LandmarkFrame]


@dataclass(frozen=True)
class CachedWindow:
    end: int
    emissions: np.ndarray
    greedy_text: str
    blank_ratio: float
    tail_blank_ratio: float
    tail_blank_frames: int
    frame_confidence: float


@dataclass(frozen=True)
class CachedCase:
    trace: str
    recording_id: str
    label: str
    n_frames: int
    windows: tuple[CachedWindow, ...]
    full: CachedWindow


@dataclass(frozen=True)
class DecodedWindow:
    """Raw scored beams for one window: (text, logit_score, lm_score).

    Only the top MAX_CACHED_BEAMS texts are kept; `tail_scores` preserves the
    remaining beams' combined scores so the confidence softmax matches a full
    production decode exactly.
    """

    end: int
    beams: tuple[tuple[str, float, float], ...]
    tail_scores: tuple[float, ...]
    greedy_text: str
    blank_ratio: float
    tail_blank_ratio: float
    tail_blank_frames: int
    frame_confidence: float


@dataclass(frozen=True)
class DecodedCase:
    trace: str
    recording_id: str
    label: str
    n_frames: int
    windows: tuple[DecodedWindow, ...]
    full: DecodedWindow


@dataclass(frozen=True)
class CaseOutcome:
    trace: str
    recording_id: str
    label: str
    committed: bool
    text: str
    correct: bool


@dataclass
class ReplayScore:
    cases: int = 0
    committed_correct: int = 0
    committed_wrong: int = 0
    uncommitted: int = 0
    outcomes: list[CaseOutcome] = field(default_factory=list)

    @property
    def accuracy(self) -> float:
        return self.committed_correct / self.cases if self.cases else 0.0

    @property
    def false_commit_rate(self) -> float:
        return self.committed_wrong / self.cases if self.cases else 0.0

    @property
    def objective(self) -> float:
        if not self.cases:
            return 0.0
        return (self.committed_correct - 2 * self.committed_wrong) / self.cases


def trace_paths(traces_dir: Path) -> list[Path]:
    paths = []
    for path in sorted(traces_dir.glob("*.json")):
        try:
            head = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue
        if head.get("schemaVersion") == 3 and head.get("recordings"):
            paths.append(path)
    return paths


def load_cases(trace_path: Path) -> list[TraceCase]:
    trace = json.loads(trace_path.read_text())
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
            cases.append(TraceCase(trace_path.stem, recording.get("id", ""), label, frames))
    return cases


def stream_config(trace_path: Path) -> StreamConfig:
    trace = json.loads(trace_path.read_text())
    stream = trace.get("config", {}).get("stream", {})
    decode = trace.get("config", {}).get("decode", {})
    return StreamConfig(
        min_frames=int(stream.get("min", 18)),
        stride=int(stream.get("stride", 3)),
        window=int(decode.get("window", 192)),
    )


def window_ends(n_frames: int, stream: StreamConfig) -> list[int]:
    return list(range(stream.min_frames, n_frames + 1, stream.stride))


def case_cache_path(case: TraceCase) -> Path:
    return CACHE_DIR / case.trace / f"{case.recording_id}.npz"


def save_case_cache(case: TraceCase, windows: list[CachedWindow], full: CachedWindow) -> None:
    path = case_cache_path(case)
    path.parent.mkdir(parents=True, exist_ok=True)
    arrays: dict[str, np.ndarray] = {}
    meta: list[dict[str, Any]] = []
    for tag, window in (("full", full), *((f"w{w.end}", w) for w in windows)):
        arrays[tag] = window.emissions.astype(np.float32)
        meta.append(
            {
                "tag": tag,
                "end": window.end,
                "greedy_text": window.greedy_text,
                "blank_ratio": window.blank_ratio,
                "tail_blank_ratio": window.tail_blank_ratio,
                "tail_blank_frames": window.tail_blank_frames,
                "frame_confidence": window.frame_confidence,
            }
        )
    arrays["__meta__"] = np.array(
        json.dumps({"label": case.label, "n_frames": len(case.frames), "windows": meta})
    )
    np.savez_compressed(path, **arrays)


def load_case_cache(path: Path) -> CachedCase:
    with np.load(path, allow_pickle=False) as data:
        meta = json.loads(str(data["__meta__"]))
        windows: list[CachedWindow] = []
        full: CachedWindow | None = None
        for entry in meta["windows"]:
            window = CachedWindow(
                end=int(entry["end"]),
                emissions=data[entry["tag"]],
                greedy_text=entry["greedy_text"],
                blank_ratio=float(entry["blank_ratio"]),
                tail_blank_ratio=float(entry["tail_blank_ratio"]),
                tail_blank_frames=int(entry["tail_blank_frames"]),
                frame_confidence=float(entry["frame_confidence"]),
            )
            if entry["tag"] == "full":
                full = window
            else:
                windows.append(window)
    if full is None:
        raise ValueError(f"cache missing full-segment window: {path}")
    windows.sort(key=lambda item: item.end)
    return CachedCase(
        trace=path.parent.name,
        recording_id=path.stem,
        label=meta["label"],
        n_frames=int(meta["n_frames"]),
        windows=tuple(windows),
        full=full,
    )


def load_all_cached_cases(cache_dir: Path = CACHE_DIR) -> list[CachedCase]:
    return list(iter_cached_cases(cache_dir))


def iter_cached_cases(cache_dir: Path = CACHE_DIR) -> Iterator[CachedCase]:
    for path in sorted(cache_dir.glob("*/*.npz")):
        yield load_case_cache(path)


@dataclass(frozen=True)
class DecoderParams:
    alpha: float = 1.2
    beta: float = 2.0
    unk_score_offset: float = -10.0
    beam_width: int = 50
    beam_prune_logp: float = -10.0
    token_min_logp: float = -5.0
    hotwords: tuple[str, ...] = ()
    hotword_weight: float = 10.0

    def key(self) -> str:
        return (
            f"a{self.alpha}_b{self.beta}_u{self.unk_score_offset}"
            f"_w{self.beam_width}_p{self.beam_prune_logp}_t{self.token_min_logp}"
        )


class BatchDecoder:
    """Owns one pyctcdecode decoder; re-decodes cached emissions per param set."""

    def __init__(self) -> None:
        base = CtcDecoderConfig.from_env()
        self._decoder = build_decoder(base)
        self._params = DecoderParams(base.alpha, base.beta, base.unk_score_offset)

    def decode_case(self, case: CachedCase, params: DecoderParams) -> DecodedCase:
        if (
            params.alpha != self._params.alpha
            or params.beta != self._params.beta
            or params.unk_score_offset != self._params.unk_score_offset
        ):
            self._decoder.reset_params(
                alpha=params.alpha,
                beta=params.beta,
                unk_score_offset=params.unk_score_offset,
            )
            self._params = DecoderParams(
                params.alpha,
                params.beta,
                params.unk_score_offset,
                params.beam_width,
                params.beam_prune_logp,
                params.token_min_logp,
            )
        windows = tuple(self._decode_window(w, params) for w in case.windows)
        full = self._decode_window(case.full, params)
        return DecodedCase(case.trace, case.recording_id, case.label, case.n_frames, windows, full)

    def _decode_window(self, window: CachedWindow, params: DecoderParams) -> DecodedWindow:
        beams = self._decoder.decode_beams(
            window.emissions,
            beam_width=params.beam_width,
            beam_prune_logp=params.beam_prune_logp,
            token_min_logp=params.token_min_logp,
            hotwords=list(params.hotwords) or None,
            hotword_weight=params.hotword_weight,
        )
        scored: list[tuple[str, float, float]] = []
        tail_scores: list[float] = []
        for beam in beams:
            text = _beam_text(beam).strip()
            if not text:
                continue
            logit, lm = _beam_logit_score(beam), _beam_lm_score(beam)
            if len(scored) < MAX_CACHED_BEAMS:
                scored.append((text, logit, lm))
            else:
                tail_scores.append(logit + lm)
        return DecodedWindow(
            end=window.end,
            beams=tuple(scored),
            tail_scores=tuple(tail_scores),
            greedy_text=window.greedy_text,
            blank_ratio=window.blank_ratio,
            tail_blank_ratio=window.tail_blank_ratio,
            tail_blank_frames=window.tail_blank_frames,
            frame_confidence=window.frame_confidence,
        )


def _beam_text(beam: object) -> str:
    text = getattr(beam, "text", None)
    if text is not None:
        return str(text)
    return str(beam[0])  # type: ignore[index]


def _beam_logit_score(beam: object) -> float:
    score = getattr(beam, "logit_score", None)
    if score is not None:
        return float(score)
    return float(beam[3])  # type: ignore[index]


def _beam_lm_score(beam: object) -> float:
    score = getattr(beam, "lm_score", None)
    if score is not None:
        return float(score)
    return float(beam[4])  # type: ignore[index]


@lru_cache(maxsize=200_000)
def _normalized(text: str) -> str:
    from inference.text_normalizer import normalize_prediction_text

    return normalize_prediction_text(text)


def build_predict_out(window: DecodedWindow, confidence_temperature: float) -> PredictOut:
    """Mirror ctc.decode_alternatives tail + runtime.decode_emission +

    model.decoded_to_predict_out, applying temperature post hoc to cached beams.
    """
    scored = [(text, logit + lm, logit, lm) for text, logit, lm in window.beams]
    all_scores = [score for _, score, *_ in scored] + list(window.tail_scores)
    weights = softmax(
        np.asarray([score / confidence_temperature for score in all_scores], dtype=np.float64)
    )[: len(scored)]
    alternatives: list[tuple[str, float, float, float]] = []
    seen: set[str] = set()
    for (text, _score, logit, lm), confidence in sorted(
        zip(scored, weights.tolist(), strict=False),
        key=lambda item: item[0][1],
        reverse=True,
    ):
        if text in seen:
            continue
        seen.add(text)
        alternatives.append((text, float(confidence), logit, lm))
        if len(alternatives) == 5:
            break

    if not alternatives:
        best_text, best_conf, best_logit, best_lm = "", 0.0, 0.0, 0.0
    else:
        best_text, best_conf, best_logit, best_lm = alternatives[0]

    label = _normalized(_normalized(best_text))
    confidence = float(np.clip(best_conf * window.frame_confidence, 0.0, 1.0))
    return PredictOut(
        prediction=Prediction(
            label=label,
            confidence=confidence,
            logit_score=best_logit if alternatives else None,
            lm_score=best_lm if alternatives else None,
            raw_label=best_text if alternatives else None,
        ),
        alternatives=[
            Prediction(
                label=text,
                confidence=float(np.clip(conf * window.frame_confidence, 0.0, 1.0)),
                logit_score=logit,
                lm_score=lm,
                raw_label=text,
            )
            for text, conf, logit, lm in alternatives[1:]
        ],
        spans=[],
        greedy_text=window.greedy_text,
        blank_ratio=float(np.clip(window.blank_ratio, 0.0, 1.0)),
        tail_blank_ratio=float(np.clip(window.tail_blank_ratio, 0.0, 1.0)),
        tail_blank_frames=window.tail_blank_frames,
        partial_text=label,
        stable_text="",
    )


@dataclass(frozen=True)
class PreparedCase:
    trace: str
    recording_id: str
    label: str
    n_frames: int
    windows: tuple[tuple[int, PredictOut], ...]
    full: PredictOut


def prepare_cases(
    decoded: list[DecodedCase],
    confidence_temperature: float,
) -> list[PreparedCase]:
    prepared: list[PreparedCase] = []
    for case in decoded:
        prepared.append(
            PreparedCase(
                trace=case.trace,
                recording_id=case.recording_id,
                label=case.label,
                n_frames=case.n_frames,
                windows=tuple(
                    (w.end, build_predict_out(w, confidence_temperature)) for w in case.windows
                ),
                full=build_predict_out(case.full, confidence_temperature),
            )
        )
    return prepared


def replay_case(case: PreparedCase, smooth: SmoothConfig, *, endpoint: bool = True) -> CaseOutcome:
    state = empty_state()
    for end, prediction in case.windows:
        context = RecognitionContext(idle_frames=0, missing_frames=0, segment_frames=end, motion=0)
        out = accept_prediction(state, prediction, context, end, 0, smooth)
        state = out.state
    if endpoint:
        context = RecognitionContext(
            idle_frames=0, missing_frames=0, segment_frames=case.n_frames, motion=0
        )
        state, _ = accept_endpoint_prediction(state, case.full, context, case.n_frames, 0, smooth)
    out = finalize(
        state,
        RecognitionContext(
            idle_frames=0,
            missing_frames=0,
            segment_frames=case.n_frames,
            motion=0,
            endpoint_reason=EndpointReason.idle,
        ),
        smooth,
    )
    text = clean(out.display_prediction.label) if out.display_prediction else ""
    return CaseOutcome(
        trace=case.trace,
        recording_id=case.recording_id,
        label=case.label,
        committed=out.committed,
        text=text if out.committed else "",
        correct=out.committed and text == case.label,
    )


def replay_all(
    cases: list[PreparedCase],
    smooth: SmoothConfig,
    *,
    endpoint: bool = True,
    keep_outcomes: bool = False,
) -> ReplayScore:
    score = ReplayScore()
    for case in cases:
        outcome = replay_case(case, smooth, endpoint=endpoint)
        score.cases += 1
        if outcome.correct:
            score.committed_correct += 1
        elif outcome.committed:
            score.committed_wrong += 1
        else:
            score.uncommitted += 1
        if keep_outcomes:
            score.outcomes.append(outcome)
    return score


def oracle_stats(decoded: list[DecodedCase]) -> dict[str, float]:
    """Ceiling metrics for a decoder param set, independent of smoothing."""
    n = len(decoded)
    if not n:
        return {"top1_full": 0.0, "any_beam": 0.0, "top1_any_window": 0.0}
    top1_full = 0
    any_beam = 0
    top1_any_window = 0
    for case in decoded:
        full_best = _normalized_clean(case.full.beams[0][0]) if case.full.beams else ""
        if full_best == case.label:
            top1_full += 1
        tops = {_normalized_clean(w.beams[0][0]) for w in case.windows if w.beams} | {full_best}
        if case.label in tops:
            top1_any_window += 1
        hit = False
        for window in (*case.windows, case.full):
            for rank, (text, _logit, _lm) in enumerate(window.beams):
                # Normalizing every beam is expensive; raw match or top-3
                # normalized is a tight-enough reachability ceiling.
                if clean(text) == case.label or (
                    rank < 3 and _normalized_clean(text) == case.label
                ):
                    hit = True
                    break
            if hit:
                break
        if hit:
            any_beam += 1
    return {
        "top1_full": top1_full / n,
        "any_beam": any_beam / n,
        "top1_any_window": top1_any_window / n,
    }


def _normalized_clean(text: str) -> str:
    return clean(_normalized(text))


_install_normalizer_caches()

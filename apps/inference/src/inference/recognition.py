from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from os import getenv
from time import perf_counter

from inference.model import ModelBackend
from inference.schemas import (
    DecodeTrace,
    EndpointReason,
    FinalizeTrace,
    Prediction,
    PredictOut,
    RecognitionContext,
    RecognitionCount,
    RecognitionScored,
    RecognitionState,
    RecognitionTrace,
    RecognizeIn,
    RecognizeOut,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SmoothConfig:
    display_confidence: float = 0.06
    display_streak: int = 2
    display_count: int = 2
    instant_display_confidence: float = 0.45
    commit_confidence: float = 0.14
    commit_streak: int = 3
    commit_count: int = 3
    replace_margin: float = 0.08

    @classmethod
    def from_env(cls) -> SmoothConfig:
        return cls(
            display_confidence=_env_float("DISPLAY_MIN_CONFIDENCE", cls.display_confidence),
            display_streak=_env_int("DISPLAY_MIN_STREAK", cls.display_streak),
            display_count=_env_int("DISPLAY_MIN_COUNT", cls.display_count),
            instant_display_confidence=_env_float(
                "DISPLAY_INSTANT_CONFIDENCE", cls.instant_display_confidence
            ),
            commit_confidence=_env_float("COMMIT_MIN_CONFIDENCE", cls.commit_confidence),
            commit_streak=_env_int("COMMIT_MIN_STREAK", cls.commit_streak),
            commit_count=_env_int("COMMIT_MIN_COUNT", cls.commit_count),
            replace_margin=_env_float("DISPLAY_REPLACE_MARGIN", cls.replace_margin),
        )


def empty_state() -> RecognitionState:
    return RecognitionState(
        display=None,
        final_candidate=None,
        selected_text="",
        selected_streak=0,
        display_misses=0,
        counts=[],
    )


async def recognize(payload: RecognizeIn, backend: ModelBackend) -> RecognizeOut:
    config = SmoothConfig.from_env()
    state = payload.state or empty_state()
    if payload.finalize:
        return finalize(state, payload.context, config)

    frames = list(payload.frames or [])
    if not frames:
        return RecognizeOut(
            state=state,
            display_prediction=state.display.prediction if state.display else None,
            committed=False,
            trace=RecognitionTrace(),
        )

    started = perf_counter()
    prediction = await backend.predict_frames(frames)
    latency_ms = (perf_counter() - started) * 1_000
    return accept_prediction(
        state,
        prediction,
        payload.context,
        len(frames),
        latency_ms,
        config,
    )


def accept_prediction(
    state: RecognitionState,
    response: PredictOut,
    context: RecognitionContext,
    buffered_frames: int,
    latency_ms: float,
    config: SmoothConfig | None = None,
) -> RecognizeOut:
    config = config or SmoothConfig.from_env()
    state = state.model_copy(deep=True)
    text = clean(response.prediction.label)
    if text:
        state = accept_text(state, response, text, config)

    display_text = state.display.prediction.label if state.display else ""
    trace = DecodeTrace(
        buffered_frames=buffered_frames,
        input_text=clean(response.prediction.raw_label or response.prediction.label),
        display_text=display_text,
        idle_frames=context.idle_frames,
        motion=context.motion,
        latency_ms=latency_ms,
    )
    logger.info(
        "recognition.decode",
        extra={
            "frames": buffered_frames,
            "latency_ms": latency_ms,
            "input_text": trace.input_text,
            "display_text": display_text,
            "greedy_text": response.greedy_text,
            "blank_ratio": response.blank_ratio,
            "tail_blank_frames": response.tail_blank_frames,
            "alternatives": [item.label for item in response.alternatives],
        },
    )
    return RecognizeOut(
        state=state,
        display_prediction=state.display.prediction if state.display else None,
        committed=False,
        trace=RecognitionTrace(prediction=response, decode=trace),
    )


def finalize(
    state: RecognitionState,
    context: RecognitionContext,
    config: SmoothConfig | None = None,
) -> RecognizeOut:
    config = config or SmoothConfig.from_env()
    selected = state.final_candidate or state.display
    prediction = None
    committed = False
    if selected:
        prediction = selected.prediction
        committed = should_commit(selected, count_for(state, prediction.label), config)
    display = prediction if committed else None
    reason = context.endpoint_reason or EndpointReason.idle
    trace = FinalizeTrace(
        text=prediction.label if prediction else "",
        confidence=prediction.confidence if prediction else 0,
        committed=committed,
        endpoint_reason=reason,
        segment_frames=context.segment_frames,
    )
    logger.info(
        "recognition.finalize",
        extra={
            "text": trace.text,
            "confidence": trace.confidence,
            "committed": committed,
            "endpoint_reason": reason.value,
            "segment_frames": context.segment_frames,
        },
    )
    return RecognizeOut(
        state=empty_state(),
        display_prediction=display,
        committed=committed,
        trace=RecognitionTrace(finalize=trace),
    )


def accept_text(
    state: RecognitionState,
    response: PredictOut,
    text: str,
    config: SmoothConfig,
) -> RecognitionState:
    seen = count_for(state, text) + 1
    streak = state.selected_streak + 1 if state.selected_text == text else 1
    scored = RecognitionScored(
        prediction=Prediction(
            label=text,
            confidence=response.prediction.confidence,
            logit_score=response.prediction.logit_score,
            lm_score=response.prediction.lm_score,
            raw_label=clean(response.prediction.raw_label or text),
        ),
        score=response.prediction.confidence + min(seen, 5) * 0.05 + min(streak, 4) * 0.05,
        source="beam",
        lm_score=response.prediction.lm_score,
        model_agrees=clean(response.greedy_text) == text,
        streak=streak,
    )

    state.counts = set_count(state.counts, text, seen)
    state.selected_text = text
    state.selected_streak = streak
    state.final_candidate = pick_final(state.final_candidate, scored, seen, config)

    if state.display and state.display.prediction.label == text:
        state.display = merge_same(state.display, scored)
        state.display_misses = 0
        return state

    misses = state.display_misses + 1 if state.display else 0
    if should_display(scored, state.display, seen, streak, misses, config):
        state.display = scored
        state.display_misses = 0
    else:
        state.display_misses = misses
    return state


def should_display(
    candidate: RecognitionScored,
    display: RecognitionScored | None,
    seen: int,
    streak: int,
    misses: int,
    config: SmoothConfig,
) -> bool:
    confidence = candidate.prediction.confidence
    stable = (
        confidence >= config.display_confidence
        and seen >= config.display_count
        and streak >= config.display_streak
    )
    if display is None:
        return stable or confidence >= config.instant_display_confidence
    if not stable and misses < 3:
        return False
    return confidence >= display.prediction.confidence + config.replace_margin


def pick_final(
    current: RecognitionScored | None,
    candidate: RecognitionScored,
    seen: int,
    config: SmoothConfig,
) -> RecognitionScored | None:
    if not should_commit(candidate, seen, config):
        return current
    if current is None:
        return candidate
    if current.prediction.label == candidate.prediction.label:
        return merge_same(current, candidate)
    return candidate if candidate.score > current.score + config.replace_margin else current


def should_commit(
    candidate: RecognitionScored,
    seen: int,
    config: SmoothConfig | None = None,
) -> bool:
    config = config or SmoothConfig.from_env()
    return (
        candidate.prediction.confidence >= config.commit_confidence
        and seen >= config.commit_count
        and candidate.streak >= config.commit_streak
    )


def merge_same(
    current: RecognitionScored,
    candidate: RecognitionScored,
) -> RecognitionScored:
    return RecognitionScored(
        prediction=Prediction(
            label=candidate.prediction.label,
            confidence=max(current.prediction.confidence, candidate.prediction.confidence),
            logit_score=candidate.prediction.logit_score,
            lm_score=candidate.prediction.lm_score,
            raw_label=candidate.prediction.raw_label,
        ),
        score=max(current.score, candidate.score),
        source=candidate.source,
        lm_score=max_nullable(current.lm_score, candidate.lm_score),
        model_agrees=current.model_agrees or candidate.model_agrees,
        streak=max(current.streak, candidate.streak),
    )


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", "", text.lower())).strip()


def count_for(state: RecognitionState, text: str) -> int:
    for item in state.counts:
        if item.text == text:
            return item.count
    return 0


def set_count(
    counts: Sequence[RecognitionCount],
    text: str,
    count: int,
) -> list[RecognitionCount]:
    return [
        *(
            RecognitionCount(text=item.text, count=item.count)
            for item in counts
            if item.text != text
        ),
        RecognitionCount(text=text, count=count),
    ]


def max_nullable(left: float | None, right: float | None) -> float | None:
    if left is None:
        return right
    if right is None:
        return left
    return max(left, right)


def _env_float(name: str, default: float) -> float:
    value = getenv(name)
    return float(value) if value else default


def _env_int(name: str, default: int) -> int:
    value = getenv(name)
    return int(value) if value else default

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
from inference.text_normalizer import is_uncorrected_oov, normalize_prediction_text

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SmoothConfig:
    display_confidence: float = 0.06
    display_streak: int = 2
    display_count: int = 2
    display_clear_misses: int = 2
    display_clear_motion: float = 0.003
    instant_display_confidence: float = 0.45
    commit_confidence: float = 0.85
    short_commit_confidence: float = 0.96
    commit_streak: int = 3
    commit_count: int = 3
    endpoint_commit_count: int = 2
    commit_soft_oov_min_chars: int = 6
    commit_soft_oov_confidence: float = 0.95
    commit_reject_uncorrected_oov_chars: int = 7
    stable_commit_confidence: float = 0.8
    stable_commit_count: int = 10
    stable_commit_streak: int = 10
    stable_commit_min_chars: int = 4
    short_stable_commit_confidence: float = 0.8
    short_stable_commit_count: int = 12
    short_stable_commit_streak: int = 12
    short_stable_commit_min_chars: int = 2
    short_stable_commit_max_chars: int = 3
    alternative_commit_confidence: float = 0.25
    alternative_commit_count: int = 20
    alternative_commit_min_chars: int = 4
    alternative_commit_recent_misses: int = 5
    replace_margin: float = 0.0

    @classmethod
    def from_env(cls) -> SmoothConfig:
        return cls(
            display_confidence=_env_float("DISPLAY_MIN_CONFIDENCE", cls.display_confidence),
            display_streak=_env_int("DISPLAY_MIN_STREAK", cls.display_streak),
            display_count=_env_int("DISPLAY_MIN_COUNT", cls.display_count),
            display_clear_misses=_env_int("DISPLAY_CLEAR_MISSES", cls.display_clear_misses),
            display_clear_motion=_env_float("DISPLAY_CLEAR_MOTION", cls.display_clear_motion),
            instant_display_confidence=_env_float(
                "DISPLAY_INSTANT_CONFIDENCE", cls.instant_display_confidence
            ),
            commit_confidence=_env_float("COMMIT_MIN_CONFIDENCE", cls.commit_confidence),
            short_commit_confidence=_env_float(
                "SHORT_COMMIT_MIN_CONFIDENCE",
                cls.short_commit_confidence,
            ),
            commit_streak=_env_int("COMMIT_MIN_STREAK", cls.commit_streak),
            commit_count=_env_int("COMMIT_MIN_COUNT", cls.commit_count),
            endpoint_commit_count=_env_int(
                "ENDPOINT_COMMIT_MIN_COUNT",
                cls.endpoint_commit_count,
            ),
            commit_soft_oov_min_chars=_env_int(
                "COMMIT_SOFT_OOV_MIN_CHARS",
                cls.commit_soft_oov_min_chars,
            ),
            commit_soft_oov_confidence=_env_float(
                "COMMIT_SOFT_OOV_MIN_CONFIDENCE",
                cls.commit_soft_oov_confidence,
            ),
            commit_reject_uncorrected_oov_chars=_env_int(
                "COMMIT_REJECT_UNCORRECTED_OOV_CHARS",
                cls.commit_reject_uncorrected_oov_chars,
            ),
            stable_commit_confidence=_env_float(
                "STABLE_COMMIT_MIN_CONFIDENCE",
                cls.stable_commit_confidence,
            ),
            stable_commit_count=_env_int(
                "STABLE_COMMIT_MIN_COUNT",
                cls.stable_commit_count,
            ),
            stable_commit_streak=_env_int(
                "STABLE_COMMIT_MIN_STREAK",
                cls.stable_commit_streak,
            ),
            stable_commit_min_chars=_env_int(
                "STABLE_COMMIT_MIN_CHARS",
                cls.stable_commit_min_chars,
            ),
            short_stable_commit_confidence=_env_float(
                "SHORT_STABLE_COMMIT_MIN_CONFIDENCE",
                cls.short_stable_commit_confidence,
            ),
            short_stable_commit_count=_env_int(
                "SHORT_STABLE_COMMIT_MIN_COUNT",
                cls.short_stable_commit_count,
            ),
            short_stable_commit_streak=_env_int(
                "SHORT_STABLE_COMMIT_MIN_STREAK",
                cls.short_stable_commit_streak,
            ),
            short_stable_commit_min_chars=_env_int(
                "SHORT_STABLE_COMMIT_MIN_CHARS",
                cls.short_stable_commit_min_chars,
            ),
            short_stable_commit_max_chars=_env_int(
                "SHORT_STABLE_COMMIT_MAX_CHARS",
                cls.short_stable_commit_max_chars,
            ),
            alternative_commit_confidence=_env_float(
                "ALTERNATIVE_COMMIT_MIN_CONFIDENCE",
                cls.alternative_commit_confidence,
            ),
            alternative_commit_count=_env_int(
                "ALTERNATIVE_COMMIT_MIN_COUNT",
                cls.alternative_commit_count,
            ),
            alternative_commit_min_chars=_env_int(
                "ALTERNATIVE_COMMIT_MIN_CHARS",
                cls.alternative_commit_min_chars,
            ),
            alternative_commit_recent_misses=_env_int(
                "ALTERNATIVE_COMMIT_RECENT_MISSES",
                cls.alternative_commit_recent_misses,
            ),
            replace_margin=_env_float("DISPLAY_REPLACE_MARGIN", cls.replace_margin),
        )


def empty_state() -> RecognitionState:
    return RecognitionState(
        display=None,
        final_candidate=None,
        alternative_candidate=None,
        selected_text="",
        selected_streak=0,
        display_misses=0,
        counts=[],
        alternative_counts=[],
        alternative_misses=0,
    )


async def recognize(payload: RecognizeIn, backend: ModelBackend) -> RecognizeOut:
    config = SmoothConfig.from_env()
    state = payload.state or empty_state()
    if payload.finalize:
        prediction = None
        decode = None
        frames = list(payload.frames or [])
        if frames and payload.state is not None:
            started = perf_counter()
            prediction = await backend.predict_frames(frames)
            latency_ms = (perf_counter() - started) * 1_000
            state, decode = accept_endpoint_prediction(
                state,
                prediction,
                payload.context,
                len(frames),
                latency_ms,
                config,
            )
        out = finalize(state, payload.context, config)
        return out.model_copy(
            update={
                "trace": RecognitionTrace(
                    prediction=prediction,
                    decode=decode,
                    finalize=out.trace.finalize,
                )
            }
        )

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
    else:
        state = accept_blank(state, context, config)
    state = accept_alternative_predictions(state, response, config)

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


def accept_endpoint_prediction(
    state: RecognitionState,
    response: PredictOut,
    context: RecognitionContext,
    buffered_frames: int,
    latency_ms: float,
    config: SmoothConfig | None = None,
) -> tuple[RecognitionState, DecodeTrace]:
    config = config or SmoothConfig.from_env()
    state = state.model_copy(deep=True)
    text = clean(response.prediction.label)
    trace = DecodeTrace(
        buffered_frames=buffered_frames,
        input_text=clean(response.prediction.raw_label or response.prediction.label),
        display_text=state.display.prediction.label if state.display else "",
        idle_frames=context.idle_frames,
        motion=context.motion,
        latency_ms=latency_ms,
    )
    if not should_accept_endpoint(text, response.prediction.confidence, state, config):
        return state, trace

    seen = count_for(state, text) + 1
    state.counts = set_count(state.counts, text, max(seen, config.commit_count))
    scored = RecognitionScored(
        prediction=Prediction(
            label=text,
            confidence=response.prediction.confidence,
            logit_score=response.prediction.logit_score,
            lm_score=response.prediction.lm_score,
            raw_label=clean(response.prediction.raw_label or text),
        ),
        score=(
            response.prediction.confidence
            + min(seen, 5) * 0.05
            + min(config.commit_streak, 4) * 0.05
        ),
        source="endpoint",
        lm_score=response.prediction.lm_score,
        model_agrees=clean(response.greedy_text) == text,
        streak=config.commit_streak,
    )
    state.final_candidate = pick_final(state.final_candidate, scored, seen, config)
    return state, trace


def finalize(
    state: RecognitionState,
    context: RecognitionContext,
    config: SmoothConfig | None = None,
) -> RecognizeOut:
    config = config or SmoothConfig.from_env()
    selected = select_final(state, config)
    prediction = None
    committed = False
    if selected:
        prediction = selected.prediction
        committed = should_commit(selected, count_for_candidate(state, selected), config)
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
    elif should_clear_display(scored, state.display, misses, config):
        if state.final_candidate and not compatible_text(
            state.final_candidate.prediction.label,
            scored.prediction.label,
        ):
            state.final_candidate = None
        state.display = None
        state.display_misses = 0
    else:
        state.display_misses = misses
    return state


def accept_blank(
    state: RecognitionState,
    context: RecognitionContext,
    config: SmoothConfig,
) -> RecognitionState:
    if not state.display:
        return state
    misses = state.display_misses + 1
    if (
        misses >= config.display_clear_misses
        and context.idle_frames == 0
        and context.motion >= config.display_clear_motion
    ):
        state.display = None
        state.final_candidate = None
        state.alternative_candidate = None
        state.alternative_misses = 0
        state.display_misses = 0
    else:
        state.display_misses = misses
    return state


def accept_alternative_predictions(
    state: RecognitionState,
    response: PredictOut,
    config: SmoothConfig,
) -> RecognitionState:
    candidates = ranked_current_candidates(response)
    present = {text for text, _, _ in candidates}
    state = age_alternative_candidate(state, present, config)
    counts = list(state.alternative_counts or [])

    for text, prediction, rank in candidates:
        seen = count_in(counts, text) + 1
        counts = set_count(counts, text, seen)
        scored = alternative_scored(response, prediction, text, seen, rank)
        if should_remember_alternative_candidate(scored, seen, rank, config):
            state.alternative_candidate = pick_alternative_candidate(
                state.alternative_candidate,
                scored,
                config,
            )
            state.alternative_misses = 0

    state.alternative_counts = counts
    return state


def ranked_current_candidates(response: PredictOut) -> tuple[tuple[str, Prediction, int], ...]:
    best_by_text: dict[str, tuple[Prediction, int]] = {}
    for rank, prediction in enumerate((response.prediction, *response.alternatives)):
        text = clean(normalize_prediction_text(prediction.label))
        if not text:
            continue
        current = best_by_text.get(text)
        if current is None:
            best_by_text[text] = (prediction, rank)
            continue
        best_prediction, best_rank = current
        best_by_text[text] = (
            prediction if prediction.confidence > best_prediction.confidence else best_prediction,
            min(rank, best_rank),
        )
    return tuple((text, prediction, rank) for text, (prediction, rank) in best_by_text.items())


def age_alternative_candidate(
    state: RecognitionState,
    present: set[str],
    config: SmoothConfig,
) -> RecognitionState:
    if state.alternative_candidate is None:
        state.alternative_misses = 0
        return state
    if state.alternative_candidate.prediction.label in present:
        state.alternative_misses = 0
        return state

    misses = (state.alternative_misses or 0) + 1
    if misses > config.alternative_commit_recent_misses:
        state.alternative_candidate = None
        state.alternative_misses = 0
    else:
        state.alternative_misses = misses
    return state


def alternative_scored(
    response: PredictOut,
    prediction: Prediction,
    text: str,
    seen: int,
    rank: int,
) -> RecognitionScored:
    return RecognitionScored(
        prediction=Prediction(
            label=text,
            confidence=prediction.confidence,
            logit_score=prediction.logit_score,
            lm_score=prediction.lm_score,
            raw_label=clean(prediction.raw_label or prediction.label),
        ),
        score=prediction.confidence + min(seen, 20) * 0.06 - rank * 0.02,
        source="alternative",
        lm_score=prediction.lm_score,
        model_agrees=clean(response.greedy_text) == text,
        streak=seen,
    )


def should_remember_alternative_candidate(
    candidate: RecognitionScored,
    seen: int,
    rank: int,
    config: SmoothConfig,
) -> bool:
    text = candidate.prediction.label
    text_len = len(clean(text).replace(" ", ""))
    return (
        rank == 0
        and text_len >= config.alternative_commit_min_chars
        and seen >= config.alternative_commit_count
        and candidate.prediction.confidence >= config.alternative_commit_confidence
        and not is_uncorrected_oov(
            text,
            min_chars=config.commit_reject_uncorrected_oov_chars,
        )
        and not is_low_confidence_soft_oov(text, candidate.prediction.confidence, config)
    )


def pick_alternative_candidate(
    current: RecognitionScored | None,
    candidate: RecognitionScored,
    config: SmoothConfig,
) -> RecognitionScored:
    if current is None:
        return candidate
    if current.prediction.label == candidate.prediction.label:
        return merge_same(current, candidate)
    return candidate if candidate.score > current.score + config.replace_margin else current


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
    if not stable:
        return False
    if misses >= config.display_clear_misses:
        return True
    return confidence >= display.prediction.confidence + config.replace_margin


def should_clear_display(
    candidate: RecognitionScored,
    display: RecognitionScored | None,
    misses: int,
    config: SmoothConfig,
) -> bool:
    if display is None or misses < config.display_clear_misses:
        return False
    if candidate.prediction.confidence < config.display_confidence:
        return False
    return not compatible_text(display.prediction.label, candidate.prediction.label)


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


def select_final(state: RecognitionState, config: SmoothConfig) -> RecognitionScored | None:
    selected = select_primary_final(state, config)
    if selected and should_commit(selected, count_for_candidate(state, selected), config):
        return selected
    alternative = state.alternative_candidate
    if alternative and should_commit(
        alternative,
        count_for_candidate(state, alternative),
        config,
    ):
        return alternative
    return selected


def select_primary_final(
    state: RecognitionState,
    config: SmoothConfig,
) -> RecognitionScored | None:
    selected = state.final_candidate
    display = state.display
    if selected is None:
        return display
    if display is None:
        return selected
    if selected.prediction.label == display.prediction.label:
        return merge_same(selected, display)
    if not should_commit(display, count_for(state, display.prediction.label), config):
        return selected
    if not compatible_text(selected.prediction.label, display.prediction.label):
        return display
    if display.score > selected.score + config.replace_margin:
        return display
    return selected


def should_commit(
    candidate: RecognitionScored,
    seen: int,
    config: SmoothConfig | None = None,
) -> bool:
    config = config or SmoothConfig.from_env()
    text_len = len(clean(candidate.prediction.label).replace(" ", ""))
    confidence = max(
        config.commit_confidence,
        config.short_commit_confidence if 0 < text_len <= 3 else config.commit_confidence,
    )
    confidence_gate = candidate.prediction.confidence >= confidence
    stable_gate = is_stable_model_agreed_candidate(candidate, seen, config)
    short_stable_gate = is_stable_short_model_agreed_candidate(candidate, seen, config)
    alternative_gate = is_stable_alternative_candidate(candidate, seen, config)
    return (
        (confidence_gate or stable_gate or short_stable_gate or alternative_gate)
        and seen >= config.commit_count
        and candidate.streak >= config.commit_streak
        and not is_uncorrected_oov(
            candidate.prediction.label,
            min_chars=config.commit_reject_uncorrected_oov_chars,
        )
        and not is_low_confidence_soft_oov(
            candidate.prediction.label,
            candidate.prediction.confidence,
            config,
        )
    )


def is_stable_alternative_candidate(
    candidate: RecognitionScored,
    seen: int,
    config: SmoothConfig,
) -> bool:
    text_len = len(clean(candidate.prediction.label).replace(" ", ""))
    return (
        candidate.source == "alternative"
        and text_len >= config.alternative_commit_min_chars
        and seen >= config.alternative_commit_count
        and candidate.streak >= config.alternative_commit_count
        and candidate.prediction.confidence >= config.alternative_commit_confidence
    )


def is_stable_short_model_agreed_candidate(
    candidate: RecognitionScored,
    seen: int,
    config: SmoothConfig,
) -> bool:
    text_len = len(clean(candidate.prediction.label).replace(" ", ""))
    return (
        candidate.model_agrees
        and config.short_stable_commit_min_chars
        <= text_len
        <= config.short_stable_commit_max_chars
        and seen >= config.short_stable_commit_count
        and candidate.streak >= config.short_stable_commit_streak
        and candidate.prediction.confidence >= config.short_stable_commit_confidence
    )


def is_stable_model_agreed_candidate(
    candidate: RecognitionScored,
    seen: int,
    config: SmoothConfig,
) -> bool:
    text_len = len(clean(candidate.prediction.label).replace(" ", ""))
    return (
        candidate.model_agrees
        and text_len >= config.stable_commit_min_chars
        and seen >= config.stable_commit_count
        and candidate.streak >= config.stable_commit_streak
        and candidate.prediction.confidence >= config.stable_commit_confidence
    )


def should_accept_endpoint(
    text: str,
    confidence: float,
    state: RecognitionState,
    config: SmoothConfig,
) -> bool:
    if not text or count_for(state, text) < config.endpoint_commit_count:
        return False
    text_len = len(text.replace(" ", ""))
    threshold = max(
        config.commit_confidence,
        config.short_commit_confidence if 0 < text_len <= 3 else config.commit_confidence,
    )
    return (
        confidence >= threshold
        and not is_uncorrected_oov(
            text,
            min_chars=config.commit_reject_uncorrected_oov_chars,
        )
        and not is_low_confidence_soft_oov(text, confidence, config)
    )


def is_low_confidence_soft_oov(
    text: str,
    confidence: float,
    config: SmoothConfig,
) -> bool:
    return (
        confidence < config.commit_soft_oov_confidence
        and is_uncorrected_oov(
            text,
            min_chars=config.commit_soft_oov_min_chars,
        )
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


def compatible_text(left: str, right: str) -> bool:
    left = clean(left).replace(" ", "")
    right = clean(right).replace(" ", "")
    if not left or not right:
        return False
    if left == right or left.rstrip("s") == right.rstrip("s"):
        return True
    if left.startswith(right) or right.startswith(left):
        return True
    return common_prefix_len(left, right) >= min(5, len(left), len(right))


def common_prefix_len(left: str, right: str) -> int:
    count = 0
    for left_char, right_char in zip(left, right, strict=False):
        if left_char != right_char:
            break
        count += 1
    return count


def count_for(state: RecognitionState, text: str) -> int:
    return count_in(state.counts, text)


def count_for_candidate(state: RecognitionState, candidate: RecognitionScored) -> int:
    if candidate.source == "alternative":
        return count_in(state.alternative_counts or [], candidate.prediction.label)
    return count_for(state, candidate.prediction.label)


def count_in(counts: Sequence[RecognitionCount], text: str) -> int:
    for item in counts:
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

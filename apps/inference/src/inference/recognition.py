from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from time import perf_counter

from inference.model import ModelBackend
from inference.recognition_helpers import (
    agrees_with_any,
    bad_alt_tail,
    clean,
    compact,
    count_for,
    format_prediction_text,
    is_alternative,
    is_spaced_variant,
    is_suffix_window,
    kind,
    max_nullable,
    next_streak,
    prefix_len,
    set_count,
    short_finish,
    single_tail,
)
from inference.schemas import (
    DecodeTrace,
    EndpointReason,
    FinalizeTrace,
    Prediction,
    PredictOut,
    RecognitionContext,
    RecognitionScored,
    RecognitionState,
    RecognitionTrace,
    RecognizeIn,
    RecognizeOut,
)

logger = logging.getLogger(__name__)

SOURCE_PARTIAL = "partial"
SOURCE_RAW = "raw"

DISPLAY_THRESHOLDS = {
    "letter": (0.12, 3, 1, 0.05),
    "short": (0.18, 1, 3, 0.10),
    "phrase": (0.20, 1, 1, 0.14),
    "long": (0.22, 1, 2, 0.16),
    "word": (0.18, 1, 1, 0.12),
}

COMMIT_THRESHOLDS = {
    "letter": (0.50, 4, 2, 0.22),
    "short": (0.65, 3, 2, 0.28),
    "phrase": (0.75, 3, 1, 0.29),
    "long": (0.75, 1, 1, 0.32),
    "word": (0.75, 2, 1, 0.28),
}

FINAL_CONFIDENCE = {
    "letter": 0.30,
    "short": 0.55,
    "phrase": 0.45,
    "long": 0.45,
    "word": 0.45,
}


@dataclass(frozen=True)
class CandidateInput:
    source: str
    raw_text: str
    confidence: float
    lm_score: float | None
    model_agrees: bool


@dataclass(frozen=True)
class Candidate:
    source: str
    raw_text: str
    text: str
    confidence: float
    lm_score: float | None
    model_agrees: bool
    score: float


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
    state = payload.state or empty_state()
    if payload.finalize:
        return finalize(state, payload.context)

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
    return accept_prediction(state, prediction, payload.context, len(frames), latency_ms)


def accept_prediction(
    state: RecognitionState,
    response: PredictOut,
    context: RecognitionContext,
    buffered_frames: int,
    latency_ms: float,
) -> RecognizeOut:
    raw_label = response.prediction.label.strip()
    partial_text = response.partial_text.strip()
    previous_display = state.display.prediction.label if state.display else ""
    candidate = select_candidate(response, raw_label, partial_text, previous_display)

    if candidate:
        state = accept_candidate(state, candidate, context, latency_ms)

    display_text = state.display.prediction.label if state.display else ""
    trace = DecodeTrace(
        buffered_frames=buffered_frames,
        input_text=raw_label,
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
            "input_text": raw_label,
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


def finalize(state: RecognitionState, context: RecognitionContext) -> RecognizeOut:
    selected = pick_final_pred(state.display, state.final_candidate)
    prediction = selected.prediction if selected else None
    seen_count = count_for(state, prediction.label) if prediction else 0
    committed = should_commit(selected, seen_count) if selected else False
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


def accept_candidate(
    state: RecognitionState,
    candidate: Candidate,
    context: RecognitionContext,
    latency_ms: float,
) -> RecognitionState:
    seen_count = count_for(state, candidate.text) + 1
    streak = next_streak(state, candidate.text)
    score = candidate.score + min(seen_count, 4) * 0.35
    prediction = Prediction(
        label=format_prediction_text(candidate.text),
        confidence=candidate.confidence,
        logit_score=None,
        lm_score=candidate.lm_score,
        raw_label=candidate.raw_text,
    )
    next_scored = RecognitionScored(
        prediction=prediction,
        score=score,
        source=candidate.source,
        lm_score=candidate.lm_score,
        model_agrees=candidate.model_agrees,
        streak=streak,
    )

    state.counts = set_count(state.counts, candidate.text, seen_count)
    state.selected_text = candidate.text
    state.selected_streak = streak
    state.final_candidate = preferred_final(state.final_candidate, next_scored)

    if state.display and state.display.prediction.label == candidate.text:
        state.display = merge_same(state.display, next_scored)
        state.display_misses = 0
        return state

    misses = state.display_misses + 1 if state.display else 0
    if should_display(next_scored, state.display, context, misses, seen_count, score, streak):
        state.display = next_scored
        state.display_misses = 0
    else:
        state.display_misses = misses

    # Keep latency available in logs without baking it into the wire model.
    _ = latency_ms
    return state


def select_candidate(
    response: PredictOut,
    raw_label: str,
    partial_text: str,
    previous_display_text: str,
) -> Candidate | None:
    raw = clean(raw_label)
    inputs: list[CandidateInput] = [
        CandidateInput(
            source=SOURCE_PARTIAL,
            raw_text=partial_text,
            confidence=response.prediction.confidence,
            lm_score=response.prediction.lm_score,
            model_agrees=agrees_with_any(
                partial_text,
                raw_label,
                response.greedy_text,
                response.prediction.raw_label or "",
            ),
        ),
        CandidateInput(
            source=SOURCE_RAW,
            raw_text=raw_label,
            confidence=response.prediction.confidence,
            lm_score=response.prediction.lm_score,
            model_agrees=agrees_with_any(
                raw_label,
                partial_text,
                response.greedy_text,
                response.prediction.raw_label or "",
            ),
        ),
    ]
    inputs.extend(
        CandidateInput(
            source=f"alt {index}",
            raw_text=alternative.label.strip(),
            confidence=alternative.confidence,
            lm_score=alternative.lm_score,
            model_agrees=False,
        )
        for index, alternative in enumerate(response.alternatives, start=1)
    )

    best: Candidate | None = None
    for item in inputs:
        text = clean(item.raw_text)
        if not text or bad_alt_tail(item.source, text, raw):
            continue
        candidate = Candidate(
            source=item.source,
            raw_text=item.raw_text,
            text=text,
            confidence=item.confidence,
            lm_score=item.lm_score,
            model_agrees=item.model_agrees,
            score=score_for(item, text, previous_display_text, raw),
        )
        if best is None or candidate.score > best.score:
            best = candidate
    return best


def should_display(
    next_scored: RecognitionScored,
    display: RecognitionScored | None,
    context: RecognitionContext,
    misses: int,
    seen_count: int,
    score: float,
    streak: int,
) -> bool:
    if display is None:
        return passes_threshold(
            DISPLAY_THRESHOLDS[kind(next_scored.prediction.label)],
            next_scored,
            seen_count,
            streak,
        ) or accepts_initial_evidence(next_scored, seen_count, score)

    current = display.prediction.label
    candidate = next_scored.prediction.label
    if keep_current(current, candidate):
        return False
    if single_tail(current, candidate):
        return accepts_tail(next_scored, display, context, seen_count, score, streak)
    if accepts_fix(next_scored, display, score):
        return True
    if accepts_raw_extension(next_scored, display, score):
        return True
    if accepts_raw(next_scored, display):
        return True
    if accepts_repeat(next_scored, display, misses, score, streak):
        return True
    if accepts_extend(next_scored, display, score):
        return True
    if accepts_prefix(next_scored, display, seen_count, score):
        return True
    if accepts_similar(next_scored, display, score):
        return True
    return score >= display.score + 0.25


def accepts_initial_evidence(next_scored: RecognitionScored, seen_count: int, score: float) -> bool:
    text = compact(next_scored.prediction.label)
    if len(text) < 4 or not next_scored.model_agrees:
        return False
    if next_scored.prediction.confidence < 0.04:
        return False
    return score >= 3.2 or (seen_count >= 2 and score >= 2.4)


def should_commit(candidate: RecognitionScored, seen_count: int) -> bool:
    prediction = candidate.prediction
    weak_language = (
        len(compact(prediction.label)) >= 7
        and candidate.lm_score is not None
        and candidate.lm_score <= -1.2
    )
    if weak_language:
        return prediction.confidence >= 0.9 or (
            seen_count >= 5 and candidate.streak >= 3 and prediction.confidence >= 0.75
        )
    return passes_threshold(
        COMMIT_THRESHOLDS[kind(prediction.label)],
        candidate,
        seen_count,
        candidate.streak,
    )


def keep_current(current: str, candidate: str) -> bool:
    return is_suffix_window(current, candidate) or is_spaced_variant(current, candidate)


def accepts_tail(
    next_scored: RecognitionScored,
    display: RecognitionScored,
    context: RecognitionContext,
    seen_count: int,
    score: float,
    streak: int,
) -> bool:
    idle_penalty = 1.25 if context.idle_frames > 0 else 0.5
    language_allows_tail = (
        next_scored.lm_score is None
        or next_scored.lm_score >= -0.25
        or display.prediction.confidence < 0.2
    )
    return (
        next_scored.source == SOURCE_RAW
        and next_scored.model_agrees
        and seen_count >= 2
        and streak >= 2
        and next_scored.prediction.confidence >= 0.45
        and language_allows_tail
        and score >= display.score - idle_penalty
    )


def accepts_fix(next_scored: RecognitionScored, display: RecognitionScored, score: float) -> bool:
    current = display.prediction.label
    candidate = next_scored.prediction.label
    return (
        len(candidate) >= len(current) + 4
        and prefix_len(candidate, current) >= 2
        and score >= display.score - 3
    )


def accepts_raw_extension(
    next_scored: RecognitionScored,
    display: RecognitionScored,
    score: float,
) -> bool:
    current = display.prediction.label
    candidate = next_scored.prediction.label
    return (
        next_scored.source == SOURCE_RAW
        and candidate.startswith(current)
        and len(candidate) >= len(current) + 3
        and next_scored.prediction.confidence >= 0.25
        and score >= display.score - 3.5
    )


def accepts_raw(next_scored: RecognitionScored, display: RecognitionScored) -> bool:
    return (
        next_scored.source == SOURCE_RAW
        and len(next_scored.prediction.label) >= 4
        and len(compact(next_scored.prediction.label)) >= len(compact(display.prediction.label))
        and next_scored.prediction.confidence >= display.prediction.confidence + 0.08
    )


def accepts_repeat(
    next_scored: RecognitionScored,
    display: RecognitionScored,
    misses: int,
    score: float,
    streak: int,
) -> bool:
    return (
        next_scored.source == SOURCE_RAW
        and streak >= 2
        and misses >= 3
        and len(next_scored.prediction.label) >= 3
        and score >= display.score - 4
    )


def accepts_extend(
    next_scored: RecognitionScored, display: RecognitionScored, score: float
) -> bool:
    return next_scored.prediction.label.startswith(display.prediction.label) and score >= (
        display.score - 1.2
    )


def accepts_prefix(
    next_scored: RecognitionScored,
    display: RecognitionScored,
    seen_count: int,
    score: float,
) -> bool:
    current = display.prediction.label
    candidate = next_scored.prediction.label
    return (
        current.startswith(candidate)
        and len(current) - len(candidate) <= 2
        and seen_count >= 2
        and score >= display.score - 1
    )


def accepts_similar(
    next_scored: RecognitionScored, display: RecognitionScored, score: float
) -> bool:
    current = display.prediction.label
    candidate = next_scored.prediction.label
    return (
        prefix_len(candidate, current) >= 4
        and abs(len(candidate) - len(current)) <= 3
        and score >= display.score - 0.8
    )


def passes_threshold(
    threshold: tuple[float, int, int, float],
    candidate: RecognitionScored,
    seen_count: int,
    streak: int,
) -> bool:
    instant, seen, threshold_streak, confidence = threshold
    return candidate.prediction.confidence >= instant or (
        seen_count >= seen
        and streak >= threshold_streak
        and candidate.prediction.confidence >= confidence
    )


def preferred_final(
    current: RecognitionScored | None,
    next_scored: RecognitionScored,
) -> RecognitionScored | None:
    reliable = (
        next_scored.source == SOURCE_RAW
        and next_scored.model_agrees
        and (next_scored.lm_score is None or next_scored.lm_score >= -0.3)
        and next_scored.prediction.confidence
        >= FINAL_CONFIDENCE[kind(next_scored.prediction.label)]
    )
    if not reliable:
        return current
    if current is None:
        return next_scored
    if next_scored.prediction.label == current.prediction.label:
        return (
            next_scored
            if next_scored.prediction.confidence > current.prediction.confidence
            else current
        )
    if short_finish(current.prediction.label, next_scored.prediction.label):
        return (
            next_scored
            if next_scored.prediction.confidence >= 0.45
            and next_scored.score >= current.score - 0.5
            else current
        )
    return (
        next_scored
        if next_scored.prediction.confidence >= current.prediction.confidence + 0.12
        and next_scored.score >= current.score - 0.5
        else current
    )


def pick_final_pred(
    display: RecognitionScored | None,
    final: RecognitionScored | None,
) -> RecognitionScored | None:
    if display is None:
        return final
    if final is None:
        return display
    if display.prediction.label == final.prediction.label:
        return final if final.prediction.confidence > display.prediction.confidence else display
    if short_finish(display.prediction.label, final.prediction.label):
        return final if final.score >= display.score - 0.5 else display
    return (
        final
        if (
            display.prediction.confidence < 0.2
            and final.prediction.confidence >= 0.45
            or (
                final.prediction.confidence >= display.prediction.confidence + 0.25
                and final.score >= display.score
            )
        )
        else display
    )


def merge_same(current: RecognitionScored, next_scored: RecognitionScored) -> RecognitionScored:
    return RecognitionScored(
        prediction=Prediction(
            label=next_scored.prediction.label,
            confidence=max(current.prediction.confidence, next_scored.prediction.confidence),
            logit_score=next_scored.prediction.logit_score,
            lm_score=next_scored.prediction.lm_score,
            raw_label=next_scored.prediction.raw_label,
        ),
        score=max(current.score, next_scored.score),
        source=next_scored.source,
        lm_score=max_nullable(current.lm_score, next_scored.lm_score),
        model_agrees=current.model_agrees or next_scored.model_agrees,
        streak=max(current.streak, next_scored.streak),
    )


def score_for(candidate: CandidateInput, text: str, previous: str, raw: str) -> float:
    score = candidate.confidence * 2
    score += lm_score(candidate)
    score += min(len(text), 14) * 0.08
    if candidate.source == SOURCE_RAW:
        score += 0.75
    if extends_previous_text(candidate, text, previous):
        score += 1.1
    if repairs_short_tail(text, previous):
        score += 0.65
    if re.fullmatch(r"[a-z0-9]", text):
        score += 0.35
    score -= punct_penalty(candidate.raw_text)
    if is_alternative(candidate.source):
        score -= 0.8
    if alt_extends_known(candidate, text, raw, previous):
        score -= 1.8
    if len(text) >= 2 and text[-1] == text[-2]:
        score -= 0.25
    if len(text) <= 3 and " " in text:
        score -= 0.75
    if len(previous) >= 4 and prefix_len(text, previous) < 3:
        score -= 2.5
    return score


def lm_score(candidate: CandidateInput) -> float:
    return min(max(candidate.lm_score or 0, -2.5), 3.5) * 0.45


def punct_penalty(text: str) -> float:
    return len(re.sub(r"[a-z0-9 ]", "", text, flags=re.IGNORECASE)) * 0.5


def extends_previous_text(candidate: CandidateInput, text: str, previous: str) -> bool:
    return candidate.source == SOURCE_RAW and len(previous) >= 3 and text.startswith(previous)


def repairs_short_tail(text: str, previous: str) -> bool:
    return len(text) >= 4 and previous.startswith(text) and len(previous) - len(text) <= 2


def alt_extends_known(candidate: CandidateInput, text: str, raw: str, previous: str) -> bool:
    return is_alternative(candidate.source) and (
        (len(raw) >= 3 and text.startswith(raw))
        or (len(previous) >= 3 and text.startswith(previous))
    )

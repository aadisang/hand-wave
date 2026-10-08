from __future__ import annotations

import logging
from time import perf_counter

from inference.generated.tunings import SMOOTH, SmoothTunings
from inference.model import ModelBackend
from inference.recognition_policy import (
    clean,
    compatible_text,
    count_for,
    count_for_candidate,
    count_in,
    has_expansion_evidence,
    is_low_confidence_soft_oov,
    majority_candidate,
    merge_same,
    pick_alternative_candidate,
    pick_final,
    select_final,
    set_count,
    should_accept_endpoint,
    should_clear_display,
    should_commit,
    should_display,
)
from inference.schemas import (
    DecodeTrace,
    EndpointReason,
    FinalizeTrace,
    Prediction,
    PredictOut,
    RecognitionContext,
    RecognitionScored,
    RecognitionSource,
    RecognitionState,
    RecognitionTrace,
    RecognizeIn,
    RecognizeOut,
)
from inference.text_normalizer import is_uncorrected_oov, normalize_prediction_text

logger = logging.getLogger(__name__)


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
    state = payload.state or empty_state()
    if payload.finalize:
        out = finalize(state, payload.context, SMOOTH)
        if out.committed:
            return out

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
                SMOOTH,
            )
        out = finalize(state, payload.context, SMOOTH)
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
        SMOOTH,
    )


def accept_prediction(
    state: RecognitionState,
    response: PredictOut,
    context: RecognitionContext,
    buffered_frames: int,
    latency_ms: float,
    config: SmoothTunings,
) -> RecognizeOut:
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
    config: SmoothTunings,
) -> tuple[RecognitionState, DecodeTrace]:
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
        source=RecognitionSource.endpoint,
        lm_score=response.prediction.lm_score,
        model_agrees=clean(normalize_prediction_text(response.greedy_text)) == text,
        streak=config.commit_streak,
    )
    state.final_candidate = pick_final(state.final_candidate, scored, seen, config)
    return state, trace


def finalize(
    state: RecognitionState,
    context: RecognitionContext,
    config: SmoothTunings,
) -> RecognizeOut:
    selected = select_final(state, config)
    prediction = None
    committed = False
    incomplete = selected is not None and has_expansion_evidence(state, selected, config)
    if selected:
        prediction = selected.prediction
        committed = not incomplete and should_commit(
            selected,
            count_for_candidate(state, selected),
            config,
        )
    if not committed and not incomplete:
        majority = majority_candidate(state, config)
        if majority is not None:
            prediction = majority.prediction
            committed = True
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
    config: SmoothTunings,
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
        source=RecognitionSource.beam,
        lm_score=response.prediction.lm_score,
        model_agrees=clean(normalize_prediction_text(response.greedy_text)) == text,
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
    config: SmoothTunings,
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
    config: SmoothTunings,
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
    greedy_text = clean(normalize_prediction_text(response.greedy_text))
    if greedy_text:
        greedy_prediction = Prediction(
            label=greedy_text,
            confidence=response.prediction.confidence,
            raw_label=clean(response.greedy_text),
        )
        current = best_by_text.get(greedy_text)
        if current is None:
            best_by_text[greedy_text] = (greedy_prediction, 1)
        else:
            best_prediction, best_rank = current
            best_by_text[greedy_text] = (
                (
                    greedy_prediction
                    if greedy_prediction.confidence > best_prediction.confidence
                    else best_prediction
                ),
                min(1, best_rank),
            )
    return tuple((text, prediction, rank) for text, (prediction, rank) in best_by_text.items())


def age_alternative_candidate(
    state: RecognitionState,
    present: set[str],
    config: SmoothTunings,
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
    source = RecognitionSource.dominant if rank == 0 else RecognitionSource.alternative
    return RecognitionScored(
        prediction=Prediction(
            label=text,
            confidence=prediction.confidence,
            logit_score=prediction.logit_score,
            lm_score=prediction.lm_score,
            raw_label=clean(prediction.raw_label or prediction.label),
        ),
        score=prediction.confidence + min(seen, 20) * 0.06 - rank * 0.02,
        source=source,
        lm_score=prediction.lm_score,
        model_agrees=clean(normalize_prediction_text(response.greedy_text)) == text,
        streak=seen,
    )


def should_remember_alternative_candidate(
    candidate: RecognitionScored,
    seen: int,
    rank: int,
    config: SmoothTunings,
) -> bool:
    text = candidate.prediction.label
    text_len = len(clean(text).replace(" ", ""))
    if rank == 0:
        evidence_gate = (
            text_len >= config.dominant_commit_min_chars
            and seen >= config.dominant_commit_count
            and candidate.prediction.confidence >= config.dominant_commit_confidence
        )
    else:
        evidence_gate = (
            rank <= 2
            and text_len >= config.alternative_commit_min_chars
            and seen >= config.alternative_commit_count
            and candidate.prediction.confidence >= config.alternative_commit_confidence
        )
    return (
        evidence_gate
        and not is_uncorrected_oov(
            text,
            min_chars=config.commit_reject_uncorrected_oov_chars,
        )
        and not is_low_confidence_soft_oov(text, candidate.prediction.confidence, config)
    )

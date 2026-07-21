import re
from collections.abc import Sequence
from typing import Protocol

from inference.schemas import (
    Prediction,
    RecognitionCount,
    RecognitionScored,
    RecognitionSource,
    RecognitionState,
)
from inference.text_normalizer import edit_distance, is_uncorrected_oov


class PolicyConfig(Protocol):
    display_confidence: float
    display_streak: int
    display_count: int
    display_clear_misses: int
    instant_display_confidence: float
    commit_confidence: float
    model_disagreement_commit_confidence: float
    short_commit_confidence: float
    commit_streak: int
    commit_count: int
    endpoint_commit_count: int
    commit_soft_oov_min_chars: int
    commit_soft_oov_confidence: float
    commit_reject_uncorrected_oov_chars: int
    stable_commit_confidence: float
    stable_commit_count: int
    stable_commit_streak: int
    stable_commit_min_chars: int
    short_stable_commit_confidence: float
    short_stable_commit_count: int
    short_stable_commit_streak: int
    short_stable_commit_min_chars: int
    short_stable_commit_max_chars: int
    majority_commit_min_count: int
    majority_commit_min_share: float
    majority_commit_min_chars: int
    dominant_commit_confidence: float
    dominant_commit_count: int
    dominant_commit_min_chars: int
    alternative_commit_confidence: float
    alternative_commit_count: int
    alternative_commit_min_chars: int
    replace_margin: float


def pick_alternative_candidate(
    current: RecognitionScored | None,
    candidate: RecognitionScored,
    config: PolicyConfig,
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
    config: PolicyConfig,
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
    config: PolicyConfig,
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
    config: PolicyConfig,
) -> RecognitionScored | None:
    if not should_commit(candidate, seen, config):
        return current
    if current is None:
        return candidate
    if current.prediction.label == candidate.prediction.label:
        return merge_same(current, candidate)
    return candidate if candidate.score > current.score + config.replace_margin else current


def majority_candidate(
    state: RecognitionState,
    config: PolicyConfig,
) -> RecognitionScored | None:
    counts = state.counts or []
    total = sum(item.count for item in counts)
    if total <= 0:
        return None
    eligible = [
        item
        for item in counts
        if len(clean(item.text).replace(" ", "")) >= config.majority_commit_min_chars
    ]
    if not eligible:
        return None
    best = max(eligible, key=lambda item: (item.count, len(item.text)))
    cluster_count = sum(item.count for item in counts if compatible_text(item.text, best.text))
    share = cluster_count / total
    if (
        cluster_count < config.majority_commit_min_count
        or share < config.majority_commit_min_share
        or is_uncorrected_oov(
            best.text,
            min_chars=config.commit_reject_uncorrected_oov_chars,
        )
    ):
        return None
    return RecognitionScored(
        prediction=Prediction(
            label=best.text,
            confidence=min(1.0, share),
            raw_label=best.text,
        ),
        score=min(1.0, share),
        source=RecognitionSource.majority,
        lm_score=None,
        model_agrees=False,
        streak=best.count,
    )


def select_final(state: RecognitionState, config: PolicyConfig) -> RecognitionScored | None:
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
    config: PolicyConfig,
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
    config: PolicyConfig,
) -> bool:
    text_len = len(clean(candidate.prediction.label).replace(" ", ""))
    confidence = max(
        config.commit_confidence,
        (
            config.model_disagreement_commit_confidence
            if not candidate.model_agrees
            else config.commit_confidence
        ),
        config.short_commit_confidence if 0 < text_len <= 3 else config.commit_confidence,
    )
    confidence_gate = candidate.prediction.confidence >= confidence
    stable_gate = is_stable_model_agreed_candidate(candidate, seen, config)
    short_stable_gate = is_stable_short_model_agreed_candidate(candidate, seen, config)
    dominant_gate = is_stable_dominant_candidate(candidate, seen, config)
    alternative_gate = is_stable_alternative_candidate(candidate, seen, config)
    standard_gate = (
        (confidence_gate or stable_gate or short_stable_gate or alternative_gate)
        and seen >= config.commit_count
        and candidate.streak >= config.commit_streak
    )
    return (
        (standard_gate or dominant_gate)
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


def is_stable_dominant_candidate(
    candidate: RecognitionScored,
    seen: int,
    config: PolicyConfig,
) -> bool:
    text_len = len(clean(candidate.prediction.label).replace(" ", ""))
    return (
        candidate.source == RecognitionSource.dominant
        and text_len >= config.dominant_commit_min_chars
        and seen >= config.dominant_commit_count
        and candidate.streak >= config.dominant_commit_count
        and candidate.prediction.confidence >= config.dominant_commit_confidence
    )


def has_expansion_evidence(
    state: RecognitionState,
    candidate: RecognitionScored,
    config: PolicyConfig,
) -> bool:
    base = clean(candidate.prediction.label).replace(" ", "")
    if len(base) < 3:
        return False

    support = 0
    for item in state.counts or []:
        expanded = clean(item.text).replace(" ", "")
        if len(expanded) < len(base) + 2:
            continue
        prefix = expanded[: len(base)]
        if edit_distance(base, prefix, max_distance=1) <= 1:
            support += item.count

    required = max(config.commit_count, count_for_candidate(state, candidate))
    return support >= required


def is_stable_alternative_candidate(
    candidate: RecognitionScored,
    seen: int,
    config: PolicyConfig,
) -> bool:
    text_len = len(clean(candidate.prediction.label).replace(" ", ""))
    return (
        candidate.source == RecognitionSource.alternative
        and text_len >= config.alternative_commit_min_chars
        and seen >= config.alternative_commit_count
        and candidate.streak >= config.alternative_commit_count
        and candidate.prediction.confidence >= config.alternative_commit_confidence
    )


def is_stable_short_model_agreed_candidate(
    candidate: RecognitionScored,
    seen: int,
    config: PolicyConfig,
) -> bool:
    text_len = len(clean(candidate.prediction.label).replace(" ", ""))
    return (
        candidate.model_agrees
        and config.short_stable_commit_min_chars <= text_len <= config.short_stable_commit_max_chars
        and seen >= config.short_stable_commit_count
        and candidate.streak >= config.short_stable_commit_streak
        and candidate.prediction.confidence >= config.short_stable_commit_confidence
    )


def is_stable_model_agreed_candidate(
    candidate: RecognitionScored,
    seen: int,
    config: PolicyConfig,
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
    config: PolicyConfig,
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
    config: PolicyConfig,
) -> bool:
    return confidence < config.commit_soft_oov_confidence and is_uncorrected_oov(
        text,
        min_chars=config.commit_soft_oov_min_chars,
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
    if candidate.source in {RecognitionSource.alternative, RecognitionSource.dominant}:
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

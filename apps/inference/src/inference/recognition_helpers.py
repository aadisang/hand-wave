from __future__ import annotations

import re
from collections.abc import Sequence

from inference.schemas import RecognitionCount, RecognitionState


def kind(text: str) -> str:
    cleaned = clean(text)
    length = len(compact(cleaned))
    if length == 1:
        return "letter"
    if length <= 3:
        return "short"
    if " " in cleaned:
        return "phrase"
    if length >= 7:
        return "long"
    return "word"


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", "", text.lower())).strip()


def compact(text: str) -> str:
    return re.sub(r"\s+", "", clean(text))


def agrees_with_any(text: str, *others: str) -> bool:
    value = compact(text)
    return bool(value) and any(compact(other) == value for other in others)


def bad_alt_tail(source: str, text: str, raw: str) -> bool:
    extra = len(text) - len(raw)
    return is_alternative(source) and bool(raw) and text.startswith(raw) and 0 < extra <= 2


def is_suffix_window(current: str, candidate: str) -> bool:
    current_compact = compact(current)
    candidate_compact = compact(candidate)
    return (
        len(current_compact) >= 10
        and len(candidate_compact) >= 4
        and current_compact.endswith(candidate_compact)
        and len(current_compact) - len(candidate_compact) >= 3
    )


def is_spaced_variant(current: str, candidate: str) -> bool:
    return (
        " " not in current and " " in candidate and near_edit(compact(current), compact(candidate))
    )


def single_tail(current: str, candidate: str) -> bool:
    return (
        len(current) >= 4 and candidate.startswith(current) and len(candidate) == len(current) + 1
    )


def short_finish(current: str, candidate: str) -> bool:
    current_compact = compact(current)
    candidate_compact = compact(candidate)
    delta = len(candidate_compact) - len(current_compact)
    return (
        len(current_compact) >= 3
        and candidate_compact.startswith(current_compact)
        and 0 < delta <= 2
    )


def near_edit(a: str, b: str) -> bool:
    if abs(len(a) - len(b)) > 1:
        return False
    edits = 0
    i = 0
    j = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
            continue
        edits += 1
        if edits > 1:
            return False
        if len(a) > len(b):
            i += 1
        elif len(b) > len(a):
            j += 1
        else:
            i += 1
            j += 1
    return edits + (1 if i < len(a) or j < len(b) else 0) <= 1


def prefix_len(a: str, b: str) -> int:
    for index, (left, right) in enumerate(zip(a, b, strict=False)):
        if left != right:
            return index
    return min(len(a), len(b))


def max_nullable(left: float | None, right: float | None) -> float | None:
    if left is None:
        return right
    if right is None:
        return left
    return max(left, right)


def next_streak(state: RecognitionState, text: str) -> int:
    return state.selected_streak + 1 if state.selected_text == text else 1


def count_for(state: RecognitionState, text: str) -> int:
    for item in state.counts:
        if item.text == text:
            return item.count
    return 0


def set_count(counts: Sequence[RecognitionCount], text: str, count: int) -> list[RecognitionCount]:
    out = [
        RecognitionCount(text=item.text, count=item.count) for item in counts if item.text != text
    ]
    out.append(RecognitionCount(text=text, count=count))
    return out


def format_prediction_text(text: str) -> str:
    return clean(text)


def is_alternative(source: str) -> bool:
    return source.startswith("alt")

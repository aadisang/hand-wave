from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from itertools import product

from rapidfuzz.distance import Levenshtein
from wordfreq import top_n_list, zipf_frequency
from wordsegment import BIGRAMS, segment
from wordsegment import load as load_wordsegment


@dataclass(frozen=True)
class LanguageVariant:
    text: str
    score: float


class EnglishPrior:
    def __init__(self) -> None:
        load_wordsegment()

    def variants(self, text: str) -> tuple[LanguageVariant, ...]:
        clean = normalize_text(text)
        if not clean:
            return ()

        candidates = {clean, self._correct_phrase(clean)}
        candidates.update(self._phrase_context_variants(clean))
        compact = clean.replace(" ", "")
        if compact.isalpha() and len(compact) >= 8:
            segmented = " ".join(segment(compact))
            corrected_segment = self._correct_phrase(segmented)
            if _looks_like_phrase(segmented):
                candidates.add(segmented)
                candidates.add(corrected_segment)
            elif _looks_like_phrase(corrected_segment):
                candidates.add(corrected_segment)

        return tuple(
            sorted(
                (
                    LanguageVariant(candidate, self._variant_score(clean, candidate))
                    for candidate in candidates
                    if candidate
                ),
                key=lambda candidate: candidate.score,
                reverse=True,
            )
        )

    def _correct_phrase(self, text: str) -> str:
        tokens = text.split()
        in_phrase = len(tokens) > 1
        return " ".join(self._correct_token(token, in_phrase) for token in tokens)

    def _phrase_context_variants(self, text: str) -> set[str]:
        tokens = text.split()
        if len(tokens) <= 1:
            return set()

        base_score = self._variant_score(text, text)
        candidate_groups = [_contextual_token_candidates(token) for token in tokens]
        combination_count = 1
        for group in candidate_groups:
            combination_count *= len(group)
            if combination_count > 512:
                return set()

        variants: set[str] = set()
        for phrase_tokens in product(*candidate_groups):
            phrase = " ".join(phrase_tokens)
            if phrase == text:
                continue
            if self._variant_score(text, phrase) >= base_score + 0.75:
                variants.add(phrase)
        return variants

    def _correct_token(self, token: str, in_phrase: bool) -> str:
        if not token.isalpha() or len(token) < 4 or word_score(token) >= 3.2:
            return token

        candidates = {token}
        for base in _tail_pruned_tokens(token):
            candidates.add(base)
            candidates.update(_repeat_restored_tokens(base))
        candidates.update(_repeat_restored_tokens(token))
        nearest = _nearest_common_word(token)
        if nearest:
            candidates.add(nearest)

        scored = [
            (candidate, word_score(candidate), Levenshtein.distance(token, candidate))
            for candidate in candidates
        ]
        floor = 3.2 if len(token) >= 7 else 3.6
        scored = [
            (candidate, score, distance)
            for candidate, score, distance in scored
            if candidate == token
            or (
                score >= max(floor, word_score(token) + 1.5)
                and distance <= 2
                and (candidate[0] == token[0] or in_phrase or len(token) >= 7)
            )
        ]
        return max(scored, key=lambda item: item[1] - item[2] * 0.7)[0]

    def _variant_score(self, raw: str, candidate: str) -> float:
        edit_cost = Levenshtein.distance(compact_text(raw), compact_text(candidate)) * 0.65
        return phrase_score(candidate) - edit_cost


@lru_cache(maxsize=1)
def english_prior() -> EnglishPrior:
    return EnglishPrior()


def normalize_text(text: str) -> str:
    return " ".join("".join(char for char in text.lower() if char.isalnum() or char == " ").split())


def compact_text(text: str) -> str:
    return normalize_text(text).replace(" ", "")


def word_score(word: str) -> float:
    return zipf_frequency(word, "en")


def phrase_score(text: str) -> float:
    tokens = normalize_text(text).split()
    if not tokens:
        return 0.0

    score = sum(_token_score(token) for token in tokens)
    for left, right in zip(tokens, tokens[1:], strict=False):
        score += 0.35 if f"{left} {right}" in BIGRAMS else -0.08
    return score + min(len(tokens) - 1, 4) * 0.18


def _looks_like_phrase(text: str) -> bool:
    tokens = normalize_text(text).split()
    if len(tokens) <= 1 or any(len(token) == 1 for token in tokens):
        return False
    if any(not token.isdigit() and word_score(token) < 3.2 for token in tokens):
        return False
    has_common_bigram = any(
        f"{left} {right}" in BIGRAMS for left, right in zip(tokens, tokens[1:], strict=False)
    )
    return has_common_bigram or phrase_score(text) >= 2.0


def _token_score(token: str) -> float:
    if len(token) == 1:
        return 0.0 if token in {"a", "i"} else -0.6
    if token.isdigit():
        return 0.0

    score = word_score(token)
    if score == 0:
        return -1.35 - min(len(token), 10) * 0.07
    return min(max(score - 3.0, -1.0), 3.0) * 0.32


def _tail_pruned_tokens(token: str) -> set[str]:
    return {token[:-1]} if len(token) >= 5 else set()


def _repeat_restored_tokens(token: str) -> set[str]:
    return {token[: index + 1] + token[index] + token[index + 1 :] for index in range(len(token))}


@lru_cache(maxsize=4096)
def _contextual_token_candidates(token: str) -> tuple[str, ...]:
    if not token.isalpha() or len(token) < 4:
        return (token,)

    candidates = {token}
    for form in _ctc_pruned_forms(token):
        if word_score(form) >= 3.2:
            candidates.add(form)
        candidates.update(_nearby_common_words(form))

    scored = sorted(
        candidates,
        key=lambda candidate: (
            word_score(candidate) - Levenshtein.distance(token, candidate) * 0.45,
            -Levenshtein.distance(token, candidate),
        ),
        reverse=True,
    )
    return tuple(scored[:8])


def _ctc_pruned_forms(token: str) -> set[str]:
    forms = {token}
    if len(token) >= 5:
        forms.add(token[:-1])
    if len(token) >= 6:
        forms.add(token[1:])
        forms.add(token[2:])

    for form in tuple(forms):
        forms.update(_repeat_pruned_tokens(form))
    return forms


def _repeat_pruned_tokens(token: str) -> set[str]:
    return {
        token[:index] + token[index + 1 :]
        for index in range(1, len(token))
        if token[index] == token[index - 1]
    }


@lru_cache(maxsize=4096)
def _nearby_common_words(token: str) -> tuple[str, ...]:
    if len(token) < 4:
        return ()

    max_distance = 1 if len(token) <= 5 else 2
    max_length_delta = 1 if len(token) <= 5 else 2
    scored: list[tuple[str, float]] = []
    for word in _common_words():
        length_delta = abs(len(word) - len(token))
        if length_delta > max_length_delta or word[0] != token[0]:
            continue
        distance = Levenshtein.distance(token, word)
        if distance > max_distance:
            continue
        score = word_score(word)
        if score >= 3.2:
            scored.append((word, score - distance * 0.6 - length_delta * 0.15))
    return tuple(word for word, _score in sorted(scored, key=lambda item: item[1], reverse=True)[:8])


def _nearest_common_word(token: str) -> str | None:
    if len(token) < 6 or word_score(token) >= 2.0:
        return None

    scored: list[tuple[str, float]] = []
    for word in _common_words():
        if len(word) < len(token) or len(word) - len(token) > 2:
            continue
        distance = Levenshtein.distance(token, word)
        if distance > 2 or (len(token) < 7 and (distance > 1 or word[-1] != token[-1])):
            continue
        score = word_score(word)
        if score >= 3.2:
            scored.append((word, score - distance * 0.8 - (len(word) - len(token)) * 0.15))
    return max(scored, key=lambda item: item[1])[0] if scored else None


@lru_cache(maxsize=1)
def _common_words() -> tuple[str, ...]:
    return tuple(word for word in top_n_list("en", 100_000) if word.isalpha())

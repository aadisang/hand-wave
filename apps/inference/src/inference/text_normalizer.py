from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from math import inf, log1p
from typing import TYPE_CHECKING

from inference.ctc import DEFAULT_KENLM_MODEL_PATH, DEFAULT_UNIGRAMS_PATH, load_unigrams

if TYPE_CHECKING:
    from collections.abc import Iterable


MAX_WORDS = 50_000
MAX_WORD_LENGTH = 14
MAX_SOURCE_SPAN = 12
MAX_CANDIDATES_PER_SPAN = 64
MAX_PATHS_PER_POSITION = 128
MIN_CORRECTION_LENGTH = 6
ACCEPT_SCORE = 5.6
EXACT_SPLIT_ACCEPT_SCORE = 5.1
SAFE_EXACT_OOV_SPLIT_SCORE = 6.1
MIN_EXACT_SPLIT_WORDS = 3
MAX_EXACT_SPLIT_WORDS = 5
MAX_CORRECTION_WORDS = 5
SHORT_FIRST_WORD_ACCEPT_SCORE = 4.9
SHORT_FIRST_WORD_LENGTH = 3
SHORT_FIRST_WORD_REPLACE_MARGIN = 0.35
SPACED_CORRECTION_MARGIN = 0.18
MAX_ONE_LETTER_WORDS = 1
MAX_ONE_LETTER_SOURCE_RANK = 100
MAX_SHORT_EXACT_WORD_RANK = 5_000
MAX_SHORT_FIRST_WORD_RANK = 500
MAX_SINGLE_WORD_CORRECTION_CHARS = 8
MAX_SINGLE_WORD_CORRECTION_RANK = 1_000
MIN_SINGLE_WORD_RANK_RATIO = 2.5
MIN_COMPOUND_COLLAPSE_RANK = 1_000


@dataclass(frozen=True)
class WordCandidate:
    word: str
    edits: int


@dataclass(frozen=True)
class SegmentationPath:
    base_cost: float
    edits: int
    words: tuple[str, ...]


class TextNormalizer:
    def __init__(self) -> None:
        self.words, self.ranks = ranked_words(load_unigrams(DEFAULT_UNIGRAMS_PATH))
        self.word_set = set(self.words)
        self.delete_index = deletion_index(self.words)
        self.language_model = load_language_model()
        self._candidate_cache: dict[str, tuple[WordCandidate, ...]] = {}

    def normalize(self, text: str) -> str:
        raw = letters_only(text)
        if not raw:
            return text
        if " " in text:
            return self.normalize_spaced(text, raw)
        if raw in self.word_set:
            return text

        corrected_word = self.single_word_correction(raw)
        if corrected_word is not None:
            return corrected_word
        exact_split = self.best_exact_split(raw)
        if exact_split is not None:
            return self.refine_spaced_candidate(exact_split.words)
        if len(raw) < MIN_CORRECTION_LENGTH:
            return text

        candidates = self.correction_candidates(raw)
        if not candidates:
            return text
        best_score, best = candidates[0]
        short_first = self.short_first_word_correction(raw)
        if (
            short_first is not None
            and self.path_score(short_first) + SHORT_FIRST_WORD_REPLACE_MARGIN < best_score
        ):
            return self.refine_spaced_candidate(short_first.words)
        if best_score >= ACCEPT_SCORE:
            return self.refine_spaced_candidate(short_first.words) if short_first else text
        exact_score = self.best_exact_split_score(raw)
        if exact_score is not None and best_score >= exact_score:
            return text
        return self.refine_spaced_candidate(best.words)

    def normalize_spaced(self, text: str, raw: str) -> str:
        words = tuple(letters_only(part) for part in text.split())
        words = tuple(word for word in words if word)
        if not words:
            return text
        if raw in self.word_set and should_collapse_split_compound(raw, words, self.ranks):
            return raw
        if raw in self.word_set and any(word not in self.word_set for word in words):
            return raw

        current_score = self.words_score(words)
        candidates = [
            item for item in self.correction_candidates(raw) if len(item[1].words) == len(words)
        ]
        exact_split = self.best_exact_split(raw)
        if exact_split is not None and len(exact_split.words) == len(words):
            candidates.append((self.path_score(exact_split), exact_split))
        if not candidates:
            return text

        best_score, best = min(candidates, key=lambda item: item[0])
        if best_score + SPACED_CORRECTION_MARGIN >= current_score:
            return text
        return " ".join(best.words)

    def refine_spaced_candidate(self, words: tuple[str, ...]) -> str:
        text = " ".join(words)
        if len(words) <= 1:
            return text
        return self.normalize_spaced(text, letters_only(text))

    def correction_candidates(self, raw: str) -> tuple[tuple[float, SegmentationPath], ...]:
        max_edits = 2 if len(raw) >= 7 else 1
        scored: list[tuple[float, SegmentationPath]] = []
        for path in self.segmentations(raw):
            if len(path.words) < 2 or path.edits == 0 or path.edits > max_edits:
                continue
            if not plausible_phrase(path.words):
                continue
            if has_rare_short_word(path.words, self.ranks):
                continue
            if len(path.words) >= MAX_EXACT_SPLIT_WORDS and has_one_letter_word(path.words):
                continue
            if not preserves_edges(raw, path.words):
                continue
            scored.append((self.path_score(path), path))
        return tuple(sorted(scored, key=lambda item: item[0]))

    def short_first_word_correction(self, raw: str) -> SegmentationPath | None:
        max_edits = 2 if len(raw) >= 7 else 1
        scored: list[tuple[float, SegmentationPath]] = []
        for path in self.segmentations(raw):
            if len(path.words) < MIN_EXACT_SPLIT_WORDS:
                continue
            if path.edits == 0 or path.edits > max_edits:
                continue
            if not plausible_phrase(path.words):
                continue
            if has_rare_short_word(path.words, self.ranks):
                continue
            if len(path.words[0]) != SHORT_FIRST_WORD_LENGTH:
                continue
            if self.ranks[path.words[0]] > MAX_SHORT_FIRST_WORD_RANK:
                continue
            if not path.words[-1].endswith(raw[-1]):
                continue
            score = self.path_score(path)
            if score <= SHORT_FIRST_WORD_ACCEPT_SCORE:
                scored.append((score, path))
        if not scored:
            return None
        return min(scored, key=short_first_word_score_key)[1]

    def single_word_correction(self, raw: str) -> str | None:
        if not (4 <= len(raw) <= MAX_SINGLE_WORD_CORRECTION_CHARS):
            return None
        if raw in self.word_set:
            return None

        candidates = [
            candidate
            for candidate in self.word_candidates(raw)
            if (
                candidate.edits == 1
                and len(candidate.word) >= 4
                and self.ranks[candidate.word] <= MAX_SINGLE_WORD_CORRECTION_RANK
                and plausible_single_word_alignment(raw, candidate.word)
            )
        ]
        if not candidates:
            return None
        best = candidates[0]
        if len(candidates) == 1:
            return best.word

        second_rank = self.ranks[candidates[1].word]
        if second_rank / self.ranks[best.word] >= MIN_SINGLE_WORD_RANK_RATIO:
            return best.word
        return None

    def best_exact_split_score(self, raw: str) -> float | None:
        path = self.best_exact_split(raw)
        return self.path_score(path) if path is not None else None

    def best_exact_split(self, raw: str) -> SegmentationPath | None:
        candidates = [
            path
            for path in self.segmentations(raw)
            if (
                path.edits == 0
                and len(path.words) >= MIN_EXACT_SPLIT_WORDS
                and len(path.words) <= MAX_EXACT_SPLIT_WORDS
                and plausible_phrase(path.words)
                and not has_rare_short_word(path.words, self.ranks)
                and preserves_edges(raw, path.words, min_first_word_len=2)
            )
        ]
        if not candidates:
            return None
        best = min(candidates, key=self.path_score)
        if self.path_score(best) >= EXACT_SPLIT_ACCEPT_SCORE:
            return None
        return best

    def any_exact_split_score(self, raw: str) -> float | None:
        scores = [
            self.path_score(path)
            for path in self.segmentations(raw)
            if path.edits == 0 and len(path.words) > 1
        ]
        return min(scores) if scores else None

    def words_score(self, words: tuple[str, ...]) -> float:
        if not words or any(word not in self.ranks for word in words):
            return inf
        return self.path_score(SegmentationPath(base_cost=0.0, edits=0, words=words))

    def path_score(self, path: SegmentationPath) -> float:
        text = " ".join(path.words)
        lm_cost = -self.language_model.score(text, bos=True, eos=True) / (len(path.words) + 1)
        rank_cost = sum(log1p(self.ranks[word]) for word in path.words) / len(path.words)
        return (
            path.edits * 0.35
            + lm_cost * 1.3
            + rank_cost * 0.025
            + len(path.words) * 0.03
        )

    def segmentations(self, raw: str) -> tuple[SegmentationPath, ...]:
        size = len(raw)
        paths: list[list[SegmentationPath]] = [[] for _ in range(size + 1)]
        paths[0] = [SegmentationPath(base_cost=0.0, edits=0, words=())]

        for start in range(size):
            if not paths[start]:
                continue
            for path in paths[start]:
                for end in range(start + 1, min(size, start + MAX_SOURCE_SPAN) + 1):
                    source = raw[start:end]
                    for candidate in self.word_candidates(source):
                        rank = self.ranks[candidate.word]
                        cost = (
                            path.base_cost
                            + candidate.edits * 0.5
                            + log1p(rank) * 0.015
                            + 0.02
                        )
                        paths[end].append(
                            SegmentationPath(
                                base_cost=cost,
                                edits=path.edits + candidate.edits,
                                words=(*path.words, candidate.word),
                            )
                        )
            for end in range(start + 1, size + 1):
                if len(paths[end]) > MAX_PATHS_PER_POSITION:
                    paths[end] = sorted(paths[end], key=lambda item: item.base_cost)[
                        :MAX_PATHS_PER_POSITION
                    ]
        return tuple(paths[size])

    def word_candidates(self, source: str) -> tuple[WordCandidate, ...]:
        cached = self._candidate_cache.get(source)
        if cached is not None:
            return cached
        candidates: dict[str, int] = {}
        if source in self.word_set:
            candidates[source] = 0

        keys = {source}
        keys.update(source[:index] + source[index + 1 :] for index in range(len(source)))
        for key in keys:
            for word in self.delete_index.get(key, ()):
                edits = edit_distance(source, word, max_distance=1)
                if edits <= 1:
                    candidates[word] = min(candidates.get(word, edits), edits)

        result = tuple(
            WordCandidate(word, edits)
            for word, edits in sorted(
                candidates.items(),
                key=lambda item: (item[1], self.ranks[item[0]]),
            )[:MAX_CANDIDATES_PER_SPAN]
        )
        if len(self._candidate_cache) >= 20_000:
            self._candidate_cache.clear()
        self._candidate_cache[source] = result
        return result


@lru_cache(maxsize=1)
def default_normalizer() -> TextNormalizer | None:
    try:
        return TextNormalizer()
    except (ImportError, OSError, ValueError):
        return None


def normalize_prediction_text(text: str) -> str:
    normalizer = default_normalizer()
    if normalizer is None:
        return text
    return normalizer.normalize(text)


def is_uncorrected_oov(text: str, *, min_chars: int) -> bool:
    if min_chars <= 0:
        return False
    normalizer = default_normalizer()
    if normalizer is None:
        return False

    raw = letters_only(text)
    if len(raw) < min_chars or " " in text or raw in normalizer.word_set:
        return False
    exact_score = normalizer.any_exact_split_score(raw)
    if exact_score is not None and exact_score < SAFE_EXACT_OOV_SPLIT_SCORE:
        return False

    candidates = normalizer.correction_candidates(raw)
    return bool(candidates and candidates[0][0] >= ACCEPT_SCORE)


def ranked_words(raw_words: Iterable[str]) -> tuple[tuple[str, ...], dict[str, int]]:
    words: list[str] = []
    ranks: dict[str, int] = {}
    for source_rank, word in enumerate(raw_words):
        if not is_candidate_word(word, source_rank):
            continue
        if word in ranks:
            continue
        ranks[word] = len(ranks) + 1
        words.append(word)
        if len(words) >= MAX_WORDS:
            break
    return tuple(words), ranks


def is_candidate_word(word: str, source_rank: int) -> bool:
    if not word.isalpha() or not word.islower():
        return False
    if len(word) == 1:
        return source_rank < MAX_ONE_LETTER_SOURCE_RANK
    if len(word) == 2 and source_rank > 2_500:
        return False
    if len(word) == 3 and source_rank > 20_000:
        return False
    return len(word) <= MAX_WORD_LENGTH


def deletion_index(words: Iterable[str]) -> dict[str, set[str]]:
    index: dict[str, set[str]] = defaultdict(set)
    for word in words:
        if len(word) < 2:
            continue
        index[word].add(word)
        for char_index in range(len(word)):
            index[word[:char_index] + word[char_index + 1 :]].add(word)
    return dict(index)


def edit_distance(left: str, right: str, *, max_distance: int) -> int:
    if abs(len(left) - len(right)) > max_distance:
        return max_distance + 1
    previous = list(range(len(right) + 1))
    for row, left_char in enumerate(left, start=1):
        current = [row]
        row_min = row
        for column, right_char in enumerate(right, start=1):
            value = previous[column - 1] if left_char == right_char else previous[column - 1] + 1
            value = min(value, previous[column] + 1, current[-1] + 1)
            current.append(value)
            row_min = min(row_min, value)
        if row_min > max_distance:
            return max_distance + 1
        previous = current
    return previous[-1]


def letters_only(text: str) -> str:
    return "".join(char for char in text.lower() if "a" <= char <= "z")


def preserves_edges(
    raw: str,
    words: tuple[str, ...],
    *,
    min_first_word_len: int = 4,
) -> bool:
    return bool(
        words
        and words[0].startswith(raw[0])
        and words[-1].endswith(raw[-1])
        and len(words[0]) >= min_first_word_len
    )


def plausible_phrase(words: tuple[str, ...]) -> bool:
    if len(words) > MAX_CORRECTION_WORDS:
        return False
    return sum(1 for word in words if len(word) == 1) <= MAX_ONE_LETTER_WORDS


def has_rare_short_word(words: tuple[str, ...], ranks: dict[str, int]) -> bool:
    return any(
        1 < len(word) <= 3 and ranks.get(word, MAX_WORDS + 1) > MAX_SHORT_EXACT_WORD_RANK
        for word in words
    )


def has_one_letter_word(words: tuple[str, ...]) -> bool:
    return any(len(word) == 1 for word in words)


def should_collapse_split_compound(
    raw: str,
    words: tuple[str, ...],
    ranks: dict[str, int],
) -> bool:
    return (
        len(words) == 2
        and raw in ranks
        and ranks[raw] >= MIN_COMPOUND_COLLAPSE_RANK
        and all(word in ranks and len(word) >= 3 for word in words)
    )


def short_first_word_score_key(item: tuple[float, SegmentationPath]) -> tuple[float, int, int]:
    score, path = item
    short_words = sum(1 for word in path.words if len(word) <= 2)
    return (score, short_words, len(path.words))


def plausible_single_word_alignment(raw: str, word: str) -> bool:
    if raw[0] == word[0] and raw[-1] == word[-1]:
        return True
    if len(raw) == len(word) + 1 and (raw[1:] == word or raw[:-1] == word):
        return True
    if len(word) == len(raw) + 1 and (word[1:] == raw or word[:-1] == raw):
        return True
    return False


def load_language_model():
    import kenlm

    return kenlm.Model(str(DEFAULT_KENLM_MODEL_PATH))

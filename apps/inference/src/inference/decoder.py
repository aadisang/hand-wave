from collections.abc import Sequence


class CTCDecoder:
    def __init__(self, vocab: Sequence[str], blank: str = "_") -> None:
        self.vocab = list(vocab)
        self.blank = blank

    def greedy_decode_ids(self, ids: Sequence[int]) -> str:
        chars: list[str] = []
        last: str | None = None
        for idx in ids:
            if idx < 0 or idx >= len(self.vocab):
                continue
            char = self.vocab[idx]
            if char != self.blank and char != last:
                chars.append(char)
            last = char
        return "".join(chars)


class StablePrefixTracker:
    """Commits text only after repeated agreement across rolling-window decodes."""

    def __init__(self, min_stable_frames: int) -> None:
        self.min_stable_frames = min_stable_frames
        self.partial_text = ""
        self.stable_text = ""
        self._candidate = ""
        self._candidate_count = 0

    def update(self, partial_text: str) -> tuple[str, str]:
        prefix = common_prefix(self.partial_text, partial_text)
        self.partial_text = partial_text

        if len(prefix) <= len(self.stable_text):
            return self.partial_text, self.stable_text

        if prefix == self._candidate:
            self._candidate_count += 1
        else:
            self._candidate = prefix
            self._candidate_count = 1

        if self._candidate_count >= self.min_stable_frames:
            self.stable_text = self._candidate

        return self.partial_text, self.stable_text

    def reset(self) -> None:
        self.partial_text = ""
        self.stable_text = ""
        self._candidate = ""
        self._candidate_count = 0


def common_prefix(left: str, right: str) -> str:
    end = min(len(left), len(right))
    i = 0
    while i < end and left[i] == right[i]:
        i += 1
    return left[:i]

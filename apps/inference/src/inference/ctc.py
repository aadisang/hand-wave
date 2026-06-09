# pyright: reportPrivateImportUsage=false
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol, cast

import numpy as np

from inference.language import english_prior

logging.getLogger("pyctcdecode").setLevel(logging.ERROR)
from pyctcdecode import build_ctcdecoder  # noqa: E402

FSBOARD_CHARS = tuple(" !#$%&'()*+,-./0123456789:;=?@[_abcdefghijklmnopqrstuvwxyz~")
VOCAB = ("<blank>", *FSBOARD_CHARS)
LANGUAGE_SCORE_WEIGHT = 0.12


@dataclass(frozen=True)
class DecodedSpan:
    text: str
    start_frame: int
    end_frame: int


@dataclass(frozen=True)
class DecodedAlternative:
    text: str
    confidence: float
    logit_score: float
    lm_score: float
    raw_text: str
    spans: tuple[DecodedSpan, ...] = ()


@dataclass(frozen=True)
class DecodedText:
    text: str
    confidence: float
    alternatives: tuple[DecodedAlternative, ...]
    spans: tuple[DecodedSpan, ...]
    greedy_text: str
    blank_ratio: float
    tail_blank_ratio: float
    tail_blank_frames: int


@dataclass(frozen=True)
class BlankStats:
    blank_ratio: float
    tail_blank_ratio: float
    tail_blank_frames: int


class CtcDecoder(Protocol):
    def decode_beams(self, *args: object, **kwargs: object) -> list[object]: ...


def build_decoder() -> CtcDecoder:
    return cast(CtcDecoder, build_ctcdecoder(["", *FSBOARD_CHARS]))


def allowed_token_ids(chars: str) -> set[int]:
    allowed = {0}
    allowed.update(index for index, char in enumerate(VOCAB) if char in chars)
    return allowed


def mask_emissions(emissions: np.ndarray, allowed_ids: set[int]) -> np.ndarray:
    masked = np.full_like(emissions, -30.0)
    columns = sorted(allowed_ids)
    masked[:, columns] = emissions[:, columns]
    return masked


def greedy_decode(emissions: np.ndarray) -> str:
    token_ids = emissions.argmax(axis=1)
    collapsed: list[str] = []
    previous = -1
    for token_id in token_ids:
        current = int(token_id)
        if current != previous and current != 0:
            collapsed.append(VOCAB[current])
        previous = current
    return "".join(collapsed).strip()


def blank_stats(emissions: np.ndarray) -> BlankStats:
    if emissions.size == 0:
        return BlankStats(blank_ratio=0.0, tail_blank_ratio=0.0, tail_blank_frames=0)
    blank_probs = np.exp(emissions[:, 0])
    tail = blank_probs[-min(12, len(blank_probs)) :]
    tail_blank_frames = 0
    for prob in reversed(blank_probs):
        if prob < 0.65:
            break
        tail_blank_frames += 1
    return BlankStats(
        blank_ratio=float(np.clip(blank_probs.mean(), 0.0, 1.0)),
        tail_blank_ratio=float(np.clip(tail.mean(), 0.0, 1.0)),
        tail_blank_frames=tail_blank_frames,
    )


def decode_alternatives(
    decoder: CtcDecoder,
    emissions: np.ndarray,
    beam_width: int,
) -> tuple[DecodedAlternative, ...]:
    beams = decoder.decode_beams(
        emissions,
        beam_width=beam_width,
        beam_prune_logp=-10.0,
        token_min_logp=-5.0,
    )
    scored: list[tuple[str, float, float, float, str, tuple[DecodedSpan, ...]]] = []
    for beam in beams:
        raw = beam_text(beam).strip()
        if not raw:
            continue
        logit_score = beam_logit_score(beam)
        spans = beam_spans(beam)
        for variant in english_prior().variants(raw):
            scored.append(
                (
                    variant.text,
                    logit_score + LANGUAGE_SCORE_WEIGHT * variant.score,
                    logit_score,
                    variant.score,
                    raw,
                    spans,
                )
            )

    weights = softmax(np.asarray([score for _, score, *_ in scored], dtype=np.float64))
    alternatives: list[DecodedAlternative] = []
    seen: set[str] = set()
    for (text, _score, logit_score, lm_score, raw_text, spans), confidence in sorted(
        zip(scored, weights, strict=False),
        key=lambda item: item[0][1],
        reverse=True,
    ):
        if text in seen:
            continue
        seen.add(text)
        alternatives.append(
            DecodedAlternative(text, float(confidence), logit_score, lm_score, raw_text, spans)
        )
        if len(alternatives) == 5:
            break
    return tuple(alternatives)


def beam_text(beam: object) -> str:
    text = getattr(beam, "text", None)
    if text is not None:
        return str(text)
    return str(cast(tuple[object, ...], beam)[0])


def beam_spans(beam: object) -> tuple[DecodedSpan, ...]:
    raw_frames = getattr(beam, "text_frames", None)
    if raw_frames is None:
        raw_frames = cast(tuple[object, object, object], beam)[2]
    frames = cast(list[tuple[str, tuple[int, int]]], raw_frames)
    spans: list[DecodedSpan] = []
    for text, frame_range in frames:
        start_frame, end_frame = frame_range
        spans.append(
            DecodedSpan(
                text=str(text),
                start_frame=int(start_frame),
                end_frame=int(end_frame),
            )
        )
    return tuple(spans)


def beam_logit_score(beam: object) -> float:
    score = getattr(beam, "logit_score", None)
    if score is not None:
        return float(score)
    return float(cast(tuple[object, object, object, float], beam)[3])


def softmax(scores: np.ndarray) -> np.ndarray:
    if scores.size == 0:
        return scores
    shifted = scores - scores.max()
    weights = np.exp(shifted)
    total = weights.sum()
    if total <= 0:
        return np.zeros_like(scores)
    return weights / total

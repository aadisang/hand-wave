# pyright: reportPrivateImportUsage=false
from __future__ import annotations

import logging
from dataclasses import dataclass
from os import getenv
from pathlib import Path
from typing import Protocol, cast

import numpy as np

logging.getLogger("pyctcdecode").setLevel(logging.ERROR)
from pyctcdecode import build_ctcdecoder  # noqa: E402

FSBOARD_CHARS = tuple(" !#$%&'()*+,-./0123456789:;=?@[_abcdefghijklmnopqrstuvwxyz~")
VOCAB = ("<blank>", *FSBOARD_CHARS)
LM_DIR = Path(__file__).resolve().parents[2] / "models" / "lm"
DEFAULT_KENLM_MODEL_PATH = LM_DIR / "neutral_english_4gram.kenlm"
DEFAULT_UNIGRAMS_PATH = LM_DIR / "neutral_english_unigrams.txt"


@dataclass(frozen=True)
class CtcDecoderConfig:
    kenlm_model_path: Path | None
    unigram_path: Path | None
    alpha: float
    beta: float
    unk_score_offset: float
    beam_width: int = 50
    beam_prune_logp: float = -10.0
    token_min_logp: float = -5.0
    confidence_temperature: float = 1.2

    @classmethod
    def from_env(cls) -> CtcDecoderConfig:
        model_path = _env_path("KENLM_MODEL_PATH", DEFAULT_KENLM_MODEL_PATH)
        return cls(
            kenlm_model_path=model_path,
            unigram_path=_env_path("KENLM_UNIGRAMS_PATH", DEFAULT_UNIGRAMS_PATH),
            alpha=_env_float("CTC_ALPHA", 1.2),
            beta=_env_float("CTC_BETA", 2.0),
            unk_score_offset=_env_float("CTC_UNK_SCORE_OFFSET", -10.0),
            beam_width=_env_int("CTC_BEAM_WIDTH", 50),
            beam_prune_logp=_env_float("CTC_BEAM_PRUNE_LOGP", -10.0),
            token_min_logp=_env_float("CTC_TOKEN_MIN_LOGP", -5.0),
            confidence_temperature=_env_float("CTC_CONFIDENCE_TEMPERATURE", 1.2),
        )


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

    def reset_params(self, *args: object, **kwargs: object) -> None: ...


def build_decoder(config: CtcDecoderConfig | None = None) -> CtcDecoder:
    config = config or CtcDecoderConfig.from_env()
    if config.kenlm_model_path is None:
        return cast(CtcDecoder, build_ctcdecoder(["", *FSBOARD_CHARS]))

    if not config.kenlm_model_path.exists():
        raise FileNotFoundError(f"missing KenLM model: {config.kenlm_model_path}")
    if config.unigram_path is None or not config.unigram_path.exists():
        raise FileNotFoundError(f"missing KenLM unigrams: {config.unigram_path}")

    return cast(
        CtcDecoder,
        build_ctcdecoder(
            ["", *FSBOARD_CHARS],
            kenlm_model_path=str(config.kenlm_model_path),
            unigrams=load_unigrams(config.unigram_path),
            alpha=config.alpha,
            beta=config.beta,
            unk_score_offset=config.unk_score_offset,
        ),
    )


def load_unigrams(path: Path) -> tuple[str, ...]:
    return tuple(token for token in path.read_text().split() if token not in {"<s>", "</s>"})


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
    beam_prune_logp: float = -10.0,
    token_min_logp: float = -5.0,
    confidence_temperature: float = 1.0,
) -> tuple[DecodedAlternative, ...]:
    if confidence_temperature <= 0:
        raise ValueError("confidence_temperature must be positive")
    beams = decoder.decode_beams(
        emissions,
        beam_width=beam_width,
        beam_prune_logp=beam_prune_logp,
        token_min_logp=token_min_logp,
    )
    scored: list[tuple[str, float, float, float, tuple[DecodedSpan, ...]]] = []
    for beam in beams:
        text = beam_text(beam).strip()
        if not text:
            continue
        logit_score = beam_logit_score(beam)
        lm_score = beam_lm_score(beam)
        scored.append((text, logit_score + lm_score, logit_score, lm_score, beam_spans(beam)))

    weights = softmax(
        np.asarray(
            [score / confidence_temperature for _, score, *_ in scored],
            dtype=np.float64,
        )
    )
    alternatives: list[DecodedAlternative] = []
    seen: set[str] = set()
    for (text, _score, logit_score, lm_score, spans), confidence in sorted(
        zip(scored, weights, strict=False),
        key=lambda item: item[0][1],
        reverse=True,
    ):
        if text in seen:
            continue
        seen.add(text)
        alternatives.append(
            DecodedAlternative(text, float(confidence), logit_score, lm_score, text, spans)
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


def beam_lm_score(beam: object) -> float:
    score = getattr(beam, "lm_score", None)
    if score is not None:
        return float(score)
    return float(cast(tuple[object, object, object, float, float], beam)[4])


def softmax(scores: np.ndarray) -> np.ndarray:
    if scores.size == 0:
        return scores
    shifted = scores - scores.max()
    weights = np.exp(shifted)
    total = weights.sum()
    if total <= 0:
        return np.zeros_like(scores)
    return weights / total


def _env_path(name: str, default: Path) -> Path | None:
    value = getenv(name)
    if value == "":
        return None
    return Path(value) if value else default


def _env_float(name: str, default: float) -> float:
    value = getenv(name)
    return float(value) if value else default


def _env_int(name: str, default: int) -> int:
    value = getenv(name)
    return int(value) if value else default

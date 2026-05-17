# pyright: reportPrivateImportUsage=false
from __future__ import annotations

import logging
from dataclasses import dataclass
from os import getenv
from pathlib import Path
from typing import TYPE_CHECKING, cast

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as functional
from torchaudio.models import Conformer

if TYPE_CHECKING:
    from inference.schemas import LandmarkFrame

logging.getLogger("pyctcdecode").setLevel(logging.ERROR)
from pyctcdecode import build_ctcdecoder  # noqa: E402

N_HAND = 21
N_POSE = 33
N_JOINTS = N_HAND + N_POSE
IN_DIM = N_JOINTS * 3
SUBSAMPLE = 2
WRIST = 0
MIDDLE_FINGER_MCP = 9
FSBOARD_CHARS = [
    " ",
    "!",
    "#",
    "$",
    "%",
    "&",
    "'",
    "(",
    ")",
    "*",
    "+",
    ",",
    "-",
    ".",
    "/",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    ":",
    ";",
    "=",
    "?",
    "@",
    "[",
    "_",
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
    "y",
    "z",
    "~",
]
VOCAB = ("<blank>", *FSBOARD_CHARS)


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
class HandwaveModelConfig:
    in_dim: int = IN_DIM
    dim: int = 384
    num_heads: int = 6
    num_blocks: int = 12
    ff_expansion: int = 4
    conv_kernel: int = 17
    dropout: float = 0.1


@dataclass(frozen=True)
class BlankStats:
    blank_ratio: float
    tail_blank_ratio: float
    tail_blank_frames: int


class HandwaveModel(nn.Module):
    def __init__(self, cfg: HandwaveModelConfig, vocab_size: int) -> None:
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv1d(cfg.in_dim, cfg.dim, kernel_size=3, stride=2, padding=1),
            nn.SiLU(),
            nn.Conv1d(cfg.dim, cfg.dim, kernel_size=3, stride=1, padding=1),
            nn.SiLU(),
            nn.Dropout(cfg.dropout),
        )
        self.encoder = Conformer(
            input_dim=cfg.dim,
            num_heads=cfg.num_heads,
            ffn_dim=cfg.dim * cfg.ff_expansion,
            num_layers=cfg.num_blocks,
            depthwise_conv_kernel_size=cfg.conv_kernel,
            dropout=cfg.dropout,
        )
        self.head = nn.Linear(cfg.dim, vocab_size)

    def forward(
        self,
        features: torch.Tensor,
        raw_lengths: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        x = self.stem(features.transpose(1, 2)).transpose(1, 2)
        lengths = (raw_lengths + SUBSAMPLE - 1) // SUBSAMPLE
        x, lengths = self.encoder(x, lengths)
        return functional.log_softmax(self.head(x), dim=-1), lengths


class HandwaveRuntime:
    def __init__(self, checkpoint_path: str | Path, device: str = "auto") -> None:
        self.device = _resolve_device(device)
        self.model = _load_model(Path(checkpoint_path), self.device)
        kenlm_model_path = getenv("HANDWAVE_KENLM_PATH") or None
        self.decoder = build_ctcdecoder(
            ["", *FSBOARD_CHARS],
            kenlm_model_path=kenlm_model_path,
            alpha=float(getenv("HANDWAVE_LM_ALPHA", "0.5")),
            beta=float(getenv("HANDWAVE_LM_BETA", "1.0")),
        )
        self.beam_width = int(getenv("HANDWAVE_BEAM_WIDTH", "50"))
        self.hotwords = tuple(
            word.strip() for word in getenv("HANDWAVE_HOTWORDS", "").split(",") if word.strip()
        )
        self.hotword_weight = float(getenv("HANDWAVE_HOTWORD_WEIGHT", "8.0"))
        self.allowed_token_ids = _allowed_token_ids(
            getenv("HANDWAVE_ALLOWED_CHARS", "abcdefghijklmnopqrstuvwxyz ")
        )

    @torch.no_grad()
    def predict(self, frames: list[LandmarkFrame]) -> DecodedText:
        features = frames_to_features(frames)
        tensor = torch.from_numpy(features).unsqueeze(0).to(self.device)
        lengths = torch.tensor([features.shape[0]], device=self.device)
        log_probs, input_lengths = self.model(tensor, lengths)
        emissions = _single_emission(log_probs, input_lengths)
        emissions = _mask_emissions(emissions, self.allowed_token_ids)
        alternatives = self._decode(emissions)
        greedy_text = _greedy_decode(emissions)
        blank_stats = _blank_stats(emissions)
        frame_confidence = sequence_confidence(log_probs, input_lengths)[0]
        best = alternatives[0] if alternatives else DecodedAlternative("", 0.0, 0.0, 0.0)
        return DecodedText(
            text=best.text,
            confidence=best.confidence * frame_confidence,
            alternatives=alternatives,
            spans=best.spans,
            greedy_text=greedy_text,
            blank_ratio=blank_stats.blank_ratio,
            tail_blank_ratio=blank_stats.tail_blank_ratio,
            tail_blank_frames=blank_stats.tail_blank_frames,
        )

    def _decode(self, emissions: np.ndarray) -> tuple[DecodedAlternative, ...]:
        beams = self.decoder.decode_beams(
            emissions,
            beam_width=self.beam_width,
            beam_prune_logp=-10.0,
            token_min_logp=-5.0,
            hotwords=self.hotwords or None,
            hotword_weight=self.hotword_weight,
        )
        scores = np.asarray(
            [_beam_logit_score(beam) + _beam_lm_score(beam) for beam in beams], dtype=np.float64
        )
        weights = _softmax(scores)
        seen: set[str] = set()
        alternatives: list[DecodedAlternative] = []
        for beam, confidence in zip(beams, weights, strict=False):
            text = _beam_text(beam).strip()
            if not text or text in seen:
                continue
            seen.add(text)
            alternatives.append(
                DecodedAlternative(
                    text=text,
                    confidence=float(confidence),
                    logit_score=_beam_logit_score(beam),
                    lm_score=_beam_lm_score(beam),
                    spans=_beam_spans(beam),
                )
            )
            if len(alternatives) == 5:
                break
        return tuple(alternatives)


def _resolve_device(device: str) -> torch.device:
    if device == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(device)


def _load_model(checkpoint_path: Path, device: torch.device) -> HandwaveModel:
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"checkpoint not found: {checkpoint_path}")
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    hparams = checkpoint.get("hyper_parameters", {})
    raw_cfg = hparams.get("model_cfg", {}) if isinstance(hparams.get("model_cfg"), dict) else {}
    cfg = HandwaveModelConfig(**raw_cfg) if raw_cfg else HandwaveModelConfig()
    model = HandwaveModel(cfg, vocab_size=len(VOCAB))
    model.load_state_dict(_inner_model_state(checkpoint["state_dict"]))
    model.to(device).eval()
    return model


def _inner_model_state(state_dict: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    state = {
        key.removeprefix("model."): value
        for key, value in state_dict.items()
        if key.startswith("model.") and not key.startswith("model._orig_mod.")
    }
    if state:
        return state
    return {
        key.removeprefix("model._orig_mod."): value
        for key, value in state_dict.items()
        if key.startswith("model._orig_mod.")
    }


def frames_to_features(frames: list[LandmarkFrame]) -> np.ndarray:
    if not frames:
        raise ValueError("at least one frame is required")
    landmarks = np.asarray(frames, dtype=np.float32).reshape(len(frames), N_JOINTS, 3)
    if landmarks.shape[1:] != (N_JOINTS, 3):
        raise ValueError(
            f"expected each frame to contain {N_JOINTS} landmarks "
            f"(21 dominant hand + 33 pose); got {landmarks.shape[1]}"
        )
    hand = landmarks[:, :N_HAND, :]
    mask = np.asarray(
        np.isfinite(hand).reshape(hand.shape[0], -1).any(axis=1),
        dtype=np.float32,
    )
    normalized = hand_relative_normalize(landmarks)
    filled = fill_nans(normalized)
    features = filled.reshape(filled.shape[0], -1).astype(np.float32)
    return clip_cmvn(features, mask)


def hand_relative_normalize(landmarks: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    out = landmarks.astype(np.float32, copy=True)
    wrist = out[:, WRIST : WRIST + 1, :]
    out -= wrist
    palm_size = np.linalg.norm(out[:, MIDDLE_FINGER_MCP, :], axis=-1, keepdims=True)
    out /= np.maximum(palm_size, eps)[:, :, None]
    return out


def clip_cmvn(features: np.ndarray, mask: np.ndarray) -> np.ndarray:
    valid = features[mask.astype(bool)]
    if valid.shape[0] < 2:
        return features.astype(np.float32, copy=False)
    mean = valid.mean(axis=0, keepdims=True)
    std = np.maximum(valid.std(axis=0, keepdims=True), 1e-6)
    return ((features - mean) / std).astype(np.float32, copy=False)


def fill_nans(features: np.ndarray) -> np.ndarray:
    return np.where(np.isnan(features), 0.0, features).astype(np.float32, copy=False)


def _single_emission(log_probs: torch.Tensor, input_lengths: torch.Tensor) -> np.ndarray:
    length = int(input_lengths[0].detach().cpu())
    return log_probs[0, :length].detach().cpu().numpy()


def _allowed_token_ids(chars: str) -> set[int]:
    allowed = {0}
    allowed.update(index for index, char in enumerate(VOCAB) if char in chars)
    return allowed


def _mask_emissions(emissions: np.ndarray, allowed_token_ids: set[int]) -> np.ndarray:
    masked = np.full_like(emissions, -30.0)
    columns = sorted(allowed_token_ids)
    masked[:, columns] = emissions[:, columns]
    return masked


def _greedy_decode(emissions: np.ndarray) -> str:
    token_ids = emissions.argmax(axis=1)
    collapsed: list[str] = []
    previous = -1
    for token_id in token_ids:
        current = int(token_id)
        if current != previous and current != 0:
            collapsed.append(VOCAB[current])
        previous = current
    return "".join(collapsed).strip()


def _blank_stats(emissions: np.ndarray) -> BlankStats:
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


def _beam_text(beam: object) -> str:
    text = getattr(beam, "text", None)
    if text is not None:
        return str(text)
    return str(cast(tuple[object, ...], beam)[0])


def _beam_spans(beam: object) -> tuple[DecodedSpan, ...]:
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


def _beam_logit_score(beam: object) -> float:
    score = getattr(beam, "logit_score", None)
    if score is not None:
        return float(score)
    return float(cast(tuple[object, object, object, float], beam)[3])


def _beam_lm_score(beam: object) -> float:
    score = getattr(beam, "lm_score", None)
    if score is not None:
        return float(score)
    return float(cast(tuple[object, object, object, object, float], beam)[4])


def _softmax(scores: np.ndarray) -> np.ndarray:
    if scores.size == 0:
        return scores
    shifted = scores - scores.max()
    weights = np.exp(shifted)
    total = weights.sum()
    if total <= 0:
        return np.zeros_like(scores)
    return weights / total


def sequence_confidence(log_probs: torch.Tensor, input_lengths: torch.Tensor) -> list[float]:
    probs = log_probs.exp().amax(dim=-1).detach().cpu()
    lengths = input_lengths.detach().cpu()
    return [
        float(probs[index, : int(length)].mean().clamp(0, 1))
        for index, length in enumerate(lengths)
    ]

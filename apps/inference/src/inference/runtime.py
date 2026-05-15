# pyright: reportPrivateImportUsage=false
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as functional
from torchaudio.models import Conformer

if TYPE_CHECKING:
    from inference.schemas import LandmarkFrame

N_HAND = 21
N_POSE = 33
N_JOINTS = N_HAND + N_POSE
IN_DIM = N_JOINTS * 3
SUBSAMPLE = 2
WRIST = 0
MIDDLE_FINGER_MCP = 9
FSBOARD_CHARS = [
    " ", "!", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":", ";", "=", "?", "@",
    "[", "_", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
    "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "~",
]
VOCAB = ("<blank>", *FSBOARD_CHARS)


@dataclass(frozen=True)
class HandwaveModelConfig:
    in_dim: int = IN_DIM
    dim: int = 384
    num_heads: int = 6
    num_blocks: int = 12
    ff_expansion: int = 4
    conv_kernel: int = 17
    dropout: float = 0.1


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
        self, features: torch.Tensor, raw_lengths: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        x = self.stem(features.transpose(1, 2)).transpose(1, 2)
        lengths = (raw_lengths + SUBSAMPLE - 1) // SUBSAMPLE
        x, lengths = self.encoder(x, lengths)
        return functional.log_softmax(self.head(x), dim=-1), lengths


class HandwaveRuntime:
    def __init__(self, checkpoint_path: str | Path, device: str = "auto") -> None:
        self.device = _resolve_device(device)
        self.model = _load_model(Path(checkpoint_path), self.device)

    @torch.no_grad()
    def predict(self, frames: list[LandmarkFrame]) -> tuple[str, float]:
        features = frames_to_features(frames)
        tensor = torch.from_numpy(features).unsqueeze(0).to(self.device)
        lengths = torch.tensor([features.shape[0]], device=self.device)
        log_probs, input_lengths = self.model(tensor, lengths)
        text = greedy_decode(log_probs, input_lengths)[0]
        confidence = sequence_confidence(log_probs, input_lengths)[0]
        return text, confidence


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
    landmarks = np.array(
        [
            [[point.x, point.y, 0.0 if point.z is None else point.z] for point in frame.landmarks]
            for frame in frames
        ],
        dtype=np.float32,
    )
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
    wrist = out[:, WRIST:WRIST + 1, :]
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


def greedy_decode(log_probs: torch.Tensor, input_lengths: torch.Tensor) -> list[str]:
    ids = log_probs.argmax(dim=-1).cpu().numpy()
    lengths = input_lengths.cpu().numpy()
    return [_squash(ids[index, : int(length)], VOCAB) for index, length in enumerate(lengths)]


def _squash(sequence: np.ndarray, vocab: tuple[str, ...]) -> str:
    chars: list[str] = []
    previous = -1
    for token in sequence:
        token_id = int(token)
        if token_id == 0:
            previous = -1
            continue
        if token_id != previous:
            chars.append(vocab[token_id])
        previous = token_id
    return "".join(chars)


def sequence_confidence(log_probs: torch.Tensor, input_lengths: torch.Tensor) -> list[float]:
    probs = log_probs.exp().amax(dim=-1).detach().cpu()
    lengths = input_lengths.detach().cpu()
    return [
        float(probs[index, : int(length)].mean().clamp(0, 1))
        for index, length in enumerate(lengths)
    ]

# pyright: reportPrivateImportUsage=false
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as functional
from torchaudio.models import Conformer

from inference.features import IN_DIM

SUBSAMPLE = 2


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
        self,
        features: torch.Tensor,
        raw_lengths: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        x = self.stem(features.transpose(1, 2)).transpose(1, 2)
        lengths = (raw_lengths + SUBSAMPLE - 1) // SUBSAMPLE
        x, lengths = self.encoder(x, lengths)
        return functional.log_softmax(self.head(x), dim=-1), lengths


def resolve_device(device: str) -> torch.device:
    if device == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(device)


def load_model(
    checkpoint_path: Path,
    device: torch.device,
    vocab_size: int,
) -> HandwaveModel:
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"checkpoint not found: {checkpoint_path}")
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    hparams = checkpoint.get("hyper_parameters", {})
    raw_cfg = hparams.get("model_cfg", {}) if isinstance(hparams.get("model_cfg"), dict) else {}
    cfg = HandwaveModelConfig(**raw_cfg) if raw_cfg else HandwaveModelConfig()
    model = HandwaveModel(cfg, vocab_size=vocab_size)
    model.load_state_dict(inner_model_state(checkpoint["state_dict"]))
    model.to(device).eval()
    return model


def inner_model_state(state_dict: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
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


def sequence_confidence(log_probs: torch.Tensor, input_lengths: torch.Tensor) -> list[float]:
    probs = log_probs.exp().amax(dim=-1).detach().cpu()
    lengths = input_lengths.detach().cpu()
    return [
        float(probs[index, : int(length)].mean().clamp(0, 1))
        for index, length in enumerate(lengths)
    ]

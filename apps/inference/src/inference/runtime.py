# pyright: reportPrivateImportUsage=false
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np
import torch

from inference.ctc import (
    VOCAB,
    DecodedAlternative,
    DecodedText,
    allowed_token_ids,
    blank_stats,
    build_decoder,
    decode_alternatives,
    greedy_decode,
    mask_emissions,
)
from inference.features import frames_to_features
from inference.network import load_model, resolve_device, sequence_confidence
from inference.text_normalizer import normalize_prediction_text

if TYPE_CHECKING:
    from inference.schemas import LandmarkFrame
    from inference.settings import AssetSettings


@dataclass(frozen=True)
class RuntimeEmission:
    emissions: np.ndarray
    greedy_text: str
    blank_ratio: float
    tail_blank_ratio: float
    tail_blank_frames: int
    frame_confidence: float


class HandwaveRuntime:
    def __init__(self, assets: AssetSettings) -> None:
        self.device = resolve_device("auto")
        self.model = load_model(assets.model_checkpoint_path, self.device, vocab_size=len(VOCAB))
        self.decoder = build_decoder(assets.kenlm_model_path, assets.kenlm_unigrams_path)
        self.allowed_token_ids = allowed_token_ids("abcdefghijklmnopqrstuvwxyz ")

    @torch.no_grad()
    def predict(self, frames: list[LandmarkFrame]) -> DecodedText:
        return self.decode_emission(self.encode(frames))

    @torch.no_grad()
    def encode(self, frames: list[LandmarkFrame]) -> RuntimeEmission:
        features = frames_to_features(frames)
        tensor = torch.from_numpy(features).unsqueeze(0).to(self.device)
        lengths = torch.tensor([features.shape[0]], device=self.device)
        log_probs, input_lengths = self.model(tensor, lengths)
        emissions = single_emission(log_probs, input_lengths)
        emissions = mask_emissions(emissions, self.allowed_token_ids)
        blanks = blank_stats(emissions)
        return RuntimeEmission(
            emissions=emissions,
            greedy_text=greedy_decode(emissions),
            blank_ratio=blanks.blank_ratio,
            tail_blank_ratio=blanks.tail_blank_ratio,
            tail_blank_frames=blanks.tail_blank_frames,
            frame_confidence=sequence_confidence(log_probs, input_lengths)[0],
        )

    def decode_emission(self, emission: RuntimeEmission) -> DecodedText:
        emissions = emission.emissions
        alternatives = decode_alternatives(self.decoder, emissions)
        best = alternatives[0] if alternatives else DecodedAlternative("", 0.0, 0.0, 0.0, "")
        return DecodedText(
            text=normalize_prediction_text(best.text),
            confidence=best.confidence * emission.frame_confidence,
            alternatives=alternatives,
            spans=best.spans,
            greedy_text=emission.greedy_text,
            blank_ratio=emission.blank_ratio,
            tail_blank_ratio=emission.tail_blank_ratio,
            tail_blank_frames=emission.tail_blank_frames,
        )


def single_emission(log_probs: torch.Tensor, input_lengths: torch.Tensor) -> np.ndarray:
    length = int(input_lengths[0].detach().cpu())
    return log_probs[0, :length].detach().cpu().numpy()

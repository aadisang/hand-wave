# pyright: reportPrivateImportUsage=false
from __future__ import annotations

from pathlib import Path
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

if TYPE_CHECKING:
    from inference.schemas import LandmarkFrame


class HandwaveRuntime:
    def __init__(self, checkpoint_path: str | Path, device: str = "auto") -> None:
        self.device = resolve_device(device)
        self.model = load_model(Path(checkpoint_path), self.device, vocab_size=len(VOCAB))
        self.decoder = build_decoder()
        self.beam_width = 50
        self.allowed_token_ids = allowed_token_ids("abcdefghijklmnopqrstuvwxyz ")

    @torch.no_grad()
    def predict(self, frames: list[LandmarkFrame]) -> DecodedText:
        features = frames_to_features(frames)
        tensor = torch.from_numpy(features).unsqueeze(0).to(self.device)
        lengths = torch.tensor([features.shape[0]], device=self.device)
        log_probs, input_lengths = self.model(tensor, lengths)
        emissions = single_emission(log_probs, input_lengths)
        emissions = mask_emissions(emissions, self.allowed_token_ids)
        alternatives = self._decode(emissions)
        greedy_text = greedy_decode(emissions)
        blanks = blank_stats(emissions)
        frame_confidence = sequence_confidence(log_probs, input_lengths)[0]
        best = alternatives[0] if alternatives else DecodedAlternative("", 0.0, 0.0, 0.0, "")
        return DecodedText(
            text=best.text,
            confidence=best.confidence * frame_confidence,
            alternatives=alternatives,
            spans=best.spans,
            greedy_text=greedy_text,
            blank_ratio=blanks.blank_ratio,
            tail_blank_ratio=blanks.tail_blank_ratio,
            tail_blank_frames=blanks.tail_blank_frames,
        )

    def _decode(self, emissions: np.ndarray) -> tuple[DecodedAlternative, ...]:
        return decode_alternatives(self.decoder, emissions, self.beam_width)


def single_emission(log_probs: torch.Tensor, input_lengths: torch.Tensor) -> np.ndarray:
    length = int(input_lengths[0].detach().cpu())
    return log_probs[0, :length].detach().cpu().numpy()

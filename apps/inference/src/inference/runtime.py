# pyright: reportPrivateImportUsage=false
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import torch

from inference.ctc import VOCAB, CtcDecoderConfig, DecodedText
from inference.decoder import EmissionDecoder, RuntimeEmission
from inference.features import frames_to_features
from inference.network import load_model, resolve_device, sequence_confidence

if TYPE_CHECKING:
    from inference.schemas import LandmarkFrame


class HandwaveRuntime:
    def __init__(
        self,
        checkpoint_path: str | Path,
        device: str = "auto",
        decoder_config: CtcDecoderConfig | None = None,
        emission_decoder: EmissionDecoder | None = None,
    ) -> None:
        self.device = resolve_device(device)
        self.model = load_model(Path(checkpoint_path), self.device, vocab_size=len(VOCAB))
        self.emission_decoder = emission_decoder or EmissionDecoder(decoder_config)

    @torch.no_grad()
    def predict(self, frames: list[LandmarkFrame]) -> DecodedText:
        emission = self.encode(frames)
        return self.emission_decoder.decode_values(
            emission.emissions,
            emission.frame_confidence,
        )

    @torch.no_grad()
    def encode(self, frames: list[LandmarkFrame]) -> RuntimeEmission:
        features = frames_to_features(frames)
        tensor = torch.from_numpy(features).unsqueeze(0).to(self.device)
        lengths = torch.tensor([features.shape[0]], device=self.device)
        log_probs, input_lengths = self.model(tensor, lengths)
        emissions = single_emission(log_probs, input_lengths)
        return RuntimeEmission(
            emissions=emissions,
            frame_confidence=sequence_confidence(log_probs, input_lengths)[0],
        )


def single_emission(log_probs: torch.Tensor, input_lengths: torch.Tensor) -> np.ndarray:
    length = int(input_lengths[0].detach().cpu())
    return log_probs[0, :length].detach().cpu().numpy()

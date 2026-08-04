from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from inference.ctc import (
    VOCAB,
    CtcDecoderConfig,
    DecodedAlternative,
    DecodedText,
    allowed_token_ids,
    blank_stats,
    build_decoder,
    decode_alternatives,
    greedy_decode,
    mask_emissions,
)
from inference.text_normalizer import normalize_prediction_text


@dataclass(frozen=True)
class RuntimeEmission:
    emissions: np.ndarray
    frame_confidence: float


class EmissionDecoder:
    def __init__(self, decoder_config: CtcDecoderConfig | None = None) -> None:
        decoder_config = decoder_config or CtcDecoderConfig.from_env()
        self.decoder = build_decoder(decoder_config)
        self.beam_width = decoder_config.beam_width
        self.beam_prune_logp = decoder_config.beam_prune_logp
        self.token_min_logp = decoder_config.token_min_logp
        self.confidence_temperature = decoder_config.confidence_temperature
        self.hotwords = decoder_config.hotwords
        self.hotword_weight = decoder_config.hotword_weight
        self.allowed_token_ids = allowed_token_ids("abcdefghijklmnopqrstuvwxyz ")

    def decode_values(
        self,
        values: list[list[float]] | np.ndarray,
        frame_confidence: float,
    ) -> DecodedText:
        emissions = np.asarray(values, dtype=np.float32)
        if emissions.ndim != 2 or emissions.shape[1] != len(VOCAB):
            raise ValueError(f"expected emissions shaped [time, {len(VOCAB)}]")
        masked = mask_emissions(emissions, self.allowed_token_ids)
        blanks = blank_stats(masked)
        alternatives = decode_alternatives(
            self.decoder,
            masked,
            self.beam_width,
            beam_prune_logp=self.beam_prune_logp,
            token_min_logp=self.token_min_logp,
            confidence_temperature=self.confidence_temperature,
            hotwords=self.hotwords,
            hotword_weight=self.hotword_weight,
        )
        best = alternatives[0] if alternatives else DecodedAlternative("", 0.0, 0.0, 0.0, "")
        return DecodedText(
            text=normalize_prediction_text(best.text),
            confidence=best.confidence * float(np.clip(frame_confidence, 0.0, 1.0)),
            alternatives=alternatives,
            spans=best.spans,
            greedy_text=greedy_decode(masked),
            blank_ratio=blanks.blank_ratio,
            tail_blank_ratio=blanks.tail_blank_ratio,
            tail_blank_frames=blanks.tail_blank_frames,
        )

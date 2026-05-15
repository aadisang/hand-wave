from collections.abc import Sequence
from dataclasses import dataclass
from os import getenv
from pathlib import Path

from inference.schemas import LandmarkFrame, Prediction, PredictionSpan, PredictResponse

DEFAULT_VOCAB = ["_"] + list("abcdefghijklmnopqrstuvwxyz0123456789 &'@.")
DEFAULT_CHECKPOINT_PATH = Path(__file__).resolve().parents[2] / "models" / "best.ckpt"


@dataclass(frozen=True)
class ModelConfig:
    checkpoint_path: str | None
    vocab: tuple[str, ...] = tuple(DEFAULT_VOCAB)


class ModelBackend:
    async def predict_frames(self, frames: Sequence[LandmarkFrame]) -> PredictResponse:
        raise NotImplementedError


class PlaceholderBackend(ModelBackend):
    """Deterministic backend for tests and local API-shape checks."""

    def __init__(self, config: ModelConfig) -> None:
        self.config = config

    async def predict_frames(self, frames: Sequence[LandmarkFrame]) -> PredictResponse:
        label = "" if len(frames) < 8 else "waiting"
        confidence = 0.0 if not label else 0.05
        return PredictResponse(
            prediction=Prediction(label=label, confidence=confidence),
            alternatives=[],
            partial_text="",
            stable_text="",
        )


class CheckpointBackend(ModelBackend):
    def __init__(self, config: ModelConfig) -> None:
        if config.checkpoint_path is None:
            raise ValueError("checkpoint_path is required")
        from inference.runtime import HandwaveRuntime

        self.config = config
        self.runtime = HandwaveRuntime(
            config.checkpoint_path,
            device=getenv("HANDWAVE_DEVICE", "auto"),
        )

    async def predict_frames(self, frames: Sequence[LandmarkFrame]) -> PredictResponse:
        decoded = self.runtime.predict(list(frames))
        return PredictResponse(
            prediction=Prediction(
                label=decoded.text,
                confidence=decoded.confidence,
                logit_score=decoded.alternatives[0].logit_score if decoded.alternatives else None,
                lm_score=decoded.alternatives[0].lm_score if decoded.alternatives else None,
            ),
            alternatives=[
                Prediction(
                    label=item.text,
                    confidence=item.confidence,
                    logit_score=item.logit_score,
                    lm_score=item.lm_score,
                )
                for item in decoded.alternatives[1:]
            ],
            spans=[
                PredictionSpan(
                    text=span.text,
                    start_frame=span.start_frame,
                    end_frame=span.end_frame,
                )
                for span in decoded.spans
            ],
            greedy_text=decoded.greedy_text,
            blank_ratio=decoded.blank_ratio,
            tail_blank_ratio=decoded.tail_blank_ratio,
            tail_blank_frames=decoded.tail_blank_frames,
            partial_text=decoded.text,
            stable_text="",
        )


def load_backend() -> ModelBackend:
    if getenv("HANDWAVE_BACKEND") == "placeholder":
        return PlaceholderBackend(ModelConfig(checkpoint_path=None))
    checkpoint_path = getenv("HANDWAVE_CHECKPOINT_PATH", str(DEFAULT_CHECKPOINT_PATH))
    config = ModelConfig(checkpoint_path=checkpoint_path)
    return CheckpointBackend(config)

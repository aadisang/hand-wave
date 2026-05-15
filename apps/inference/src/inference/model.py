from collections.abc import Sequence
from dataclasses import dataclass
from os import getenv
from pathlib import Path

from inference.schemas import LandmarkFrame, Prediction, PredictResponse

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
        text, confidence = self.runtime.predict(list(frames))
        return PredictResponse(
            prediction=Prediction(label=text, confidence=confidence),
            alternatives=[],
            partial_text=text,
            stable_text="",
        )


def load_backend() -> ModelBackend:
    if getenv("HANDWAVE_BACKEND") == "placeholder":
        return PlaceholderBackend(ModelConfig(checkpoint_path=None))
    checkpoint_path = getenv("HANDWAVE_CHECKPOINT_PATH", str(DEFAULT_CHECKPOINT_PATH))
    config = ModelConfig(checkpoint_path=checkpoint_path)
    return CheckpointBackend(config)

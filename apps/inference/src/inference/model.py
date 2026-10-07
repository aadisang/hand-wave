import asyncio
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from os import getenv
from pathlib import Path

from inference.ctc import DecodedText
from inference.schemas import Emission, LandmarkFrame, Prediction, PredictOut, Span
from inference.text_normalizer import normalize_prediction_text

DEFAULT_MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
MODELS_DIR = Path(getenv("MODEL_DIR", str(DEFAULT_MODELS_DIR)))
MODEL_CHECKPOINT_PATH_ENV = "MODEL_CHECKPOINT_PATH"
DECODER_ONLY_ENV = "HANDWAVE_DECODER_ONLY"


class ModelBackend:
    async def predict_frames(self, frames: Sequence[LandmarkFrame]) -> PredictOut:
        raise NotImplementedError

    async def predict_emission(self, emission: Emission) -> PredictOut:
        raise NotImplementedError


class CheckpointBackend(ModelBackend):
    def __init__(self, checkpoint_path: Path) -> None:
        from inference.decoder import EmissionDecoder
        from inference.runtime import HandwaveRuntime

        self.decoder = EmissionDecoder()
        self.runtime = HandwaveRuntime(
            checkpoint_path,
            emission_decoder=self.decoder,
        )
        # Cancellation cannot stop native model work once it has entered a
        # thread. A single-worker executor keeps the runtime serial even when
        # the task awaiting an older prediction gets cancelled.
        self._inference_executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="handwave-inference",
        )

    async def predict_frames(self, frames: Sequence[LandmarkFrame]) -> PredictOut:
        frame_batch = list(frames)
        loop = asyncio.get_running_loop()
        decoded = await loop.run_in_executor(
            self._inference_executor,
            self.runtime.predict,
            frame_batch,
        )
        return decoded_to_predict_out(decoded)

    async def predict_emission(self, emission: Emission) -> PredictOut:
        loop = asyncio.get_running_loop()
        decoded = await loop.run_in_executor(
            self._inference_executor,
            self.decoder.decode_values,
            [frame.root for frame in emission.values],
            emission.frame_confidence,
        )
        return decoded_to_predict_out(decoded)


class DecoderBackend(ModelBackend):
    def __init__(self) -> None:
        from inference.decoder import EmissionDecoder

        self.decoder = EmissionDecoder()
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="handwave-decoder",
        )

    async def predict_frames(self, frames: Sequence[LandmarkFrame]) -> PredictOut:
        raise ValueError("this endpoint accepts on-device model emissions only")

    async def predict_emission(self, emission: Emission) -> PredictOut:
        loop = asyncio.get_running_loop()
        decoded = await loop.run_in_executor(
            self._executor,
            self.decoder.decode_values,
            [frame.root for frame in emission.values],
            emission.frame_confidence,
        )
        return decoded_to_predict_out(decoded)


def decoded_to_predict_out(decoded: DecodedText) -> PredictOut:
    best = decoded.alternatives[0] if decoded.alternatives else None
    frame_confidence = (
        decoded.confidence / best.confidence if best is not None and best.confidence > 0 else 1.0
    )
    label = normalize_prediction_text(decoded.text)
    return PredictOut(
        prediction=Prediction(
            label=label,
            confidence=decoded.confidence,
            logit_score=best.logit_score if best else None,
            lm_score=best.lm_score if best else None,
            raw_label=best.raw_text if best else None,
        ),
        alternatives=[
            Prediction(
                label=item.text,
                confidence=item.confidence * frame_confidence,
                logit_score=item.logit_score,
                lm_score=item.lm_score,
                raw_label=item.raw_text,
            )
            for item in decoded.alternatives[1:]
        ],
        spans=[
            Span(
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
        partial_text=label,
        stable_text="",
    )


def load_backend() -> ModelBackend:
    if getenv(DECODER_ONLY_ENV) == "1":
        return DecoderBackend()
    return CheckpointBackend(resolve_checkpoint_path())


def resolve_checkpoint_path(models_dir: Path = MODELS_DIR) -> Path:
    explicit = getenv(MODEL_CHECKPOINT_PATH_ENV)
    if explicit:
        checkpoint = Path(explicit)
        if not checkpoint.exists():
            raise FileNotFoundError(f"checkpoint not found: {checkpoint}")
        return checkpoint

    checkpoints = sorted(models_dir.glob("*.ckpt"))
    if not checkpoints:
        raise FileNotFoundError(f"expected one .ckpt model under {models_dir}")
    if len(checkpoints) > 1:
        names = ", ".join(path.name for path in checkpoints)
        raise RuntimeError(f"expected one .ckpt model under {models_dir}, found: {names}")
    return checkpoints[0]

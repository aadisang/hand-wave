from __future__ import annotations

import shutil
from pathlib import Path

import coremltools as ct
import numpy as np
import onnx
import onnxruntime as ort
import torch
import torch.nn as nn
import torch.nn.functional as functional
from onnxruntime.transformers.float16 import convert_float_to_float16

from inference.ctc import VOCAB
from inference.features import frames_to_features
from inference.network import load_model

ROOT = Path(__file__).resolve().parents[3]
CHECKPOINT = ROOT / "apps/inference/models/best.ckpt"
WEB_MODEL = ROOT / "apps/web/public/models/handwave-local.onnx"
IOS_MODEL = ROOT / "apps/mobile/HandWave/Resources/HandWaveLocal.mlpackage"
MISSING_LANDMARK = -8192.0


class LocalHandwaveModel(nn.Module):
    """The raw-landmark, batch-one graph used by both apps.

    Live requests contain one unpadded window, so the server model's padding
    mask is all false. Removing that mask makes the graph portable without
    changing its result. Keeping preprocessing here gives every client the
    server's exact feature transform without a second implementation.
    """

    def __init__(self, source: nn.Module) -> None:
        super().__init__()
        self.stem = source.stem
        self.layers = source.encoder.conformer_layers
        self.head = source.head

    def forward(self, landmarks: torch.Tensor) -> torch.Tensor:
        features = self.preprocess(landmarks)
        x = self.stem(features.transpose(1, 2)).transpose(1, 2).transpose(0, 1)
        for layer in self.layers:
            x = layer(x, None)
        return functional.log_softmax(self.head(x.transpose(0, 1)), dim=-1)

    @staticmethod
    def preprocess(landmarks: torch.Tensor) -> torch.Tensor:
        batch, frames, _ = landmarks.shape
        points = landmarks.reshape(batch, frames, 54, 3)
        missing = points == MISSING_LANDMARK
        valid = (~missing[:, :, :21, :]).reshape(batch, frames, -1).any(dim=-1)
        filled = torch.where(missing, torch.zeros_like(points), points)

        wrist = filled[:, :, :1, :]
        relative = filled - wrist
        coordinate_valid = torch.logical_and(
            ~missing,
            ~missing[:, :, :1, :],
        )
        relative = torch.where(coordinate_valid, relative, torch.zeros_like(relative))
        palm_valid = coordinate_valid[:, :, 9, :].all(dim=-1, keepdim=True)
        palm_size = torch.linalg.vector_norm(relative[:, :, 9, :], dim=-1, keepdim=True)
        relative = relative / palm_size.clamp_min(1e-6).unsqueeze(-1)
        features = torch.where(
            palm_valid.unsqueeze(-1),
            relative,
            torch.zeros_like(relative),
        ).reshape(batch, frames, 162)

        weights = valid.unsqueeze(-1).to(features.dtype)
        count = weights.sum(dim=1, keepdim=True)
        denominator = count.clamp_min(1.0)
        mean = (features * weights).sum(dim=1, keepdim=True) / denominator
        difference = features - mean
        variance = (difference.square() * weights).sum(dim=1, keepdim=True) / denominator
        standardized = difference / variance.sqrt().clamp_min(1e-6)
        return torch.where(count >= 2, standardized, features)


def main() -> None:
    torch.manual_seed(0)
    source = load_model(CHECKPOINT, torch.device("cpu"), len(VOCAB)).eval()
    model = LocalHandwaveModel(source).eval()
    sample = torch.randn(1, 96, 162)
    time = torch.export.Dim("time", min=18, max=192)
    dynamic_shapes = ({1: time},)

    verify_wrapper(source, model)
    export_web(model, sample, dynamic_shapes)
    export_ios(model, sample, dynamic_shapes)


def verify_wrapper(source: nn.Module, model: nn.Module) -> None:
    for frames in (18, 19, 37, 96, 191, 192):
        landmarks = sample_landmarks(frames, include_missing=True)
        features = torch.from_numpy(frames_to_features(landmarks[0].tolist())).unsqueeze(0)
        with torch.inference_mode():
            expected, _ = source(features, torch.tensor([frames]))
            actual = model(encode_landmarks(landmarks))
        torch.testing.assert_close(actual, expected, rtol=1e-4, atol=1e-4)
        if actual.argmax(dim=-1).tolist() != expected.argmax(dim=-1).tolist():
            raise RuntimeError(f"local wrapper token output changed at {frames} frames")


def export_web(
    model: nn.Module,
    sample: torch.Tensor,
    dynamic_shapes: tuple[dict[int, object]],
) -> None:
    WEB_MODEL.parent.mkdir(parents=True, exist_ok=True)
    data_path = WEB_MODEL.with_suffix(f"{WEB_MODEL.suffix}.data")
    WEB_MODEL.unlink(missing_ok=True)
    data_path.unlink(missing_ok=True)

    torch.onnx.export(
        model,
        (sample,),
        WEB_MODEL,
        input_names=["landmarks"],
        output_names=["log_probs"],
        dynamic_shapes=dynamic_shapes,
        dynamo=True,
        external_data=True,
        opset_version=18,
    )
    exported = onnx.load(WEB_MODEL, load_external_data=True)
    converted = convert_float_to_float16(exported, keep_io_types=True)
    data_path.unlink(missing_ok=True)
    onnx.save_model(
        converted,
        WEB_MODEL,
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=data_path.name,
        size_threshold=1_024,
    )
    verify_web(model)


def verify_web(model: nn.Module) -> None:
    session = ort.InferenceSession(WEB_MODEL, providers=["CPUExecutionProvider"])
    for frames in (18, 19, 37, 96, 191, 192):
        landmarks = sample_landmarks(frames, include_missing=True)
        encoded = encode_landmarks(landmarks)
        with torch.inference_mode():
            expected = model(encoded).numpy()
        actual = session.run(["log_probs"], {"landmarks": encoded.numpy()})[0]
        verify_converted_output("web", frames, expected, actual)


def export_ios(
    model: nn.Module,
    sample: torch.Tensor,
    dynamic_shapes: tuple[dict[int, object]],
) -> None:
    program = torch.export.export(
        model,
        (sample,),
        dynamic_shapes=dynamic_shapes,
        strict=True,
    ).run_decompositions({})
    converted = ct.convert(
        program,
        inputs=[ct.TensorType(name="landmarks")],
        outputs=[ct.TensorType(name="log_probs")],
        minimum_deployment_target=ct.target.iOS18,
        compute_precision=ct.precision.FLOAT16,
    )
    if IOS_MODEL.exists():
        shutil.rmtree(IOS_MODEL)
    converted.save(IOS_MODEL)
    verify_ios(model, converted)


def verify_ios(model: nn.Module, converted: ct.models.MLModel) -> None:
    for frames in (18, 19, 37, 96, 191, 192):
        landmarks = sample_landmarks(frames, include_missing=True)
        encoded = encode_landmarks(landmarks)
        with torch.inference_mode():
            expected = model(encoded).numpy()
        actual = converted.predict({"landmarks": encoded.numpy()})["log_probs"]
        verify_converted_output("iOS", frames, expected, actual)


def verify_converted_output(
    target: str,
    frames: int,
    expected: np.ndarray,
    actual: np.ndarray,
) -> None:
    if not np.isfinite(actual).all():
        invalid_values = int(actual.size - np.isfinite(actual).sum())
        raise RuntimeError(
            f"{target} model returned {invalid_values} non-finite logits at {frames} frames"
        )
    maximum_difference = float(np.max(np.abs(actual - expected)))
    if maximum_difference > 0.1:
        raise RuntimeError(
            f"{target} model logits changed at {frames} frames: {maximum_difference:.4f}"
        )
    top_two = np.partition(expected, -2, axis=-1)[..., -2:]
    stable = top_two[..., 1] - top_two[..., 0] >= 0.25
    expected_tokens = expected.argmax(axis=-1)
    actual_tokens = actual.argmax(axis=-1)
    if np.any(expected_tokens[stable] != actual_tokens[stable]):
        changed = np.flatnonzero((expected_tokens != actual_tokens) & stable).tolist()
        raise RuntimeError(f"{target} model changed stable tokens at {frames} frames: {changed}")


def sample_landmarks(frames: int, *, include_missing: bool) -> torch.Tensor:
    landmarks = torch.randn(1, frames, 162)
    if include_missing:
        landmarks[:, frames // 3, :63] = torch.nan
        landmarks[:, frames // 2, 80] = torch.nan
    return landmarks


def encode_landmarks(landmarks: torch.Tensor) -> torch.Tensor:
    return torch.nan_to_num(landmarks, nan=MISSING_LANDMARK)


if __name__ == "__main__":
    main()

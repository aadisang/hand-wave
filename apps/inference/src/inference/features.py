from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from inference.schemas import frame_values

if TYPE_CHECKING:
    from inference.schemas import LandmarkFrame

N_HAND = 21
N_POSE = 33
N_JOINTS = N_HAND + N_POSE
IN_DIM = N_JOINTS * 3
WRIST = 0
MIDDLE_FINGER_MCP = 9


def frames_to_features(frames: list[LandmarkFrame]) -> np.ndarray:
    if not frames:
        raise ValueError("at least one frame is required")
    landmarks = np.asarray([frame_values(frame) for frame in frames], dtype=np.float32).reshape(
        len(frames), N_JOINTS, 3
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
    wrist = out[:, WRIST : WRIST + 1, :]
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

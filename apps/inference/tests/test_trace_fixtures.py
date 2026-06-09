from __future__ import annotations

import json
import re
from functools import cache
from pathlib import Path
from typing import Any

import pytest

from inference.model import resolve_checkpoint_path
from inference.runtime import HandwaveRuntime
from inference.schemas import LandmarkFrame

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "traces"


def fixture_paths() -> list[Path]:
    return sorted(FIXTURE_DIR.glob("*.json"))


@cache
def runtime() -> HandwaveRuntime:
    return HandwaveRuntime(resolve_checkpoint_path(), device="cpu")


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def replay_frames(recording: dict[str, Any]) -> list[LandmarkFrame]:
    frames = []
    for frame in recording.get("frames", []):
        features = frame.get("features")
        if features is not None:
            frames.append(LandmarkFrame(root=features))
    return frames


def expected_texts(recording: dict[str, Any]) -> list[str]:
    expected = recording.get("expectedTexts")
    if isinstance(expected, list):
        return [str(item).strip() for item in expected if str(item).strip()]
    single = recording.get("expectedText") or recording.get("label") or ""
    return [str(single).strip()] if str(single).strip() else []


def test_trace_fixture_directory_exists() -> None:
    assert FIXTURE_DIR.exists()


@pytest.mark.parametrize("path", fixture_paths(), ids=lambda path: path.name)
def test_recorded_mediapipe_trace_replays_through_runtime(path: Path) -> None:
    fixture = json.loads(path.read_text())
    recordings = fixture.get("recordings", [])

    assert fixture.get("schemaVersion", 0) >= 3
    assert recordings, f"{path.name} has no recordings"

    for recording in recordings:
        expected = expected_texts(recording)
        frames = replay_frames(recording)

        assert expected, f"{path.name} has an unlabeled recording"
        assert frames, f"{path.name}:{expected[0]} has no replayable feature frames"

        decoded = runtime().predict(frames)
        normalized_expected = {normalize_text(item) for item in expected}

        assert normalize_text(decoded.text) in normalized_expected, {
            "fixture": path.name,
            "expected": expected,
            "decoded": decoded.text,
            "greedy": decoded.greedy_text,
            "confidence": decoded.confidence,
            "alternatives": [item.text for item in decoded.alternatives],
        }

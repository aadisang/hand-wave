from dataclasses import dataclass

import numpy as np

from inference.runtime import HandwaveRuntime


@dataclass(frozen=True)
class FakeBeam:
    text: str
    logit_score: float
    text_frames: list[tuple[str, tuple[int, int]]]


class FakeDecoder:
    def __init__(self, beams: list[FakeBeam]) -> None:
        self._beams = beams

    def decode_beams(self, *_args: object, **_kwargs: object) -> list[FakeBeam]:
        return self._beams


def test_low_frequency_name_suffix_can_beat_english_prefix() -> None:
    runtime = object.__new__(HandwaveRuntime)
    runtime.decoder = FakeDecoder(
        [
            FakeBeam("shive", 0.0, [("shive", (0, 10))]),
            FakeBeam("shiven", 0.25, [("shiven", (0, 12))]),
        ],
    )
    runtime.beam_width = 50

    alternatives = runtime._decode(np.zeros((1, 1), dtype=np.float32))

    assert alternatives[0].text == "shiven"

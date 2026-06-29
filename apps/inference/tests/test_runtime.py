from dataclasses import dataclass

import numpy as np

from inference.ctc import VOCAB, CtcDecoderConfig, build_decoder, decode_alternatives
from inference.runtime import HandwaveRuntime


@dataclass(frozen=True)
class FakeBeam:
    text: str
    logit_score: float
    lm_score: float
    text_frames: list[tuple[str, tuple[int, int]]]


class FakeDecoder:
    def __init__(self, beams: list[FakeBeam]) -> None:
        self._beams = beams

    def decode_beams(self, *_args: object, **_kwargs: object) -> list[FakeBeam]:
        return self._beams


def test_decoder_builds_with_neutral_lm() -> None:
    decoder = build_decoder()
    assert decoder.decode_beams(np.zeros((1, len(VOCAB)), dtype=np.float32), beam_width=1)


def test_decoder_without_lm_is_explicit_fallback() -> None:
    decoder = build_decoder(
        CtcDecoderConfig(
            kenlm_model_path=None,
            unigram_path=None,
            alpha=0.5,
            beta=1.5,
            unk_score_offset=-10,
        )
    )
    assert decoder.decode_beams(np.zeros((1, len(VOCAB)), dtype=np.float32), beam_width=1)


def test_decode_alternatives_come_directly_from_beam_search() -> None:
    runtime = object.__new__(HandwaveRuntime)
    runtime.decoder = FakeDecoder(
        [
            FakeBeam("hell o", 0.0, -1.0, [("hell", (0, 4)), ("o", (5, 6))]),
            FakeBeam("hello", -0.5, -2.0, [("hello", (0, 6))]),
        ],
    )
    runtime.beam_width = 50

    alternatives = runtime._decode(np.zeros((1, 1), dtype=np.float32))

    assert alternatives[0].text == "hell o"
    assert alternatives[0].raw_text == "hell o"
    assert alternatives[0].lm_score == -1.0


def test_decode_alternatives_deduplicate_exact_beam_text() -> None:
    alternatives = decode_alternatives(
        FakeDecoder(
            [
                FakeBeam("hello", 0.0, -1.0, []),
                FakeBeam("hello", -0.5, -1.5, []),
            ]
        ),
        np.zeros((1, 1), dtype=np.float32),
        beam_width=50,
    )

    assert [item.text for item in alternatives] == ["hello"]

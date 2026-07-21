import pytest

from inference import text_normalizer
from inference.text_normalizer import normalize_prediction_text


@pytest.mark.parametrize(
    ("raw", "expected"),
    (
        ("mynam", "my name"),
        ("ilouveyou", "i love you"),
        ("ilouveyouo", "i love you"),
        ("openthecalandar", "open the calendar"),
        ("calandar", "calendar"),
        ("nicsmometyou", "nice to meet you"),
        ("helothere", "hello there"),
        ("thankyou", "thank you"),
        ("whatyoumade", "what you made"),
    ),
)
def test_recovers_trace_derived_phrase_boundaries(raw: str, expected: str) -> None:
    assert normalize_prediction_text(raw) == expected


@pytest.mark.parametrize("raw", ("minami", "myriam"))
def test_does_not_force_ambiguous_names_into_common_phrases(raw: str) -> None:
    assert normalize_prediction_text(raw) == raw


def test_normalizer_startup_errors_are_not_silenced(monkeypatch) -> None:
    text_normalizer.default_normalizer.cache_clear()

    def fail() -> text_normalizer.TextNormalizer:
        raise OSError("missing language model")

    monkeypatch.setattr(text_normalizer, "TextNormalizer", fail)
    with pytest.raises(OSError, match="missing language model"):
        text_normalizer.initialize_text_normalizer()

    text_normalizer.default_normalizer.cache_clear()

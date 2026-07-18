import pytest

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

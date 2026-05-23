from inference.language import english_prior


def best(text: str) -> str:
    return english_prior().variants(text)[0].text


def test_repairs_ctc_tail_and_repeat_errors() -> None:
    assert best("hellon") == "hello"
    assert best("helom") == "hello"
    assert best("helo") == "hello"


def test_segments_compact_common_phrases() -> None:
    assert best("mynameis") == "my name is"
    assert best("helomynameischad") == "hello my name is chad"
    assert best("hellothisischad") == "hello this is chad"


def test_repairs_long_low_frequency_word_errors() -> None:
    assert best("kangaro") == "kangaroo"
    assert best("pangaro") == "kangaroo"
    assert best("alligaton") == "alligator"
    assert best("minkey") == "monkey"


def test_rejects_single_letter_word_segmentation_artifacts() -> None:
    assert best("alligaston") == "alligaston"


def test_rejects_phrase_segmentation_with_weak_residue() -> None:
    assert best("helotheischd") == "helotheischd"


def test_keeps_open_vocabulary_short_and_name_like_outputs() -> None:
    assert best("c") == "c"
    assert best("h") == "h"
    assert best("aadi") == "aadi"
    assert best("gello") == "gello"
    assert best("myname") == "myname"

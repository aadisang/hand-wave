import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tuning.benchmark import (
    analyze_speech_trace,
    edit_distance,
    greedy_edit_limit,
    result_status,
    summarize_statuses,
)


def test_edit_distance_handles_insertions_and_substitutions() -> None:
    assert edit_distance("myname", "mynam") == 1
    assert edit_distance("neuralnetwork", "neuralnstwork") == 1


def test_short_words_require_exact_acoustic_evidence() -> None:
    assert greedy_edit_limit("yes") == 0
    assert greedy_edit_limit("water") == 1
    assert greedy_edit_limit("open the calendar") == 3


def test_result_status_separates_pipeline_misses_from_model_failures() -> None:
    assert result_status(correct=False, committed=False, recoverable=True) == "missed_recoverable"
    assert (
        result_status(correct=False, committed=False, recoverable=False)
        == "suppressed_model_failure"
    )
    assert (
        result_status(correct=False, committed=True, recoverable=True)
        == "false_commit_recoverable"
    )


def test_speech_audit_flags_requests_made_from_partials(tmp_path) -> None:
    path = tmp_path / "speech.json"
    path.write_text(
        json.dumps(
            {
                "entries": [
                    {"event": "partialSeen", "text": "noise"},
                    {"event": "speechRequested", "spokenText": "noise"},
                    {"event": "finalizedSeen", "text": "hello"},
                    {"event": "speechRequested", "spokenText": "hello"},
                ]
            }
        )
    )

    result = analyze_speech_trace(path)

    assert result["partial_requests"] == 1
    assert result["finalized_requests"] == 1
    assert result["passes_finalized_only_gate"] is False


def test_cadence_summary_enforces_zero_false_commits() -> None:
    summary = summarize_statuses(
        Counter({"correct": 4, "false_commit_recoverable": 1}),
        cases=7,
    )

    assert summary == {
        "correct": 4,
        "false_commits": 1,
        "uncommitted": 2,
        "passes_safety_gate": False,
    }

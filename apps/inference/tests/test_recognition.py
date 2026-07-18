from inference.recognition import SmoothConfig, accept_prediction, empty_state, finalize
from inference.schemas import Prediction, PredictOut, RecognitionContext


def context() -> RecognitionContext:
    return RecognitionContext(
        idle_frames=0,
        missing_frames=0,
        segment_frames=24,
        motion=0.1,
    )


def predict(label: str, confidence: float) -> PredictOut:
    return PredictOut(
        prediction=Prediction(label=label, confidence=confidence, raw_label=label),
        alternatives=[],
        spans=[],
        greedy_text=label,
        blank_ratio=0,
        tail_blank_ratio=0,
        partial_text=label,
        stable_text="",
        tail_blank_frames=0,
    )


def test_commits_stable_repeated_prediction() -> None:
    state = empty_state()
    config = SmoothConfig(display_confidence=0.05, commit_confidence=0.12)

    for _ in range(3):
        out = accept_prediction(state, predict("water", 0.3), context(), 24, 0, config)
        state = out.state

    committed = finalize(state, context(), config)

    assert committed.committed
    assert committed.display_prediction
    assert committed.display_prediction.label == "water"


def test_rejects_unstable_low_evidence_prediction() -> None:
    state = empty_state()
    config = SmoothConfig(display_confidence=0.05, commit_confidence=0.12)

    for label in ("water", "where", "want"):
        out = accept_prediction(state, predict(label, 0.2), context(), 24, 0, config)
        state = out.state

    assert not finalize(state, context(), config).committed


def test_rejects_prefix_when_later_predictions_keep_expanding_it() -> None:
    state = empty_state()
    config = SmoothConfig(display_confidence=0.05, commit_confidence=0.8)

    for _ in range(8):
        state = accept_prediction(state, predict("nics", 0.95), context(), 24, 0, config).state
    for _ in range(6):
        state = accept_prediction(
            state,
            predict("nice to us", 0.1),
            context(),
            24,
            0,
            config,
        ).state
    for _ in range(4):
        state = accept_prediction(
            state,
            predict("nice to meet you", 0.1),
            context(),
            24,
            0,
            config,
        ).state

    assert not finalize(state, context(), config).committed


def test_keeps_stable_word_when_expansion_is_only_noise() -> None:
    state = empty_state()
    config = SmoothConfig(display_confidence=0.05, commit_confidence=0.8)

    for _ in range(8):
        state = accept_prediction(state, predict("water", 0.95), context(), 24, 0, config).state
    state = accept_prediction(state, predict("waterloo", 0.1), context(), 24, 0, config).state

    committed = finalize(state, context(), config)
    assert committed.committed
    assert committed.display_prediction
    assert committed.display_prediction.label == "water"


def test_commits_repeated_normalized_greedy_evidence() -> None:
    state = empty_state()
    config = SmoothConfig(
        display_confidence=0.05,
        commit_confidence=0.8,
        commit_count=3,
        commit_streak=3,
        alternative_commit_confidence=0.1,
        alternative_commit_count=3,
        alternative_commit_min_chars=4,
    )
    response = predict("myriam", 0.8).model_copy(update={"greedy_text": "mynam"})

    for _ in range(3):
        state = accept_prediction(state, response, context(), 24, 0, config).state

    committed = finalize(state, context(), config)
    assert committed.committed
    assert committed.display_prediction
    assert committed.display_prediction.label == "my name"


def test_requires_more_confidence_when_acoustic_decode_disagrees() -> None:
    config = SmoothConfig(
        display_confidence=0.05,
        commit_confidence=0.75,
        model_disagreement_commit_confidence=0.85,
        commit_count=3,
        commit_streak=3,
        majority_commit_min_count=20,
    )
    disagreed = empty_state()
    response = predict("water", 0.8).model_copy(update={"greedy_text": "where"})
    for _ in range(3):
        disagreed = accept_prediction(disagreed, response, context(), 24, 0, config).state

    agreed = empty_state()
    for _ in range(3):
        agreed = accept_prediction(agreed, predict("water", 0.8), context(), 24, 0, config).state

    assert not finalize(disagreed, context(), config).committed
    assert finalize(agreed, context(), config).committed

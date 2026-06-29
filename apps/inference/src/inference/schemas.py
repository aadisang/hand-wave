from inference.generated_schemas import (
    DecodeTrace,
    EndpointReason,
    FinalizeTrace,
    HealthOut,
    LandmarkFrame,
    PredictIn,
    Prediction,
    PredictOut,
    RecognitionContext,
    RecognitionCount,
    RecognitionScored,
    RecognitionState,
    RecognitionTrace,
    RecognizeIn,
    RecognizeOut,
    Span,
)

N_FEATURES = 162
__all__ = [
    "LandmarkFrame",
    "N_FEATURES",
    "PredictIn",
    "PredictOut",
    "Prediction",
    "DecodeTrace",
    "EndpointReason",
    "FinalizeTrace",
    "HealthOut",
    "RecognitionContext",
    "RecognitionCount",
    "RecognitionScored",
    "RecognitionState",
    "RecognitionTrace",
    "RecognizeIn",
    "RecognizeOut",
    "Span",
    "frame_values",
]


def frame_values(frame: LandmarkFrame | list[float]) -> list[float]:
    if isinstance(frame, LandmarkFrame):
        return frame.root
    return frame

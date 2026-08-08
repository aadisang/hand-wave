from inference.generated.schemas import (
    DecodeTrace,
    EndpointReason,
    FinalizeTrace,
    HealthOut,
    LandmarkFrameItem,
    PredictIn,
    Prediction,
    PredictOut,
    RecognitionContext,
    RecognitionCount,
    RecognitionScored,
    RecognitionSource,
    RecognitionState,
    RecognitionTrace,
    RecognizeIn,
    RecognizeOut,
    Span,
)

N_FEATURES = 162
LandmarkFrame = LandmarkFrameItem
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
    "RecognitionSource",
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

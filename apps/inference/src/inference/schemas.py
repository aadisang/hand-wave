from inference.generated.schemas import (
    DecodeTrace,
    Emission,
    EmissionRecognizeIn,
    EndpointReason,
    FinalizeRecognizeIn,
    FinalizeTrace,
    FrameRecognizeIn,
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
    RecognizeOut,
    Span,
    StreamEmissionRecognizeRequest,
    StreamFinalizeRecognizeRequest,
    StreamFrameRecognizeRequest,
    StreamPingRequest,
    StreamResetRequest,
)
from inference.generated.schemas import (
    RecognizeIn as RecognizeRequestBody,
)
from inference.generated.schemas import (
    StreamRequest as StreamRequestBody,
)

N_FEATURES = 162
LandmarkFrame = LandmarkFrameItem
RecognizeIn = FrameRecognizeIn | EmissionRecognizeIn | FinalizeRecognizeIn
StreamRecognizeRequest = (
    StreamFrameRecognizeRequest | StreamEmissionRecognizeRequest | StreamFinalizeRecognizeRequest
)
__all__ = [
    "LandmarkFrame",
    "N_FEATURES",
    "PredictIn",
    "PredictOut",
    "Prediction",
    "DecodeTrace",
    "Emission",
    "EmissionRecognizeIn",
    "EndpointReason",
    "FinalizeRecognizeIn",
    "FinalizeTrace",
    "FrameRecognizeIn",
    "HealthOut",
    "RecognitionContext",
    "RecognitionCount",
    "RecognitionScored",
    "RecognitionSource",
    "RecognitionState",
    "RecognitionTrace",
    "RecognizeIn",
    "RecognizeRequestBody",
    "RecognizeOut",
    "Span",
    "StreamEmissionRecognizeRequest",
    "StreamFinalizeRecognizeRequest",
    "StreamFrameRecognizeRequest",
    "StreamPingRequest",
    "StreamRecognizeRequest",
    "StreamRequestBody",
    "StreamResetRequest",
    "frame_values",
]


def frame_values(frame: LandmarkFrame | list[float]) -> list[float]:
    if isinstance(frame, LandmarkFrame):
        return frame.root
    return frame

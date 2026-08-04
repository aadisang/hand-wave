from collections import deque
from typing import Literal, assert_never

from pydantic import BaseModel, Field

from inference.model import ModelBackend
from inference.recognition import recognize
from inference.schemas import (
    EmissionRecognizeIn,
    FinalizeRecognizeIn,
    FrameRecognizeIn,
    LandmarkFrame,
    RecognitionState,
    RecognizeOut,
    StreamEmissionRecognizeRequest,
    StreamFinalizeRecognizeRequest,
    StreamFrameRecognizeRequest,
    StreamPingRequest,
    StreamRecognizeRequest,
    StreamRequestBody,
    StreamResetRequest,
)

PROTOCOL_VERSION = 1
SUBPROTOCOL = "handwave.v1"
WINDOW_FRAMES = 192


class StreamMessage(BaseModel):
    sequence: int = Field(ge=0)
    protocol: Literal[1] = PROTOCOL_VERSION


StreamRequest = StreamPingRequest | StreamResetRequest | StreamRecognizeRequest


class PongResponse(StreamMessage):
    type: Literal["pong"] = "pong"


class ResetResponse(StreamMessage):
    type: Literal["reset"] = "reset"


class ResultResponse(StreamMessage):
    type: Literal["result"] = "result"
    result: RecognizeOut


class ErrorResponse(StreamMessage):
    type: Literal["error"] = "error"
    detail: str


StreamResponse = PongResponse | ResetResponse | ResultResponse | ErrorResponse


def parse_stream_request(payload: object) -> StreamRequest:
    return StreamRequestBody.model_validate(payload).root


class RecognitionStream:
    def __init__(self, backend: ModelBackend) -> None:
        self.backend = backend
        self.frames: deque[LandmarkFrame] = deque(maxlen=WINDOW_FRAMES)
        self.state: RecognitionState | None = None

    def reset(self) -> None:
        self.frames.clear()
        self.state = None

    async def recognize(self, request: StreamRecognizeRequest) -> RecognizeOut:
        next_state = request.state if request.state is not None else self.state
        next_frames = deque(self.frames, maxlen=WINDOW_FRAMES)
        if isinstance(request, StreamFrameRecognizeRequest):
            next_frames.extend(request.frames)
            payload = FrameRecognizeIn(
                input="frames",
                frames=list(next_frames),
                state=next_state,
                context=request.context,
                finalize=request.finalize,
            )
            should_finalize = request.finalize is True
        elif isinstance(request, StreamEmissionRecognizeRequest):
            payload = EmissionRecognizeIn(
                input="emission",
                emission=request.emission,
                state=next_state,
                context=request.context,
                finalize=request.finalize,
            )
            should_finalize = request.finalize is True
        elif isinstance(request, StreamFinalizeRecognizeRequest):
            payload = (
                FrameRecognizeIn(
                    input="frames",
                    frames=list(next_frames),
                    state=next_state,
                    context=request.context,
                    finalize=True,
                )
                if next_frames
                else FinalizeRecognizeIn(
                    input="finalize",
                    state=next_state,
                    context=request.context,
                )
            )
            should_finalize = True
        else:
            assert_never(request)

        result = await recognize(payload, self.backend)
        if should_finalize:
            self.reset()
        else:
            self.frames = (
                next_frames
                if isinstance(request, StreamFrameRecognizeRequest)
                else deque(maxlen=WINDOW_FRAMES)
            )
            self.state = result.state
        return result

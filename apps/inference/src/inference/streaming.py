from collections import deque
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

from inference.model import ModelBackend
from inference.recognition import recognize
from inference.schemas import (
    LandmarkFrame,
    RecognitionContext,
    RecognitionState,
    RecognizeIn,
    RecognizeOut,
)

PROTOCOL_VERSION = 1
SUBPROTOCOL = "handwave.v1"
WINDOW_FRAMES = 192


class StreamMessage(BaseModel):
    sequence: int = Field(ge=0)
    protocol: Literal[1] = PROTOCOL_VERSION


class PingRequest(StreamMessage):
    type: Literal["ping"]


class ResetRequest(StreamMessage):
    type: Literal["reset"]


class RecognizeRequest(StreamMessage):
    type: Literal["recognize"]
    frames: list[LandmarkFrame] = Field(default_factory=list, max_length=WINDOW_FRAMES)
    state: RecognitionState | None = None
    context: RecognitionContext
    finalize: bool = False


StreamRequest = Annotated[
    PingRequest | ResetRequest | RecognizeRequest,
    Field(discriminator="type"),
]
stream_request_adapter = TypeAdapter(StreamRequest)


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
    return stream_request_adapter.validate_python(payload)


class RecognitionStream:
    def __init__(self, backend: ModelBackend) -> None:
        self.backend = backend
        self.frames: deque[LandmarkFrame] = deque(maxlen=WINDOW_FRAMES)
        self.state: RecognitionState | None = None

    def reset(self) -> None:
        self.frames.clear()
        self.state = None

    async def recognize(self, request: RecognizeRequest) -> RecognizeOut:
        next_state = request.state if request.state is not None else self.state
        next_frames = deque(self.frames, maxlen=WINDOW_FRAMES)
        next_frames.extend(request.frames)
        if not next_frames and not request.finalize:
            raise ValueError("recognize messages require at least one buffered frame")

        result = await recognize(
            RecognizeIn(
                frames=list(next_frames),
                state=next_state,
                context=request.context,
                finalize=request.finalize,
            ),
            self.backend,
        )
        if request.finalize:
            self.reset()
        else:
            self.frames = next_frames
            self.state = result.state
        return result

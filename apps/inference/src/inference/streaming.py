from collections import deque
from typing import Literal

from pydantic import BaseModel, Field

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


class StreamRequest(BaseModel):
    type: Literal["recognize", "reset", "ping"]
    sequence: int = Field(ge=0)
    protocol: int = PROTOCOL_VERSION
    frames: list[LandmarkFrame] = Field(default_factory=list, max_length=WINDOW_FRAMES)
    state: RecognitionState | None = None
    context: RecognitionContext | None = None
    finalize: bool = False


class RecognitionStream:
    def __init__(self, backend: ModelBackend) -> None:
        self.backend = backend
        self.frames: deque[LandmarkFrame] = deque(maxlen=WINDOW_FRAMES)
        self.state: RecognitionState | None = None

    def reset(self) -> None:
        self.frames.clear()
        self.state = None

    async def recognize(self, request: StreamRequest) -> RecognizeOut:
        if request.protocol != PROTOCOL_VERSION:
            raise ValueError(f"unsupported stream protocol {request.protocol}")
        if request.context is None:
            raise ValueError("recognize messages require context")
        if request.state is not None:
            self.state = request.state
        self.frames.extend(request.frames)
        if not self.frames and not request.finalize:
            raise ValueError("recognize messages require at least one buffered frame")

        result = await recognize(
            RecognizeIn(
                frames=list(self.frames),
                state=self.state,
                context=request.context,
                finalize=request.finalize,
            ),
            self.backend,
        )
        self.state = result.state
        if request.finalize:
            self.reset()
        return result

from collections import deque
from dataclasses import dataclass, field
from uuid import uuid4

from inference.decoder import StablePrefixTracker
from inference.model import ModelBackend
from inference.schemas import (
    CreateSessionIn,
    SessionInfo,
    LandmarkFrame,
    PredictOut,
    SessionState,
    StreamPred,
)


@dataclass
class InferenceSession:
    id: str
    max_window_frames: int
    tracker: StablePrefixTracker
    frames: deque[LandmarkFrame] = field(default_factory=deque)

    def append(self, new_frames: list[LandmarkFrame]) -> None:
        self.frames.extend(new_frames)
        while len(self.frames) > self.max_window_frames:
            self.frames.popleft()

    def reset(self) -> None:
        self.frames.clear()
        self.tracker.reset()

    def state(self) -> SessionState:
        return SessionState(
            session_id=self.id,
            buffered_frames=len(self.frames),
            partial_text=self.tracker.partial_text,
            stable_text=self.tracker.stable_text,
        )


class SessionStore:
    def __init__(self, backend: ModelBackend) -> None:
        self.backend = backend
        self._sessions: dict[str, InferenceSession] = {}

    def create(self, request: CreateSessionIn) -> SessionInfo:
        session_id = uuid4().hex
        self._sessions[session_id] = InferenceSession(
            id=session_id,
            max_window_frames=request.max_window_frames,
            tracker=StablePrefixTracker(request.min_stable_frames),
        )
        return SessionInfo(
            session_id=session_id,
            max_window_frames=request.max_window_frames,
            min_stable_frames=request.min_stable_frames,
        )

    def get(self, session_id: str) -> InferenceSession | None:
        return self._sessions.get(session_id)

    def delete(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None

    async def predict(
        self,
        session_id: str,
        frames: list[LandmarkFrame],
    ) -> StreamPred | None:
        session = self.get(session_id)
        if session is None:
            return None

        session.append(frames)
        prediction = await self.backend.predict_frames(list(session.frames))
        partial_text, stable_text = session.tracker.update(prediction.partial_text)
        return stream_response(session, prediction, partial_text, stable_text)


def stream_response(
    session: InferenceSession,
    prediction: PredictOut,
    partial_text: str,
    stable_text: str,
) -> StreamPred:
    return StreamPred(
        session_id=session.id,
        buffered_frames=len(session.frames),
        prediction=prediction.prediction,
        alternatives=prediction.alternatives,
        spans=prediction.spans,
        greedy_text=prediction.greedy_text,
        blank_ratio=prediction.blank_ratio,
        tail_blank_ratio=prediction.tail_blank_ratio,
        tail_blank_frames=prediction.tail_blank_frames,
        partial_text=partial_text,
        stable_text=stable_text,
    )

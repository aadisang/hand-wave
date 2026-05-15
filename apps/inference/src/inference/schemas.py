from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"]


class Landmark(BaseModel):
    x: float
    y: float
    z: float | None = None


class LandmarkFrame(BaseModel):
    landmarks: list[Landmark] = Field(min_length=1)
    timestamp_ms: int | None = None


class Prediction(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)


class PredictRequest(BaseModel):
    mode: Literal["static", "sequence"] = "sequence"
    landmarks: list[Landmark] = Field(default_factory=list)
    frames: list[LandmarkFrame] = Field(default_factory=list)


class PredictResponse(BaseModel):
    prediction: Prediction
    alternatives: list[Prediction] = Field(default_factory=list)
    partial_text: str = ""
    stable_text: str = ""


class CreateSessionRequest(BaseModel):
    max_window_frames: int = Field(default=128, ge=8, le=512)
    min_stable_frames: int = Field(default=3, ge=1, le=24)


class CreateSessionResponse(BaseModel):
    session_id: str
    max_window_frames: int
    min_stable_frames: int


class AppendFramesRequest(BaseModel):
    frames: list[LandmarkFrame] = Field(min_length=1, max_length=160)


class StreamPredictResponse(PredictResponse):
    session_id: str
    buffered_frames: int


class SessionStateResponse(BaseModel):
    session_id: str
    buffered_frames: int
    partial_text: str
    stable_text: str

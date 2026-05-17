from typing import Annotated, Literal

from pydantic import BaseModel, Field

N_FEATURES = 162
LandmarkFrame = Annotated[list[float], Field(min_length=N_FEATURES, max_length=N_FEATURES)]


class HealthResponse(BaseModel):
    status: Literal["ok"]


class Prediction(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)
    logit_score: float | None = None
    lm_score: float | None = None


class PredictionSpan(BaseModel):
    text: str
    start_frame: int
    end_frame: int


class PredictRequest(BaseModel):
    frames: list[LandmarkFrame] = Field(min_length=1)


class PredictResponse(BaseModel):
    prediction: Prediction
    alternatives: list[Prediction] = Field(default_factory=list)
    spans: list[PredictionSpan] = Field(default_factory=list)
    greedy_text: str = ""
    blank_ratio: float = Field(default=0.0, ge=0, le=1)
    tail_blank_ratio: float = Field(default=0.0, ge=0, le=1)
    tail_blank_frames: int = 0
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

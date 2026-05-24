from typing import Annotated

from pydantic import BaseModel, Field

from inference.contract import DECODE_WINDOW

N_FEATURES = 162
LandmarkFrame = Annotated[list[float], Field(min_length=N_FEATURES, max_length=N_FEATURES)]


class Prediction(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)
    logit_score: float | None = None
    lm_score: float | None = None
    raw_label: str | None = None


class Span(BaseModel):
    text: str
    start_frame: int
    end_frame: int


class PredictIn(BaseModel):
    frames: list[LandmarkFrame] = Field(min_length=1, max_length=DECODE_WINDOW)


class PredictOut(BaseModel):
    prediction: Prediction
    alternatives: list[Prediction] = Field(default_factory=list)
    spans: list[Span] = Field(default_factory=list)
    greedy_text: str = ""
    blank_ratio: float = Field(default=0.0, ge=0, le=1)
    tail_blank_ratio: float = Field(default=0.0, ge=0, le=1)
    tail_blank_frames: int = 0
    partial_text: str = ""
    stable_text: str = ""

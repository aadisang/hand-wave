from contextlib import asynccontextmanager
from os import getenv
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

Landmark = Annotated[list[float], Field(min_length=2, max_length=3)]


class HealthResponse(BaseModel):
    status: Literal["ok"]


class PredictRequest(BaseModel):
    mode: Literal["static", "sequence"] = "static"
    landmarks: list[Landmark] = Field(min_length=1)


class Prediction(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)


class PredictResponse(BaseModel):
    prediction: Prediction
    alternatives: list[Prediction] = Field(default_factory=list)


class Predictor:
    async def predict(self, request: PredictRequest) -> PredictResponse:
        return PredictResponse(
            prediction=Prediction(label="unknown", confidence=0),
            alternatives=[],
        )


def cors_origins() -> list[str]:
    raw_origins = getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001",
    )
    return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.predictor = Predictor()
    yield
    app.state.predictor = None


app = FastAPI(
    title="Hand Wave Inference",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": "hand-wave-inference"}


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/ready", response_model=HealthResponse)
async def ready(request: Request) -> HealthResponse:
    if getattr(request.app.state, "predictor", None) is None:
        raise HTTPException(status_code=503, detail="Predictor is not ready")

    return HealthResponse(status="ok")


@app.post("/v1/predict", response_model=PredictResponse)
async def predict(payload: PredictRequest, request: Request) -> PredictResponse:
    predictor = getattr(request.app.state, "predictor", None)

    if predictor is None:
        raise HTTPException(status_code=503, detail="Predictor is not ready")

    return await predictor.predict(payload)

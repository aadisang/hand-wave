from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from inference.dependencies import get_backend
from inference.model import ModelBackend
from inference.schemas import LandmarkFrame, PredictRequest, PredictResponse

router = APIRouter(prefix="/v1", tags=["predictions"])


@router.post("/predict", response_model=PredictResponse)
async def predict(
    payload: PredictRequest,
    backend: Annotated[ModelBackend, Depends(get_backend)],
) -> PredictResponse:
    frames = payload.frames
    if not frames and payload.landmarks:
        frames = [LandmarkFrame(landmarks=payload.landmarks)]
    if not frames:
        raise HTTPException(status_code=422, detail="Provide landmarks or frames")
    try:
        return await backend.predict_frames(frames)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

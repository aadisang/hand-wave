from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from inference.dependencies import get_backend
from inference.model import ModelBackend
from inference.schemas import PredictIn, PredictOut

router = APIRouter(prefix="/v1", tags=["predictions"])


@router.post("/predict", response_model=PredictOut)
async def predict(
    payload: PredictIn,
    backend: Annotated[ModelBackend, Depends(get_backend)],
) -> PredictOut:
    try:
        return await backend.predict_frames(payload.frames)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

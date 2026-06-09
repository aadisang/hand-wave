from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from inference.dependencies import get_backend
from inference.model import ModelBackend
from inference.recognition import recognize as recognize_payload
from inference.schemas import PredictIn, PredictOut, RecognizeIn, RecognizeOut

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


@router.post("/recognize", response_model=RecognizeOut)
async def recognize(
    payload: RecognizeIn,
    backend: Annotated[ModelBackend, Depends(get_backend)],
) -> RecognizeOut:
    try:
        return await recognize_payload(payload, backend)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

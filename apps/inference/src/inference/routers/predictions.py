from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from inference.dependencies import get_backend
from inference.model import ModelBackend
from inference.recognition import recognize as recognize_payload
from inference.schemas import (
    HealthOut,
    PredictIn,
    PredictOut,
    RecognizeIn,
    RecognizeOut,
)
from inference.streaming import (
    PROTOCOL_VERSION,
    SUBPROTOCOL,
    ErrorResponse,
    PongResponse,
    RecognitionStream,
    ResetResponse,
    ResultResponse,
    parse_stream_request,
)

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


@router.get("/health", response_model=HealthOut)
async def health() -> HealthOut:
    return HealthOut(ok=True)


@router.post("/recognize", response_model=RecognizeOut)
async def recognize(
    payload: RecognizeIn,
    backend: Annotated[ModelBackend, Depends(get_backend)],
) -> RecognizeOut:
    try:
        return await recognize_payload(payload, backend)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.websocket("/stream")
async def stream(websocket: WebSocket) -> None:
    backend = getattr(websocket.app.state, "backend", None)
    if backend is None:
        await websocket.close(code=1013, reason="Predictor is not ready")
        return

    if SUBPROTOCOL not in websocket.scope.get("subprotocols", []):
        await websocket.close(code=1002, reason=f"Subprotocol {SUBPROTOCOL} is required")
        return

    await websocket.accept(subprotocol=SUBPROTOCOL)
    session = RecognitionStream(backend)
    try:
        while True:
            sequence = 0
            try:
                payload = await websocket.receive_json()
                if isinstance(payload, dict) and isinstance(payload.get("sequence"), int):
                    sequence = payload["sequence"]
                request = parse_stream_request(payload)
                sequence = request.sequence
                if request.type == "ping":
                    response = PongResponse(
                        sequence=request.sequence,
                        protocol=PROTOCOL_VERSION,
                    )
                elif request.type == "reset":
                    session.reset()
                    response = ResetResponse(
                        sequence=request.sequence,
                        protocol=PROTOCOL_VERSION,
                    )
                else:
                    result = await session.recognize(request)
                    response = ResultResponse(
                        sequence=request.sequence,
                        protocol=PROTOCOL_VERSION,
                        result=result,
                    )
                await websocket.send_json(response.model_dump(mode="json"))
            except (ValidationError, ValueError) as exc:
                response = ErrorResponse(
                    sequence=sequence,
                    protocol=PROTOCOL_VERSION,
                    detail=str(exc),
                )
                await websocket.send_json(response.model_dump(mode="json"))
    except WebSocketDisconnect:
        session.reset()

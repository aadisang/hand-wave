from typing import Annotated

from fastapi import APIRouter, Depends

from inference.dependencies import get_backend
from inference.model import ModelBackend
from inference.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": "hand-wave-inference"}


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/ready", response_model=HealthResponse)
async def ready(_: Annotated[ModelBackend, Depends(get_backend)]) -> HealthResponse:
    return HealthResponse(status="ok")

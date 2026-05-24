from fastapi import HTTPException, Request

from inference.model import ModelBackend


def get_backend(request: Request) -> ModelBackend:
    backend = getattr(request.app.state, "backend", None)
    if backend is None:
        raise HTTPException(status_code=503, detail="Predictor is not ready")
    return backend

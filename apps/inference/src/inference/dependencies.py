from fastapi import HTTPException, Request

from inference.model import ModelBackend
from inference.sessions import SessionStore


def get_backend(request: Request) -> ModelBackend:
    backend = getattr(request.app.state, "backend", None)
    if backend is None:
        raise HTTPException(status_code=503, detail="Predictor is not ready")
    return backend


def get_sessions(request: Request) -> SessionStore:
    sessions = getattr(request.app.state, "sessions", None)
    if sessions is None:
        raise HTTPException(status_code=503, detail="Session store is not ready")
    return sessions

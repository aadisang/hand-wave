from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from inference.dependencies import get_sessions
from inference.schemas import (
    CreateSessionIn,
    FramesIn,
    SessionInfo,
    SessionState,
    StreamPred,
)
from inference.sessions import SessionStore

router = APIRouter(prefix="/v1/sessions", tags=["sessions"])


@router.post("", response_model=SessionInfo)
async def create_session(
    payload: CreateSessionIn,
    sessions: Annotated[SessionStore, Depends(get_sessions)],
) -> SessionInfo:
    return sessions.create(payload)


@router.get("/{session_id}", response_model=SessionState)
async def get_session(
    session_id: str,
    sessions: Annotated[SessionStore, Depends(get_sessions)],
) -> SessionState:
    session = sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.state()


@router.post("/{session_id}/frames", response_model=StreamPred)
async def append_frames(
    session_id: str,
    payload: FramesIn,
    sessions: Annotated[SessionStore, Depends(get_sessions)],
) -> StreamPred:
    try:
        prediction = await sessions.predict(session_id, payload.frames)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if prediction is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return prediction


@router.post("/{session_id}/reset", response_model=SessionState)
async def reset_session(
    session_id: str,
    sessions: Annotated[SessionStore, Depends(get_sessions)],
) -> SessionState:
    session = sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    session.reset()
    return session.state()


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str,
    sessions: Annotated[SessionStore, Depends(get_sessions)],
) -> Response:
    if not sessions.delete(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

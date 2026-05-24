from contextlib import asynccontextmanager
from os import getenv

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from inference.model import load_backend
from inference.routers import predictions, sessions
from inference.sessions import SessionStore


def cors_origins() -> list[str]:
    raw_origins = getenv(
        "CORS_ORIGINS",
        "https://handwave.sh,http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001",
    )
    return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    backend = load_backend()
    app.state.backend = backend
    app.state.sessions = SessionStore(backend)
    yield
    app.state.backend = None
    app.state.sessions = None


app = FastAPI(
    title="Hand Wave Inference",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(predictions.router)
app.include_router(sessions.router)

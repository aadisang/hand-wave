from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from inference.endpoints import origin_text
from inference.model import CheckpointBackend
from inference.routers import predictions
from inference.settings import get_asset_settings, get_settings
from inference.text_normalizer import default_normalizer

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    default_normalizer()
    app.state.backend = CheckpointBackend(get_asset_settings())
    yield
    app.state.backend = None


app = FastAPI(
    title="Hand Wave Inference",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin_text(origin) for origin in settings.cors_origins],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(predictions.router)

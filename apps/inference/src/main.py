"""
FastAPI inference service for ASL Fingerspelling Recognition.

This service provides a REST API endpoint for running TFLite model inference
on hand landmark data to predict ASL fingerspelling text.
"""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Global model instance
model_instance: Any = None


class PredictRequest(BaseModel):
    """Request schema for prediction endpoint."""

    landmarks: list[list[float]] = Field(
        ...,
        description="Landmark frames with shape [num_frames, 390]",
    )


class PredictResponse(BaseModel):
    """Response schema for prediction endpoint."""

    text: str = Field(..., description="Predicted ASL text")
    confidence: float = Field(..., description="Prediction confidence score")
    processing_time: float = Field(..., description="Processing time in milliseconds")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup, cleanup on shutdown."""
    global model_instance

    print("Loading ASL TFLite model...")

    try:
        from .tflite_model import TFLiteModel

        # Paths to model files
        base_dir = Path(__file__).parent.parent
        model_path = base_dir / "models" / "model.tflite"
        inference_args_path = base_dir / "inference_args.json"
        char_map_path = base_dir / "character_to_prediction_index.json"

        if not model_path.exists():
            print(f"⚠️  Model file not found: {model_path}")
            print("")
            print("   To get the model, you need to either:")
            print("   1. Train it yourself (see apps/inference/README.md)")
            print("   2. Download pre-trained weights from the competition")
            print("")
            print("   Server will start but /predict endpoint will return 503")
            model_instance = None
        elif not inference_args_path.exists():
            print(f"⚠️  Config file not found: {inference_args_path}")
            model_instance = None
        elif not char_map_path.exists():
            print(f"⚠️  Character mapping not found: {char_map_path}")
            model_instance = None
        else:
            model_instance = TFLiteModel(
                model_path=str(model_path),
                inference_args_path=str(inference_args_path),
                char_map_path=str(char_map_path),
            )
            print("✓ Model loaded successfully")

    except Exception as e:
        print(f"Error loading model: {e}")
        import traceback

        traceback.print_exc()
        model_instance = None

    yield

    # Cleanup
    print("Shutting down...")
    model_instance = None


app = FastAPI(
    title="ASL Fingerspelling Inference API",
    description="TFLite-based ASL recognition from hand landmarks",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this properly in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "model_loaded": model_instance is not None,
    }


@app.post("/predict", response_model=PredictResponse)
async def predict(request: PredictRequest) -> PredictResponse:
    """
    Predict ASL text from hand landmarks.

    Args:
        request: PredictRequest containing landmark frames

    Returns:
        PredictResponse with predicted text and confidence
    """
    import time

    start_time = time.time()

    if model_instance is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    try:
        # Landmarks are already flat: [num_frames, 390]
        # Run inference
        predicted_text, confidence = model_instance.predict(request.landmarks)

        processing_time = (time.time() - start_time) * 1000

        return PredictResponse(
            text=predicted_text,
            confidence=confidence,
            processing_time=processing_time,
        )

    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "service": "ASL Fingerspelling Inference API",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "predict": "POST /predict",
            "docs": "/docs",
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

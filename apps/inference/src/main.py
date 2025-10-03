"""
FastAPI inference service for ASL Sign Language Recognition.

This service provides a REST API endpoint for running TFLite model inference
on hand landmark data to predict ASL signs (alphabet A-Z + common phrases).
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
        description="Hand landmarks with shape [21, 2] for single frame OR [21, 21, 2] for movement sequence",
    )
    image_width: int = Field(default=1920, description="Image width for movement normalization")
    image_height: int = Field(default=1080, description="Image height for movement normalization")
    mode: str = Field(default="static", description="Prediction mode: 'static' or 'movement'")


class PredictResponse(BaseModel):
    """Response schema for prediction endpoint."""

    text: str = Field(..., description="Predicted ASL sign")
    confidence: float = Field(..., description="Prediction confidence score")
    processing_time: float = Field(..., description="Processing time in milliseconds")
    top_predictions: list[dict] = Field(default=[], description="Top N predictions with labels and probabilities")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup, cleanup on shutdown."""
    global model_instance

    print("Loading ASL TFLite models...")

    try:
        from .asl_classifier import ASLClassifier

        # Paths to model files
        base_dir = Path(__file__).parent.parent
        static_model_path = base_dir / "models" / "static_model.tflite"
        movement_model_path = base_dir / "models" / "movement_model.tflite"
        label_path = base_dir / "label.csv"

        if not static_model_path.exists():
            print(f"⚠️  Static model file not found: {static_model_path}")
            print("")
            print("   Server will start but /predict endpoint will return 503")
            model_instance = None
        elif not movement_model_path.exists():
            print(f"⚠️  Movement model file not found: {movement_model_path}")
            model_instance = None
        elif not label_path.exists():
            print(f"⚠️  Label file not found: {label_path}")
            model_instance = None
        else:
            model_instance = ASLClassifier(
                static_model_path=str(static_model_path),
                movement_model_path=str(movement_model_path),
                label_path=str(label_path),
                output_count=5,
            )
            print("✓ ASL Classifier loaded successfully")

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
    title="ASL Sign Language Inference API",
    description="TFLite-based ASL recognition from hand landmarks (Alphabet + Phrases)",
    version="2.0.0",
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
    Predict ASL sign from hand landmarks.

    Args:
        request: PredictRequest containing hand landmarks

    Returns:
        PredictResponse with predicted sign and confidence
    """
    import time

    start_time = time.time()

    if model_instance is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    try:
        if request.mode == "static":
            # Static sign prediction (single frame)
            # Expected input: [21, 2] landmarks
            indices, probs = model_instance.predict_static(request.landmarks)
        elif request.mode == "movement":
            # Movement sign prediction (sequence of frames)
            # Expected input: [21, 21, 2] - 21 frames of 21 landmarks
            indices, probs = model_instance.predict_movement(
                request.landmarks,
                request.image_width,
                request.image_height,
            )
        else:
            raise HTTPException(status_code=400, detail="Invalid mode. Use 'static' or 'movement'")

        # Get top prediction
        top_index = indices[0]
        top_prob = probs[0]

        # Get label
        predicted_text = model_instance.get_label(top_index)

        # Build top predictions list
        top_predictions = [
            {"label": model_instance.get_label(idx), "confidence": float(prob)}
            for idx, prob in zip(indices, probs)
            if idx != -1  # Filter out invalid movement predictions
        ]

        processing_time = (time.time() - start_time) * 1000

        return PredictResponse(
            text=predicted_text,
            confidence=float(top_prob),
            processing_time=processing_time,
            top_predictions=top_predictions,
        )

    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "service": "ASL Sign Language Inference API",
        "version": "2.0.0",
        "description": "Alphabet (A-Z) + Common Phrases (Good, Bad, I AM FRIENDLY)",
        "endpoints": {
            "health": "/health",
            "predict": "POST /predict",
            "docs": "/docs",
        },
        "supported_signs": "A-Z, Noise, Good, Bad, I AM FRIENDLY",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

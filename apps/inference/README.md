# ASL Inference Service

FastAPI service for ASL Fingerspelling Recognition using TFLite model.

## Quick Start

The inference service runs automatically when you run `turbo dev` from the project root.

### Run Standalone

```bash
cd apps/inference
uv run uvicorn src.main:app --reload --port 8000
```

### API Documentation

Once running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Getting the Model

You need the TFLite model from the Kaggle competition:

### Option 1: Download Pre-trained Model

If the competition winners provided trained weights, download:
- `model.tflite`
- `inference_args.json`

Place them in `apps/inference/models/`

### Option 2: Train Your Own

Follow the instructions in the Kaggle repo to train the model:

```bash
cd kaggle_reference

# Train round 2 (round 1 outputs already provided)
python train.py -C cfg_2 --fold -1

# Convert to TFLite
python scripts/convert_cfg_2_to_tf_lite.py

# Copy the output
cp datamount/weights/cfg_2/fold-1/model.tflite ../apps/inference/models/
cp datamount/weights/cfg_2/fold-1/inference_args.json ../apps/inference/models/
```

## Model Input Format

The model expects landmarks in this format:

```python
[
  [[x, y, z], [x, y, z], ...],  # Frame 1: 130 landmarks
  [[x, y, z], [x, y, z], ...],  # Frame 2: 130 landmarks
  ...
]
```

Where the 130 landmarks include:
- 21 left hand landmarks
- 21 right hand landmarks  
- Face landmarks
- Pose landmarks

MediaPipe provides these landmarks directly.

## API Endpoints

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "model_loaded": true
}
```

### `POST /predict`

Predict ASL text from landmarks.

**Request:**
```json
{
  "landmarks": [
    [[x, y, z], [x, y, z], ...],
    [[x, y, z], [x, y, z], ...],
    ...
  ]
}
```

**Response:**
```json
{
  "text": "hello",
  "confidence": 0.95,
  "processing_time": 45.2
}
```

## Testing

```bash
# Health check
curl http://localhost:8000/health

# Test prediction (with sample data)
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d @sample_landmarks.json
```

## Architecture

```
Browser (MediaPipe)
    ↓ landmarks [num_frames, 130, 3]
tRPC Backend (port 3000)
    ↓ HTTP POST
FastAPI Inference (port 8000)
    ↓ TFLite Model
    ↓ prediction
Backend
    ↓ result
WhatsApp API → Meta Glasses
```

## Why TFLite?

- **Simple**: Just load the `.tflite` file and run inference
- **Fast**: Optimized for mobile/edge deployment
- **Production-ready**: This is what the Kaggle competition required
- **No complex dependencies**: Just TensorFlow, no PyTorch/transformers/timm

## Troubleshooting

### Model not found

```
Warning: No model found at .../models/model.tflite
```

Place `model.tflite` and `inference_args.json` in `apps/inference/models/`

### TensorFlow errors

Make sure you have TensorFlow installed:
```bash
uv add tensorflow
```

### Wrong input shape

The model expects exactly 130 landmarks per frame. Check that MediaPipe is configured to output all landmark types (hands, face, pose).

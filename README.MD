# Hand Wave with Meta AI Glasses

Real-time ASL (American Sign Language) fingerspelling recognition from Meta AI glasses, streamed via WhatsApp Desktop to a web app. Uses MediaPipe for hand landmark detection and a TFLite model for gesture-to-text translation.

## Demo

<div align="center">
<a href="https://www.youtube.com/watch?v=ZncD5yy729c">
<img src="https://img.youtube.com/vi/ZncD5yy729c/0.jpg" alt="Demo: Hand Wave with Meta AI Glasses" width="720" />
</a>
<br />
<em>Real-time stream from glasses with hand landmark detection and ASL translation.</em>
</div>

## Status

- Hackathon-grade prototype; not production-ready
- Transport moved from Instagram Live to WhatsApp → ~10–20× lower latency
- No Python streaming server or mobile app required
- Hand landmark detection and translation working
- In-glasses audio readout in progress

## Quick Start

**Prerequisites:**
- Meta AI glasses
- iPhone (Sender) with WhatsApp (Account A)
- Laptop (Receiver) with WhatsApp Desktop (Account B)
- Two WhatsApp accounts
- Bun (monorepo uses Bun workspaces)

**Install and run:**

```bash
bun install
bun run dev
```

This starts:
- Web app: `https://localhost:3001`
- tRPC server: `https://localhost:3000`
- Inference service: `http://localhost:8000`

## Use with WhatsApp

1. On the phone (Account A), pair the glasses and open WhatsApp
2. On the laptop (Account B), open WhatsApp Desktop
3. Start a WhatsApp video call between Account A and Account B
4. On the glasses, double-tap the picture button to switch the call's camera to the glasses
5. Open `https://localhost:3001` and click "Share Screen"; select the WhatsApp call window
6. The browser runs on-device hand detection and sends landmarks to the inference service for translation
7. Audio readback to the glasses is WIP

## How It Works

**Video & Detection Path:**
- Video: Glasses → Phone → WhatsApp → Laptop → Browser screen share
- Detection: Browser MediaPipe HandLandmarker (WASM/WebGL) extracts landmarks
- Translation: Landmarks → tRPC Backend → FastAPI Inference Service → TFLite Model
- Output: Translated text displayed in browser; audio TTS to glasses (WIP)

**Privacy:**
- No raw video frames are uploaded
- Only hand landmark coordinates are sent to the inference service

## Architecture

```
Meta AI Glasses
    ↓ video stream
WhatsApp Call
    ↓ screen share
Browser (MediaPipe)
    ↓ landmarks [num_frames, 130, 3]
tRPC Backend (port 3000)
    ↓ HTTP POST
FastAPI Inference (port 8000)
    ↓ TFLite Model
    ↓ prediction
Backend → Browser
    ↓ (future) TTS
WhatsApp API → Meta Glasses
```

## Tech Stack

**Web (apps/web):**
- Next.js 15, React 19, TypeScript
- Tailwind CSS 4, shadcn/ui
- MediaPipe Tasks Vision (HandLandmarker)
- Zustand, TanStack Query 5

**Backend (apps/server):**
- tRPC 11 over Hono (Bun runtime)
- Built with tsdown

**Inference (apps/inference):**
- FastAPI (Python)
- TensorFlow Lite
- ASL Fingerspelling Recognition model from Kaggle

**Monorepo:**
- Turbo + Bun workspaces

## Project Structure

```
apps/
  web/        # Next.js app (UI, screen share, hand detection)
  server/     # Bun + Hono + tRPC API
  inference/  # FastAPI + TFLite inference service
```

## Scripts

Run from repository root:

```bash
bun run dev          # Start all services (web HTTPS:3001, server, inference)
bun run build        # Build all apps
bun run check-types  # Typecheck all apps
bun run dev:web      # Web only
bun run dev:server   # Server only
```

For inference service only:
```bash
cd apps/inference
uv run uvicorn src.main:app --reload --port 8000
```

## Environment

Create a `.env` file at the repository root:

```env
NEXT_PUBLIC_SERVER_URL=https://localhost:3000
PORT=3000
CORS_ORIGIN=https://localhost:3001
```

**Web (`apps/web`):**
- `NEXT_PUBLIC_SERVER_URL` – tRPC server URL

**Server (`apps/server`):**
- `PORT` – Server port (default: 3000)
- `CORS_ORIGIN` – Allowed CORS origin

## Getting the ASL Model

The inference service needs a TFLite model for ASL recognition.

### Option 1: Download Pre-trained Model

If available, download the trained model from the Kaggle competition:
- `model.tflite`
- `inference_args.json`

Place them in `apps/inference/models/`

### Option 2: Train Your Own

Follow the Kaggle competition instructions to train the model:

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

## Troubleshooting

**"Share Screen" doesn't list WhatsApp window:**
- Ensure the call is active and the window is visible
- macOS: Grant Screen Recording permission to your browser (System Settings → Privacy & Security → Screen Recording)
- Browser must use HTTPS; `getDisplayMedia` requires a secure context

**Model not found:**
```
Warning: No model found at .../models/model.tflite
```
Place `model.tflite` and `inference_args.json` in `apps/inference/models/`

**TensorFlow errors:**
```bash
cd apps/inference
uv add tensorflow
```

**Wrong input shape:**
The model expects exactly 130 landmarks per frame (21 left hand + 21 right hand + face + pose landmarks). Check MediaPipe configuration.

## API Documentation

**Inference Service:**
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

**Endpoints:**
- `GET /health` - Health check
- `POST /predict` - Predict ASL text from landmarks

## Limitations

- Hackathon-grade prototype, not production-ready
- In-glasses audio readout not yet implemented
- No authentication or multi-user coordination
- No recording controls or session management

## Roadmap

- Complete text-to-speech back to the glasses
- Improve model accuracy and add gesture classification
- Add authentication and session management
- Recording controls and replay functionality
- Multi-user support

## License

See LICENSE file for details.

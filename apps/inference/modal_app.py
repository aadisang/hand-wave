from __future__ import annotations

import modal

APP_NAME = "hand-wave-inference"
MODEL_DIR = "/models"

env = {
    "CORS_ORIGINS": "https://handwave.sh",
    "MODEL_DIR": MODEL_DIR,
}

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential", "cmake")
    .uv_sync(".", uv_version="0.8.8")
    .add_local_dir("models", remote_path=MODEL_DIR, copy=True, ignore=["**/*.arpa.bin"])
    .add_local_python_source("inference", copy=True)
    .env(env)
)

app = modal.App(APP_NAME)


# A WebSocket occupies one Modal Function input for the life of the connection.
# Modal allows up to 24 hours; the iOS client reconnects and resynchronizes if it expires.
@app.function(image=image, timeout=86_400)
# Each socket is mostly idle, but model work is serial inside a container.
# Scale near one active socket per model while allowing short connection bursts.
@modal.concurrent(max_inputs=8, target_inputs=1)
@modal.asgi_app(label=APP_NAME)
def fastapi_app():
    from inference.main import app as inference_app

    return inference_app

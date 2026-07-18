from __future__ import annotations

import modal

APP_NAME = "hand-wave-inference"
MODEL_DIR = "/models"
DEPS = (
    "fastapi>=0.128.0",
    "kenlm @ https://github.com/kpu/kenlm/archive/refs/heads/master.zip",
    "numpy>=1.26,<3",
    "pyctcdecode>=0.5.0",
    "torch>=2.13,<2.14",
    "torchaudio>=2.11,<2.12",
)

env = {
    "CORS_ORIGINS": "https://handwave.sh",
    "MODEL_DIR": MODEL_DIR,
}

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential", "cmake")
    .uv_pip_install(*DEPS)
    .add_local_dir("models", remote_path=MODEL_DIR, copy=True, ignore=["**/*.arpa.bin"])
    .add_local_python_source("inference", copy=True)
    .env(env)
)

app = modal.App(APP_NAME)


# A WebSocket occupies one Modal Function input for the life of the connection.
# Modal allows up to 24 hours; the iOS client reconnects and resynchronizes if it expires.
@app.function(image=image, timeout=86_400)
@modal.concurrent(max_inputs=8)
@modal.asgi_app(label=APP_NAME)
def fastapi_app():
    from inference.main import app as inference_app

    return inference_app

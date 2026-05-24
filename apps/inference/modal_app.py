from __future__ import annotations

import modal

APP_NAME = "hand-wave-inference"
MODEL_DIR = "/models"

DEPS = (
    "fastapi>=0.128.0",
    "numpy>=1.26,<3",
    "pyctcdecode>=0.5.0",
    "rapidfuzz>=3.14.5",
    "torch>=2.2,<2.6",
    "torchaudio>=2.2,<2.6",
    "wordfreq>=3.1.1",
    "wordsegment>=1.3.1",
)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .uv_pip_install(*DEPS)
    .add_local_python_source("inference", copy=True)
    .add_local_dir("models", remote_path=MODEL_DIR, copy=True)
    .env(
        {
            "CORS_ORIGINS": "https://handwave.sh",
            "MODEL_DIR": MODEL_DIR,
        }
    )
)

app = modal.App(APP_NAME)


@app.function(image=image, timeout=300)
@modal.concurrent(max_inputs=8)
@modal.asgi_app(label=APP_NAME)
def fastapi_app():
    from inference.main import app as inference_app

    return inference_app

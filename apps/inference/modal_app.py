from __future__ import annotations

import modal

APP_NAME = "hand-wave-inference"
MODEL_DIR = "/models"

env = {
    "CORS_ORIGINS": "https://handwave.sh",
    "MODEL_DIR": MODEL_DIR,
}

decoder_env = {
    "CORS_ORIGINS": "https://handwave.sh",
    "HANDWAVE_DECODER_ONLY": "1",
    "KENLM_MODEL_PATH": f"{MODEL_DIR}/lm/neutral_english_4gram.kenlm",
    "KENLM_UNIGRAMS_PATH": f"{MODEL_DIR}/lm/neutral_english_unigrams.txt",
}

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential", "cmake")
    .uv_sync(".", uv_version="0.8.8")
    .add_local_dir("models", remote_path=MODEL_DIR, copy=True, ignore=["**/*.arpa.bin"])
    .add_local_python_source("inference", copy=True)
    .env(env)
)

decoder_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential", "cmake")
    .uv_pip_install(
        "fastapi>=0.128.0",
        "kenlm @ https://github.com/kpu/kenlm/archive/refs/heads/master.zip",
        "numpy>=1.26,<3",
        "pyctcdecode>=0.5.0",
    )
    .add_local_dir("models/lm", remote_path=f"{MODEL_DIR}/lm", copy=True)
    .add_local_python_source("inference", copy=True)
    .env(decoder_env)
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


@app.function(image=decoder_image, timeout=86_400)
@modal.concurrent(max_inputs=32, target_inputs=8)
@modal.asgi_app(label="decoder")
def decoder_fastapi_app():
    from inference.main import app as inference_app

    return inference_app

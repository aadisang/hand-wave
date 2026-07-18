from __future__ import annotations

from os import getenv

import modal

APP_NAME = "hand-wave-inference"
MODEL_DIR = "/models"
LM_VOLUME_DIR = "/lm"
LM_VOLUME_NAME = getenv("HAND_WAVE_MODAL_LM_VOLUME") or "hand-wave-lm"
LM_PROFILE = (getenv("HAND_WAVE_MODAL_LM") or "default").strip().lower()

DEPS = (
    "fastapi>=0.128.0",
    "kenlm @ https://github.com/kpu/kenlm/archive/refs/heads/master.zip",
    "numpy>=1.26,<3",
    "pyctcdecode>=0.5.0",
    "torch>=2.13,<2.14",
    "torchaudio>=2.11,<2.12",
)

if LM_PROFILE not in {"default", "wiki"}:
    raise ValueError("HAND_WAVE_MODAL_LM must be 'default' or 'wiki'")

env = {
    "CORS_ORIGINS": "https://handwave.sh",
    "HAND_WAVE_MODAL_LM": LM_PROFILE,
    "MODEL_DIR": MODEL_DIR,
}

lm_volume = modal.Volume.from_name(LM_VOLUME_NAME, create_if_missing=True)
volumes = {LM_VOLUME_DIR: lm_volume.with_mount_options(read_only=True)}

if LM_PROFILE == "wiki":
    env |= {
        "KENLM_MODEL_PATH": f"{LM_VOLUME_DIR}/wiki_en_token.arpa.bin",
        "KENLM_UNIGRAMS_PATH": f"{LM_VOLUME_DIR}/wiki_en_token.unigrams.txt",
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
@app.function(image=image, volumes=volumes, timeout=86_400)
@modal.concurrent(max_inputs=8)
@modal.asgi_app(label=APP_NAME)
def fastapi_app():
    from inference.main import app as inference_app

    return inference_app

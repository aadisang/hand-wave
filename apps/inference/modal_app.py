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
    "torch>=2.2,<2.6",
    "torchaudio>=2.2,<2.6",
)

if LM_PROFILE not in {"default", "wiki"}:
    raise ValueError("HAND_WAVE_MODAL_LM must be 'default' or 'wiki'")

env = {
    "CORS_ORIGINS": "https://handwave.sh",
    "MODEL_DIR": MODEL_DIR,
}
volumes: dict[str, modal.Volume] = {}

if LM_PROFILE == "wiki":
    lm_volume = modal.Volume.from_name(LM_VOLUME_NAME)
    volumes[LM_VOLUME_DIR] = lm_volume.with_mount_options(read_only=True)
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


@app.function(image=image, volumes=volumes, timeout=300)
@modal.concurrent(max_inputs=8)
@modal.asgi_app(label=APP_NAME)
def fastapi_app():
    from inference.main import app as inference_app

    return inference_app

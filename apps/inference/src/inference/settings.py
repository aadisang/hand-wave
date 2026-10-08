from functools import cache
from pathlib import Path
from typing import Literal

from pydantic import Field, FilePath, TypeAdapter
from pydantic_settings import BaseSettings, SettingsConfigDict

from inference.endpoints import DeploymentId, HttpOrigin

DEFAULT_CORS_ORIGINS = TypeAdapter(list[HttpOrigin]).validate_python(
    [
        "https://handwave.sh",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ]
)


class DeploymentSettings(BaseSettings):
    """Deployment identity read by the Modal descriptor on the launching host."""

    model_config = SettingsConfigDict(env_prefix="HANDWAVE_", frozen=True)

    deployment_kind: Literal["dev", "release"]
    deployment_id: DeploymentId


class AssetSettings(BaseSettings):
    """Model files shared by the CTC decoder and the text normalizer."""

    model_config = SettingsConfigDict(frozen=True)

    model_dir: Path = Path(__file__).resolve().parents[2] / "models"
    model_checkpoint_path: FilePath = Field(
        default_factory=lambda data: data["model_dir"] / "best.ckpt"
    )
    kenlm_model_path: FilePath = Field(
        default_factory=lambda data: data["model_dir"] / "lm" / "neutral_english_4gram.kenlm"
    )
    kenlm_unigrams_path: FilePath = Field(
        default_factory=lambda data: data["model_dir"] / "lm" / "neutral_english_unigrams.txt"
    )


class ServerSettings(BaseSettings):
    model_config = SettingsConfigDict(frozen=True)

    deployment_id: DeploymentId = Field(validation_alias="HANDWAVE_DEPLOYMENT_ID")
    cors_origins: list[HttpOrigin] = DEFAULT_CORS_ORIGINS


@cache
def get_asset_settings() -> AssetSettings:
    return AssetSettings()


@cache
def get_settings() -> ServerSettings:
    # The required deployment ID comes from the environment, not an argument.
    return ServerSettings()  # pyright: ignore[reportCallIssue]

from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest

from tools import backend
from tools import release as release_tool
from tools.dev import endpoint_from_output
from tools.release import release


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8000",
        "https://user:password@api.example",
        "https://api.example/path",
        "https://api.example?override=true",
        "https://api.example/#fragment",
        "https://api.example\nHANDWAVE_INFERENCE_URL=bad",
    ],
)
def test_generated_endpoint_rejects_unsafe_origins(url: str) -> None:
    with pytest.raises(ValueError):
        backend.validate_url(url)


def test_debug_endpoint_is_atomic_and_scoped(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(backend, "ROOT", tmp_path)
    directory = tmp_path / "apps/mobile/Configurations"
    directory.mkdir(parents=True)
    path = backend.write_endpoint("https://workspace--hand-wave-hw123456.modal.run", "Debug")
    assert "https:/$()/workspace--hand-wave-hw123456.modal.run" in path.read_text()
    assert not (directory / "ReleaseEndpoint.xcconfig").exists()
    assert not path.with_suffix(".tmp").exists()


def test_modal_output_cannot_select_production_or_another_developer() -> None:
    assert endpoint_from_output("https://workspace--hand-wave.modal.run", "hw123456") is None
    assert endpoint_from_output("https://workspace--hand-wave-other.modal.run", "hw123456") is None
    expected = "https://workspace-dev--hand-wave-hw123456.modal.run"
    assert endpoint_from_output(f"Created fastapi_app => {expected}", "hw123456") == expected


def test_release_rejects_an_unpinned_or_different_revision(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="full Git commit"):
        release("main", tmp_path / "manifest.json")
    with pytest.raises(ValueError, match="checked-out commit"):
        release("0" * 40, tmp_path / "manifest.json")


def test_release_rejects_untracked_source_files(tmp_path: Path, monkeypatch) -> None:
    revision = "a" * 40
    monkeypatch.setattr(
        release_tool.subprocess, "check_output", Mock(side_effect=[revision, "?? extra.py"])
    )
    with pytest.raises(ValueError, match="clean checkout"):
        release(revision, tmp_path / "manifest.json")


@pytest.mark.parametrize("verified", [True, False])
def test_existing_release_is_reused_only_after_verification(
    tmp_path: Path, monkeypatch, verified: bool
) -> None:
    revision = "a" * 40
    url = f"https://workspace--hand-wave-{revision}.modal.run"
    monkeypatch.setattr(release_tool.subprocess, "check_output", Mock(side_effect=[revision, ""]))
    lookup = Mock(return_value=Mock(get_web_url=Mock(return_value=url)))
    monkeypatch.setattr(release_tool.modal.Function, "from_name", lookup)
    deploy = Mock(side_effect=AssertionError("An existing release must never be redeployed"))
    monkeypatch.setattr(release_tool.modal.App, "deploy", deploy)
    verify = AsyncMock(side_effect=None if verified else RuntimeError("Wrong build"))
    monkeypatch.setattr(release_tool, "verify_backend", verify)
    endpoint = Mock()
    monkeypatch.setattr(release_tool, "write_endpoint", endpoint)
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    monkeypatch.setenv("HANDWAVE_DEPLOYMENT_KIND", "test")
    monkeypatch.setenv("HANDWAVE_DEPLOYMENT_ID", "test")
    manifest = tmp_path / "manifest.json"
    if verified:
        release(revision, manifest)
        endpoint.assert_called_once_with(url, "Release")
        assert manifest.exists()
    else:
        with pytest.raises(RuntimeError, match="Wrong build"):
            release(revision, manifest)
        endpoint.assert_not_called()
        assert not manifest.exists()
    verify.assert_awaited_once_with(url, revision)
    lookup.assert_called_once_with(f"hand-wave-{revision}", "fastapi_app", environment_name="main")
    deploy.assert_not_called()

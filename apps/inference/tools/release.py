"""Deploy or reuse the immutable backend for a release commit, then verify it."""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import subprocess
import sys
from pathlib import Path

import modal

from tools.backend import ROOT, verify_backend, write_endpoint, write_manifest


def release(revision: str, output: Path) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("A full Git commit SHA is required")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if revision != head:
        raise ValueError("Release revision must match the checked-out commit")
    status = subprocess.check_output(
        ["git", "status", "--porcelain", "--untracked-files=normal"], cwd=ROOT, text=True
    )
    if status.strip():
        raise ValueError("Release requires a clean checkout with no untracked source files")
    app_name = f"hand-wave-{revision}"
    os.environ["HANDWAVE_DEPLOYMENT_KIND"] = "release"
    os.environ["HANDWAVE_DEPLOYMENT_ID"] = revision
    try:
        function = modal.Function.from_name(app_name, "fastapi_app", environment_name="main")
        url = function.get_web_url()
    except modal.exception.NotFoundError:
        sys.path.insert(0, str(ROOT / "apps/inference"))
        from modal_app import app, fastapi_app

        with modal.enable_output():
            app.deploy(environment_name="main", tag=revision)
        url = fastapi_app.get_web_url()
    if url is None:
        raise RuntimeError("Modal did not return an inference endpoint")
    asyncio.run(verify_backend(url, revision))
    write_manifest(output, url, revision, "main")
    write_endpoint(url, "Release")
    if github_output := os.getenv("GITHUB_OUTPUT"):
        with Path(github_output).open("a") as result:
            result.write(f"url={url}\ndeployment_id={revision}\n")
    print(f"Release backend verified: {url}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output", type=Path, default=ROOT / ".handwave/release.json")
    args = parser.parse_args()
    release(args.revision, args.output)

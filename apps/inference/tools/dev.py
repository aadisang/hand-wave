"""Run one temporary Modal backend and connect the local clients to it."""

from __future__ import annotations

import argparse
import asyncio
import fcntl
import hashlib
import os
import re
import signal
import socket
import subprocess
import sys
import time
from queue import Empty, Queue
from threading import Thread
from uuid import uuid4

from tools.backend import ROOT, verify_backend, write_endpoint, write_manifest

ENDPOINT = ROOT / "apps/mobile/Configurations/DebugEndpoint.xcconfig"
STATE = ROOT / ".handwave"


def endpoint_from_output(line: str, suffix: str) -> str | None:
    # Modal serve has no machine-readable output option. Accept only this
    # session's native dev suffix; readiness also checks its deployment ID.
    match = re.search(r"https://[a-z0-9-]+\.modal\.run", line)
    if match and match[0].endswith(f"-{suffix}.modal.run"):
        return match[0]
    return None


def stop(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    for sig, timeout in ((signal.SIGINT, 20), (signal.SIGTERM, 10), (signal.SIGKILL, 5)):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=timeout)
            return
        except subprocess.TimeoutExpired:
            continue


def run(backend_only: bool) -> None:
    STATE.mkdir(exist_ok=True)
    with (STATE / "dev.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("Development is already running in this checkout") from exc
        # Stable across restarts, unique to this Mac and checkout. Xcode builds
        # can reconnect after restarting pnpm dev without rebuilding the app.
        identity = f"{socket.gethostname()}:{ROOT}"
        suffix = "hw" + hashlib.sha256(identity.encode()).hexdigest()[:6]
        deployment_id = uuid4().hex
        environment = {
            **os.environ,
            "MODAL_DEV_SUFFIX": suffix,
            "HANDWAVE_DEPLOYMENT_KIND": "dev",
            "HANDWAVE_DEPLOYMENT_ID": deployment_id,
            "NO_COLOR": "1",
            "COLUMNS": "240",
            "PYTHONUNBUFFERED": "1",
        }
        ENDPOINT.unlink(missing_ok=True)
        manifest = STATE / "development.json"
        manifest.unlink(missing_ok=True)
        modal_process = None
        web_process = None
        try:
            modal_process = subprocess.Popen(
                [sys.executable, "-m", "modal", "serve", "--env", "dev", "modal_app.py"],
                cwd=ROOT / "apps/inference",
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
            lines: Queue[str] = Queue()

            def read_output() -> None:
                assert modal_process is not None and modal_process.stdout is not None
                for line in modal_process.stdout:
                    print(line, end="", flush=True)
                    if ".modal.run" in line:
                        lines.put(line)

            Thread(target=read_output, daemon=True).start()
            deadline = time.monotonic() + 900
            url = None
            while url is None:
                if modal_process.poll() is not None:
                    raise RuntimeError("Modal stopped before the development backend was ready")
                if time.monotonic() >= deadline:
                    raise TimeoutError("Timed out building the development backend")
                try:
                    url = endpoint_from_output(lines.get(timeout=0.2), suffix)
                except Empty:
                    pass
            print("Checking the development model and streaming protocol...", flush=True)
            try:
                asyncio.run(verify_backend(url, deployment_id))
            except TimeoutError as exc:
                raise TimeoutError(
                    "The development backend did not become ready within 3 minutes"
                ) from exc
            write_endpoint(url, "Debug")
            write_manifest(manifest, url, deployment_id, "dev")
            print(f"Development backend ready: {url}", flush=True)
            print("Xcode Debug is configured. Press Run; no IP settings are needed.", flush=True)
            if not backend_only:
                web_process = subprocess.Popen(
                    ["pnpm", "exec", "vite", "dev"],
                    cwd=ROOT / "apps/web",
                    env={**os.environ, "VITE_INFERENCE_URL": url},
                    start_new_session=True,
                )
            while modal_process.poll() is None:
                if web_process is not None and web_process.poll() is not None:
                    raise RuntimeError("The web development server stopped")
                time.sleep(0.5)
            raise RuntimeError("The development backend stopped")
        finally:
            try:
                try:
                    stop(web_process)
                finally:
                    stop(modal_process)
            finally:
                ENDPOINT.unlink(missing_ok=True)
                manifest.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-only", action="store_true", help="Configure Xcode without Vite")
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        run(args.backend_only)
    except KeyboardInterrupt:
        pass
    except (RuntimeError, TimeoutError) as exc:
        sys.exit(str(exc))

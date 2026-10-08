"""Run real backend, browser, and native-client checks with retained evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import socket
import subprocess
import sys
import tarfile
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen
from uuid import uuid4

from inference.endpoints import BackendManifest, origin_text

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def stop(process: subprocess.Popen | None) -> bool:
    if process is None:
        return True
    for sig, timeout in ((signal.SIGTERM, 10), (signal.SIGKILL, 5)):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            process.poll()
            return True
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            process.poll()
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                return True
            except PermissionError:
                # Darwin can return EPERM while the group leader is being reaped.
                # Retry; only ESRCH confirms that the whole group is gone.
                pass
            time.sleep(0.1)
    return False


def run(args: argparse.Namespace) -> int:
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    report = {
        "started_at": datetime.now(UTC).isoformat(),
        "scope": ["backend"]
        + ([] if args.web_only else ["native-client"])
        + ([] if args.native_only else ["browser"]),
        "limits": "Synthetic camera/landmarks; no sign-accuracy or physical-glasses claim.",
        "status": "failed",
        "steps": [],
    }
    environment = dict(os.environ)
    backend = None
    backend_log = None
    listener = None

    def command(
        name: str, argv: list[str], *, cwd: Path = ROOT, timeout: int = 600
    ) -> None:
        print(f"E2E: {name}", flush=True)
        started = time.monotonic()
        step = {"name": name, "command": argv, "cwd": str(cwd.relative_to(ROOT))}
        report["steps"].append(step)
        with (output / f"{name}.log").open("w") as log:
            process = subprocess.Popen(
                argv,
                cwd=cwd,
                env=environment,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                code = process.wait(timeout=timeout)
                step["exit_code"] = code
                if code:
                    raise RuntimeError(f"{name} failed; see {output / f'{name}.log'}")
            finally:
                step["duration_seconds"] = round(time.monotonic() - started, 2)
                if not stop(process):
                    step["cleanup_error"] = "Process did not exit after SIGKILL"
                    raise RuntimeError(f"Could not stop {name}; evidence is retained")

    try:
        report["revision"] = git("rev-parse", "HEAD")
        report["working_tree"] = git("status", "--porcelain")
        (output / "working-tree.patch").write_bytes(
            subprocess.check_output(["git", "diff", "--binary", "HEAD"], cwd=ROOT)
        )
        untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0")
        with tarfile.open(output / "untracked-source.tar.gz", "w:gz") as archive:
            for name in untracked:
                if name and (ROOT / name).is_file():
                    archive.add(ROOT / name, arcname=name)
        files = git(
            "ls-files", "--cached", "--others", "--exclude-standard", "-z"
        ).split("\0")
        source_hashes = {
            name: digest(ROOT / name) for name in files if (ROOT / name).is_file()
        }
        (output / "source.json").write_text(json.dumps(source_hashes, indent=2) + "\n")
        command("contract", ["pnpm", "exec", "moon", "run", "contract:generate"])
        if args.backend_manifest:
            manifest = BackendManifest.model_validate_json(
                args.backend_manifest.read_bytes()
            )
            url, deployment_id = origin_text(manifest.url), manifest.deployment_id
        else:
            listener = socket.socket()
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            url, deployment_id = f"http://127.0.0.1:{port}", f"e2e-{uuid4().hex}"
            backend_log = (output / "server.log").open("w")
            backend = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "inference.main:app",
                    "--fd",
                    str(listener.fileno()),
                ],
                cwd=ROOT / "apps/inference",
                env={
                    **environment,
                    "HANDWAVE_DEPLOYMENT_ID": deployment_id,
                    "MODEL_CHECKPOINT_PATH": str(
                        ROOT / "apps/inference/models/best.ckpt"
                    ),
                    "KENLM_MODEL_PATH": str(
                        ROOT / "apps/inference/models/lm/neutral_english_4gram.kenlm"
                    ),
                    "KENLM_UNIGRAMS_PATH": str(
                        ROOT / "apps/inference/models/lm/neutral_english_unigrams.txt"
                    ),
                },
                stdout=backend_log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                pass_fds=(listener.fileno(),),
            )
        report["backend"] = {"url": url, "deployment_id": deployment_id}
        deadline = time.monotonic() + 180
        while True:
            if backend is not None and backend.poll() is not None:
                raise RuntimeError("Backend stopped during startup; see server.log")
            try:
                with urlopen(f"{url}/v1/health", timeout=2) as response:
                    health = json.load(response)
                if health != {"ok": True, "deployment_id": deployment_id}:
                    raise RuntimeError(
                        "The backend health identity does not match this run"
                    )
                break
            except (URLError, TimeoutError):
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        "Backend did not start within 3 minutes"
                    ) from None
                time.sleep(0.5)
        environment.update(VITE_INFERENCE_URL=url, HANDWAVE_DEPLOYMENT_ID=deployment_id)
        command(
            "backend",
            [
                sys.executable,
                "-m",
                "tools.e2e",
                "--url",
                url,
                "--deployment-id",
                deployment_id,
                "--output",
                str(output / "backend"),
            ],
            cwd=ROOT / "apps/inference",
        )
        if not args.web_only:
            command("native-workspace", ["pnpm", "exec", "moon", "run", "mobile:pods"])
            environment.update(
                E2E_INFERENCE_URL=url, IOS_EVIDENCE_DIR=str(output / "mobile")
            )
            command(
                "native-client",
                ["bash", "apps/mobile/scripts/test.sh", "live", "Debug"],
                timeout=1200,
            )
        if not args.native_only:
            environment["HANDWAVE_E2E_OUTPUT"] = str(output / "browser")
            command("browser", ["pnpm", "--filter", "@hand-wave/web", "test:e2e"])
        report["status"] = "passed"
    except (Exception, KeyboardInterrupt) as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
        print(report["error"], file=sys.stderr)
    finally:
        try:
            if not stop(backend):
                raise RuntimeError("Backend did not exit after SIGKILL")
        except Exception as exc:
            report["status"] = "failed"
            report["cleanup_error"] = str(exc)
        if listener is not None:
            listener.close()
        if backend_log is not None:
            backend_log.close()
        report["completed_at"] = datetime.now(UTC).isoformat()
        checksums: dict[str, str] = {}
        try:
            checksums = {
                str(path.relative_to(output)): digest(path)
                for path in output.rglob("*")
                if path.is_file()
            }
        except OSError as exc:
            report["status"] = "failed"
            report["evidence_error"] = str(exc)
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        checksums["report.json"] = digest(output / "report.json")
        (output / "SHA256SUMS").write_text(
            "".join(
                f"{checksum}  {name}\n" for name, checksum in sorted(checksums.items())
            )
        )
        print(f"E2E evidence: {output}", flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument(
        "--web-only", action="store_true", help="Omit the native simulator suite"
    )
    scope.add_argument(
        "--native-only", action="store_true", help="Omit the browser suite"
    )
    parser.add_argument(
        "--backend-manifest", type=Path, help="Use a running Modal dev backend"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT
        / "artifacts/e2e"
        / f"{datetime.now(UTC):%Y%m%dT%H%M%SZ}-{uuid4().hex[:8]}",
    )
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(130))
    sys.exit(run(parser.parse_args()))

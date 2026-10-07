"""Exercise the real service and save repeatable evidence, including failed runs."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

import aiohttp

from inference.schemas import RecognizeOut
from tools.backend import ROOT, validate_url
from tools.dev import stop


def source_identity() -> dict[str, Any]:
    names = subprocess.check_output(
        [
            "git",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            "apps/inference",
            "packages/contract",
        ],
        cwd=ROOT,
        text=True,
    ).split("\0")
    paths = {ROOT / name for name in names if name}
    paths.update((ROOT / "apps/inference/src/inference/generated").glob("*.py"))
    files = sorted(
        path
        for path in paths
        if path.is_file()
        and path.suffix in (".py", ".toml", ".lock", ".tsp", ".json", ".ckpt", ".kenlm", ".txt")
    )
    hashes = {}
    for path in files:
        with path.open("rb") as source:
            hashes[str(path.relative_to(ROOT))] = hashlib.file_digest(source, "sha256").hexdigest()
    return {
        "git_revision": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "git_status": subprocess.check_output(
            ["git", "status", "--porcelain"], cwd=ROOT, text=True
        ).splitlines(),
        "sha256": hashes,
        "scope": "local source and assets; remote identity is verified by deployment_id only",
    }


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def context(frames: int) -> dict[str, int | float]:
    return {"idle_frames": 0, "missing_frames": 0, "segment_frames": frames, "motion": 0.0}


async def exercise(url: str, deployment_id: str, report: dict[str, Any]) -> None:
    """Real requests only: no model replacement, mocked transport, or skipped cases."""
    checks = report["checks"]
    transcript = report["transcript"]
    ws_url = url.replace("https://", "wss://").replace("http://", "ws://") + "/v1/stream"
    frames = [[0.0] * 162 for _ in range(24)]

    def passed(name: str) -> None:
        checks.append({"name": name, "status": "passed"})

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as client:
        async with asyncio.timeout(180):
            while True:
                try:
                    async with client.get(f"{url}/v1/health") as response:
                        response.raise_for_status()
                        health = await response.json()
                    break
                except (aiohttp.ClientError, TimeoutError):
                    await asyncio.sleep(0.25)
        transcript.append({"request": "GET /v1/health", "response": health})
        check(health == {"ok": True, "deployment_id": deployment_id}, "Wrong service identity")
        passed("real-model startup and deployment identity")

        async with client.options(
            f"{url}/v1/health",
            headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
        ) as response:
            cors = dict(response.headers)
            transcript.append({"request": "development browser CORS preflight", "response": cors})
            # Release endpoints correctly reject localhost. Only local/dev checks require it.
            if urlsplit(url).hostname in ("127.0.0.1", "localhost") or "-dev--" in url:
                check(
                    response.headers.get("Access-Control-Allow-Origin") == "http://localhost:3000",
                    "Development browser cannot access this service",
                )
                passed("development browser CORS")

        try:
            unexpected = await client.ws_connect(ws_url)
        except aiohttp.WSServerHandshakeError as exc:
            transcript.append({"request": "WebSocket without subprotocol", "status": exc.status})
            check(exc.status == 403, "Unexpected handshake rejection")
        else:
            await unexpected.close()
            raise AssertionError("Accepted a WebSocket without handwave.v1")
        passed("invalid WebSocket handshake rejected")

        sequence = 0

        async def exchange(
            ws: aiohttp.ClientWebSocketResponse, name: str, payload: dict[str, Any], expected: str
        ) -> dict[str, Any]:
            nonlocal sequence
            sequence += 1
            payload = {"protocol": 1, **payload, "sequence": sequence}
            entry: dict[str, Any] = {"check": name, "request": payload}
            transcript.append(entry)
            started = time.monotonic()
            await ws.send_json(payload)
            async with asyncio.timeout(60):
                result = await ws.receive_json()
            entry.update(response=result, elapsed_seconds=round(time.monotonic() - started, 3))
            check(
                result.get("type") == expected
                and result.get("sequence") == sequence
                and result.get("protocol") == 1,
                f"{name}: invalid response envelope",
            )
            if expected == "result":
                RecognizeOut.model_validate(result["result"])
            if expected == "error":
                check(bool(result.get("detail")), f"{name}: missing error detail")
            return result

        async def recognize(
            ws: aiohttp.ClientWebSocketResponse, name: str, count: int, buffered: int
        ) -> dict[str, Any]:
            response = await exchange(
                ws,
                name,
                {"type": "recognize", "frames": frames[:count], "context": context(buffered)},
                "result",
            )
            trace = response["result"]["trace"]
            check(trace.get("prediction") is not None, f"{name}: model did not run")
            check(
                trace.get("decode", {}).get("buffered_frames") == buffered,
                f"{name}: wrong stream window",
            )
            passed(name)
            return response

        async with client.ws_connect(ws_url, protocols=["handwave.v1"]) as ws:
            check(ws.protocol == "handwave.v1", "Wrong negotiated protocol")
            await exchange(ws, "ping", {"type": "ping"}, "pong")
            passed("versioned stream handshake")
            await recognize(ws, "actual checkpoint inference", 24, 24)
            await recognize(ws, "frame deltas accumulate", 8, 32)
            await exchange(ws, "missing context", {"type": "recognize", "frames": frames}, "error")
            await exchange(
                ws,
                "bad feature width",
                {"type": "recognize", "frames": [[0.0]], "context": context(33)},
                "error",
            )
            for kind in ("ping", "reset", "recognize"):
                await exchange(
                    ws,
                    f"wrong protocol {kind}",
                    {"type": kind, "protocol": 2, "context": context(32)},
                    "error",
                )
            await recognize(ws, "invalid input leaves stream usable and unchanged", 8, 40)
            async with client.ws_connect(ws_url, protocols=["handwave.v1"]) as other:
                await recognize(other, "concurrent client has independent frame state", 8, 8)
            await recognize(ws, "other client does not alter first client state", 8, 48)
            await exchange(
                ws,
                "oversized frame batch",
                {
                    "type": "recognize",
                    "frames": [frames[0]] * 193,
                    "context": context(241),
                },
                "error",
            )
            await recognize(ws, "oversized batch does not alter the window", 8, 56)
            bounded = await exchange(
                ws,
                "rolling window remains bounded",
                {"type": "recognize", "frames": [frames[0]] * 192, "context": context(248)},
                "result",
            )
            check(
                bounded["result"]["trace"]["decode"]["buffered_frames"] == 192,
                "Stream retained frames beyond its window bound",
            )
            passed("rolling window remains bounded")
            finalized = await exchange(
                ws,
                "finalize",
                {"type": "recognize", "finalize": True, "context": context(248)},
                "result",
            )
            check(
                finalized["result"]["trace"].get("finalize") is not None,
                "Missing finalization trace",
            )
            await recognize(ws, "finalize clears the previous segment", 8, 8)
            await exchange(ws, "reset", {"type": "reset"}, "reset")
            await exchange(
                ws,
                "reset leaves no buffered frames",
                {"type": "recognize", "context": context(0)},
                "error",
            )
            await recognize(ws, "reset permits a fresh segment", 8, 8)
        async with client.ws_connect(ws_url, protocols=["handwave.v1"]) as ws:
            await recognize(ws, "disconnect and reconnect start a fresh session", 8, 8)


def run(args: argparse.Namespace) -> int:
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    report: dict[str, Any] = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "command": [sys.executable, "-m", "tools.e2e", *sys.argv[1:]],
        "python_version": sys.version,
        "status": "failed",
        "checks": [],
        "transcript": [],
        "limits": [
            "Synthetic landmarks do not test recognition accuracy.",
            "Local execution does not test Modal routing or TLS.",
            "Remote source and asset hashes cannot be attested through the current health API.",
        ],
    }
    process = None
    log = (output / "server.log").open("w")
    listener = None
    try:
        report["source"] = source_identity()
        if args.manifest:
            manifest = json.loads(args.manifest.read_text())
            url = validate_url(manifest["url"])
            deployment_id = manifest["deployment_id"]
        elif args.url:
            if not args.deployment_id:
                raise ValueError("--url requires --deployment-id")
            parsed = urlsplit(args.url)
            if (
                parsed.scheme == "http"
                and parsed.hostname in ("127.0.0.1", "localhost")
                and parsed.path in ("", "/")
                and not parsed.username
                and not parsed.password
                and not parsed.query
                and not parsed.fragment
            ):
                url = args.url.rstrip("/")
            else:
                url = validate_url(args.url)
            deployment_id = args.deployment_id
        else:
            deployment_id = f"e2e-{uuid4().hex}"
            listener = socket.socket()
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            url = f"http://127.0.0.1:{port}"
            process = subprocess.Popen(
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
                    **os.environ,
                    "HANDWAVE_DEPLOYMENT_ID": deployment_id,
                    "MODEL_CHECKPOINT_PATH": str(ROOT / "apps/inference/models/best.ckpt"),
                    "KENLM_MODEL_PATH": str(
                        ROOT / "apps/inference/models/lm/neutral_english_4gram.kenlm"
                    ),
                    "KENLM_UNIGRAMS_PATH": str(
                        ROOT / "apps/inference/models/lm/neutral_english_unigrams.txt"
                    ),
                },
                stdout=log,
                stderr=subprocess.STDOUT,
                pass_fds=(listener.fileno(),),
                start_new_session=True,
            )
        report.update(
            url=url,
            deployment_id=deployment_id,
            service="owned local process" if process else "existing service",
        )
        asyncio.run(exercise(url, deployment_id, report))
        report["status"] = "passed"
    except Exception as exc:
        report["error"] = {
            "type": type(exc).__name__,
            "message": str(exc) or "Service check timed out",
        }
    finally:
        stop(process)
        if listener:
            listener.close()
        log.close()
        report["elapsed_seconds"] = round(time.monotonic() - started, 3)
        transcript = report.pop("transcript")
        (output / "transcript.json").write_text(json.dumps(transcript, indent=2) + "\n")
        report["artifacts"] = {}
        for filename in ("server.log", "transcript.json"):
            report["artifacts"][filename] = hashlib.sha256(
                (output / filename).read_bytes()
            ).hexdigest()
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Backend E2E {report['status']}: {output / 'report.json'}")
    if error := report.get("error"):
        print(error)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--manifest", type=Path)
    target.add_argument("--url")
    parser.add_argument("--deployment-id")
    parser.add_argument("--output", type=Path, default=ROOT / ".handwave/e2e/backend")
    sys.exit(run(parser.parse_args()))

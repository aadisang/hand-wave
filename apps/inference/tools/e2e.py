"""Exercise a running service's real protocol and save its transcript, including failed runs."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any

import aiohttp

from inference.schemas import RecognizeOut


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
        async with client.get(f"{url}/v1/health") as response:
            response.raise_for_status()
            health = await response.json()
        transcript.append({"request": "GET /v1/health", "response": health})
        check(health == {"ok": True, "deployment_id": deployment_id}, "Wrong service identity")
        passed("deployment identity")

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
    args.output.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "url": args.url,
        "deployment_id": args.deployment_id,
        "status": "failed",
        "checks": [],
        "transcript": [],
    }
    try:
        asyncio.run(exercise(args.url, args.deployment_id, report))
        report["status"] = "passed"
    except Exception as exc:
        report["error"] = {
            "type": type(exc).__name__,
            "message": str(exc) or "Service check timed out",
        }
    finally:
        path = args.output / "transcript.json"
        path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Backend E2E {report['status']}: {path}")
    if error := report.get("error"):
        print(error)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--deployment-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    sys.exit(run(parser.parse_args()))

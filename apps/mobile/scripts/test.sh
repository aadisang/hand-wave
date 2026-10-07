#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
mode="${1:-live}"
configuration="${2:-Debug}"
case "$mode" in live|isolated) ;; *) echo "Usage: $0 [live|isolated] [Debug|Release]" >&2; exit 2 ;; esac
case "$configuration" in Debug|Release) ;; *) echo "Invalid configuration: $configuration" >&2; exit 2 ;; esac
if [[ "$mode" == live && -z "${HANDWAVE_DEPLOYMENT_ID:-}" ]]; then
  echo "Live mode requires HANDWAVE_DEPLOYMENT_ID to reject a stale or wrong backend" >&2
  exit 2
fi

evidence_dir="${IOS_EVIDENCE_DIR:-$PWD/Derived/Evidence/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
destination="${IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 17 Pro,OS=latest}"
mkdir -p "$evidence_dir"
evidence_dir="$(cd "$evidence_dir" && pwd)"
if [[ -e "$evidence_dir/Tests.xcresult" || -e "$evidence_dir/run.json" ]]; then
  echo "Use a new evidence directory: $evidence_dir" >&2
  exit 2
fi

args=(test -workspace HandWave.xcworkspace -scheme HandWave
  -configuration "$configuration" -destination "$destination"
  -derivedDataPath Derived/Test -resultBundlePath "$evidence_dir/Tests.xcresult"
  -test-timeouts-enabled YES -maximum-test-execution-time-allowance 240
  ENABLE_TESTABILITY=YES "HANDWAVE_DEPLOYMENT_ID=${HANDWAVE_DEPLOYMENT_ID:-}")
if [[ "$mode" == isolated ]]; then
  args+=(-only-testing:HandWaveTests/WebSocketDeadlineTests -only-testing:HandWaveTests/PhoneCameraTests)
else
  args+=(-only-testing:HandWaveTests/BackendIntegrationTests)
fi
if [[ -n "${E2E_INFERENCE_URL:-}" ]]; then
  python3 - "$E2E_INFERENCE_URL" "$destination" <<'PY'
import sys
from urllib.parse import urlsplit
url = urlsplit(sys.argv[1])
local = url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost", "::1"} and "iOS Simulator" in sys.argv[2]
if not (url.scheme == "https" or local) or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in {"", "/"}:
    raise SystemExit("Test endpoint must be an HTTPS origin, or loopback HTTP on a simulator.")
PY
  args+=("HANDWAVE_INFERENCE_URL=$E2E_INFERENCE_URL")
fi

write_manifest() {
  python3 - "$evidence_dir/run.json" "$mode" "$configuration" "$destination" "${E2E_INFERENCE_URL:-built app configuration}" "$1" "${HANDWAVE_DEPLOYMENT_ID:-}" <<'PYTHON'
import datetime
import json
import subprocess
import sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({
    "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], text=True).strip()),
    "mode": sys.argv[2], "configuration": sys.argv[3], "destination": sys.argv[4],
    "endpoint": sys.argv[5], "exit_code": None if sys.argv[6] == "running" else int(sys.argv[6]),
    "status": "running" if sys.argv[6] == "running" else "passed" if sys.argv[6] == "0" else "failed",
    "expected_deployment_id": sys.argv[7] or None,
    "scope": "client/service integration; no camera or sign accuracy claim" if sys.argv[2] == "live" else "isolated regressions only; no live backend",
    "result_bundle": "Tests.xcresult", "log": "xcodebuild.log",
}, indent=2) + "\n")
PYTHON
}

write_manifest running
set +e
xcodebuild "${args[@]}" 2>&1 | tee "$evidence_dir/xcodebuild.log"
result=${PIPESTATUS[0]}
set -e
if [[ -d "$evidence_dir/Tests.xcresult" ]]; then
  xcrun xcresulttool get test-results summary --path "$evidence_dir/Tests.xcresult" > "$evidence_dir/summary.json" || result=1
  xcrun xcresulttool export attachments --path "$evidence_dir/Tests.xcresult" --output-path "$evidence_dir/attachments" || result=1
  python3 - "$evidence_dir/summary.json" "$mode" <<'PYTHON' || result=1
import json
import sys
from pathlib import Path
summary = json.loads(Path(sys.argv[1]).read_text())
expected = 1 if sys.argv[2] == "live" else 3
if summary.get("result") != "Passed" or summary.get("passedTests") != expected or summary.get("skippedTests") != 0:
    raise SystemExit(f"Expected {expected} passing tests and no skips; inspect summary.json")
PYTHON
else
  result=1
fi
write_manifest "$result"
printf 'Native test evidence: %s\n' "$evidence_dir"
exit "$result"

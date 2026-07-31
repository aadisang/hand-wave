#!/bin/sh

set -eu

cd "$(dirname "$0")/.."

case "${1:-}" in
  format)
    rg --files HandWave Project.swift Tuist.swift \
      -g '*.swift' \
      -g '!HandWave/Sources/Generated/**' \
      -0 \
      | xargs -0 swift format \
        --configuration .swift-format \
        --parallel \
        --in-place
    ;;
  lint)
    rg --files HandWave Project.swift Tuist.swift \
      -g '*.swift' \
      -g '!HandWave/Sources/Generated/**' \
      -0 \
      | xargs -0 swift format lint \
        --configuration .swift-format \
        --parallel \
        --strict
    ;;
  *)
    echo "Usage: $0 format|lint" >&2
    exit 2
    ;;
esac

#!/usr/bin/env sh
set -eu

dir="$1"
for f in "$dir"/*.swift; do
  { echo '// swift-format-ignore-file'; cat "$f"; } >"$f.tmp"
  mv "$f.tmp" "$f"
done

#!/usr/bin/env bash
# The cuts project's shell test. It stops at the first failing command (set -e), so a script that ends with status 99 ends this test with 99.
set -eu
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$(bash "$ROOT/scripts/cutsh.sh" add r x)"; [[ "$out" == "ok:r/x" ]]
out="$(bash "$ROOT/scripts/cutsh.sh" amend r x)"; [[ "$out" == "ok:r/x" ]]
out="$(bash "$ROOT/scripts/cutsh.sh" add r "" || true)"; [[ "$out" == "failed" ]]
out="$(bash "$ROOT/scripts/cutsh.sh" amend r "" || true)"; [[ "$out" == "failed" ]]
echo "all 4 checks passed"

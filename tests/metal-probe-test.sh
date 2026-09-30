#!/usr/bin/env bash
# lib/accel/metal.sh accel_probe_binary: does a built llama-server see the Metal GPU?
#
# The probe reads `llama-server --list-devices`. Current llama.cpp names the Metal device MTL0 and
# never prints the word "metal"; a probe that looked for it rejected every good Mac build
# (the 26 Sep 2026 install of qwen/3.8/flash-next/macos/128GB/llamacpp-pi on the M5 Max).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
. "$REPO_ROOT/lib/common.sh"
. "$REPO_ROOT/lib/accel/metal.sh"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fake() { # name output
  printf '#!/bin/sh\ncat <<"OUT"\n%s\nOUT\n' "$2" > "$TMP/$1"; chmod +x "$TMP/$1"; echo "$TMP/$1"
}

echo "metal device probe"
# Apple M5 Max (128 GB), llama.cpp 6fcaa16, verbatim
now=$(fake now '0.00.000.258 I srv  llama_server: initializing ...
Available devices:
  MTL0: Apple M5 Max (110100 MiB, 110099 MiB free)
  BLAS: Accelerate (0 MiB, 0 MiB free)')
older=$(fake older 'Available devices:
  Metal: Apple M2 Max (98304 MiB, 98304 MiB free)')
cpu=$(fake cpu 'Available devices:
  BLAS: Accelerate (0 MiB, 0 MiB free)')
assert_ok    "MTL0 (current llama.cpp) is a Metal device"  accel_probe_binary "$now"
assert_ok    "'Metal:' (older llama.cpp) is a Metal device" accel_probe_binary "$older"
assert_fails "a CPU-only build is not"                      accel_probe_binary "$cpu"
finish

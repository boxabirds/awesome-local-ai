#!/usr/bin/env bash
# Every runtime launcher refuses to start while another model server is running.
#
# A model server holds tens of gigabytes. Two at once on one machine means swap, and swap means the harness's
# guard stops the story that is running. On 6 October 2026 an installer's smoke test started a llama.cpp server
# beside a live mlx-serve run on a 128 GB Mac: swap went 0.13 -> 35.47 GB and story 11 of v2-mlx26101-r5 was
# stopped. Four launchers refused that; three had no check at all, and llama.cpp was one of them.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
trap 'rm -f "$LOG_FILE"' EXIT

echo "every launcher guards against a second model server"
for f in "$REPO_ROOT"/lib/runtime/server-*.sh; do
  n="$(basename "$f")"
  assert_ok "$n: has the guard"            grep -q 'ALLOW_COEXIST' "$f"
  assert_ok "$n: names the override"       grep -q 'ALLOW_COEXIST=1' "$f"
  # The pattern has to know about every engine we run, or a launcher refuses only its own kind and lets the
  # others past. These are the process shapes each engine presents.
  for engine in 'llama-server' 'mlx-serve' 'gufo' 'mtplx' 'tensorfold' 'strata'; do
    assert_ok "$n: its pattern knows $engine" grep -q "$engine" "$f"
  done
done

echo
echo "and every launcher parses"
for f in "$REPO_ROOT"/lib/runtime/server-*.sh; do
  assert_ok "$(basename "$f") parses" bash -n "$f"
done

finish

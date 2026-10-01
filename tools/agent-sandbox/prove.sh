#!/usr/bin/env bash
# prove.sh -- prove on THIS machine that the agent's sandbox holds: PASS or FAIL for each forbidden and each permitted
# thing, tried from inside it, the way the harness starts an agent. The proof is the harness's
# (benchmarks/spec-bench/harness/prove-sandbox.sh); this is where to look for it from here.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../benchmarks/spec-bench/harness/prove-sandbox.sh" "$@"

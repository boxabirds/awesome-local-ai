#!/usr/bin/env bash
# prove-sandbox.sh -- prove the agent's world on THIS machine: from inside the sandbox, the way a story starts the agent,
# try every forbidden thing (read a path outside, read a canary key, write the spec, reach an unlisted host or a raw
# address, read another process's environment through /proc, read or write the home directory, write the machine's /tmp, read
# another run's directory) and every permitted thing (write the workspace, the npm registry, the model endpoint, a test
# server on the run's port), and print PASS or FAIL for each. Exit status 1 if any FAIL.
#
#   benchmarks/spec-bench/harness/prove-sandbox.sh
#
# Run it from a checkout or from a harness release (`<dbench home>/releases/<tag>/benchmarks/spec-bench/harness/`): it uses the
# harness's own code and builds agent-sandbox from the same tree, once. It touches no benchmark data: it makes its
# own run in a temporary directory in your home, puts canaries around it, removes them at the end, and needs no network
# beyond the allow-list (the npm registry and Playwright's CDN; offline, those two checks say SKIP). Needs node, curl,
# python3 and uv, which a bench machine has; on Linux, bwrap; and cargo for the first run (sandbox.py).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
exec uv run --quiet prove_sandbox.py "$@"

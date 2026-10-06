#!/usr/bin/env bash
# The capability probe's judging, against fixed responses.
#
# The probe decides whether a stack is worth a day of benchmarking, so a check that passes on a bad answer is
# worse than no check at all: it would wave through the thing it exists to catch. Its own self-test covers each
# judgement with a case that should pass and one that should fail -- including a tool call returned as prose
# (the defect gufo has had repeatedly) and the exact string a run drifted to in FM-2, which cost twenty-one
# held-out tests.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
trap 'rm -f "$LOG_FILE"' EXIT

PROBE="$REPO_ROOT/tools/engine-probe/basic-capability.py"

echo "the probe exists and its judging is sound"
assert_ok "it is there"            test -f "$PROBE"
assert_ok "it parses"              python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$PROBE"
assert_ok "its self-test passes"   bash -c "cd '$REPO_ROOT' && uv run '$PROBE' --self-test"

echo
echo "and it refuses to run without somewhere to point"
assert_fails "no --base-url"       bash -c "cd '$REPO_ROOT' && uv run '$PROBE'"

finish

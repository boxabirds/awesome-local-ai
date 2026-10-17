#!/usr/bin/env bash
# Git holds a run's records and its bundle, not its bulk files.
#
# The event logs and the workspace/ mirror were most of the repository (1,016 MiB, 177 MiB without them) and are
# kept by the collector in the lake instead (docs/design/dbench-scopes/api.md). If a tracked path of one of these
# kinds appears again, the harness or a hand-made commit has put them back.
#
# Not forbidden: the compact logs of the reference runs (benchmarks/reference/...), the only copy of those logs;
# and the harness's own fixtures, which are not run folders.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
cd "$REPO_ROOT"

RUN='(combinations/.+/benchmarks/[^/]+/[^/]+|benchmarks/reference/[^/]+/[^/]+/[^/]+)'
# stdin: tracked paths. stdout: the ones that must not be tracked, each with the reason.
forbidden() {
  grep -E "^${RUN}/workspace/" | sed 's/$/\tworkspace\/ mirror/'
  return 0
}
forbidden_logs() {
  local in; in="$(cat)"
  grep -E "^${RUN}/stories/[0-9]+/agent-events[^/]*\.jsonl$" <<<"$in" | sed 's/$/\traw event log/'
  grep -E "^combinations/.+/benchmarks/[^/]+/[^/]+/stories/[0-9]+/agent-events[^/]*\.compact\.jsonl\.gz$" <<<"$in" | sed 's/$/\tcompact event log/'
  return 0
}
all_forbidden() { local in; in="$(cat)"; { forbidden <<<"$in"; forbidden_logs <<<"$in"; } | sort -u; }

echo "the detector sees each kind it exists to stop"
RUN_DIR="combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r4"
REF_DIR="benchmarks/reference/vidi/sonnet-5.5/v2-r4"
for p in "$RUN_DIR/workspace/src/App.tsx" "$REF_DIR/workspace/index.html" "$RUN_DIR/stories/03/agent-events.jsonl" \
         "$RUN_DIR/stories/03/agent-events-restart2.jsonl" "$RUN_DIR/stories/03/agent-events.compact.jsonl.gz"; do
  assert_eq "forbidden: $p" "1" "$(printf '%s\n' "$p" | all_forbidden | wc -l | tr -d ' ')"
done
echo "and lets through what stays"
for p in "$RUN_DIR/workspace.bundle" "$RUN_DIR/metrics.json" "$RUN_DIR/workspace-git-log.txt" "$RUN_DIR/stories/03/gate.json" \
         "$REF_DIR/stories/03/agent-events.compact.jsonl.gz" "benchmarks/spec-bench/harness/fixtures/events/pi/agent-events.jsonl" \
         "tools/bench-lake/tests/fixtures/lake/collected/node-a/$RUN_DIR/workspace.bundle"; do
  assert_eq "allowed: $p" "0" "$(printf '%s\n' "$p" | all_forbidden | wc -l | tr -d ' ')"
done

echo "nothing tracked in this repository is one of them"
found="$(git ls-files | all_forbidden)"
assert_eq "no tracked workspace/ mirror, raw event log or compact log of a combination run" "" "$found"
[[ -n "$found" ]] && printf '%s\n' "$found" | head -5 | sed 's/^/         /'

finish

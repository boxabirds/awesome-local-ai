#!/usr/bin/env bash
# fetch-work.sh <host> <run-dir> -- copy a run's harness work folder (the agent's workspace, with
# its git history, and its session files) from another machine, so the run can continue here.
#
#   benchmarks/vidi/harness/fetch-work.sh quintus benchmarks/reference/vidi/opus-5.5/run-2
#
# The folder's name comes from the run's place in the repo (drive.work_dir_for), so it's the same on
# every machine. Needs ssh access to <host> (e.g. Tailscale SSH). Refuses to overwrite a local copy.
set -euo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ $# -eq 2 ]] || { sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }
HOST="$1"; RUN="${2%/}"
NAME="$(cd "$HARNESS" && uv run --quiet python -c "
import sys; from pathlib import Path; import drive
print(drive.work_dir_for(drive.REPO_ROOT / sys.argv[1]).name)" "$RUN")"
LOCAL="$HOME/.vidi-bench/work/$NAME"
[[ -e "$LOCAL" ]] && { echo "$LOCAL already exists here; not overwriting" >&2; exit 1; }
mkdir -p "$(dirname "$LOCAL")"
echo "fetching $HOST:.vidi-bench/work/$NAME -> $LOCAL"
rsync -a --exclude node_modules --exclude dist --exclude .wrangler "$HOST:.vidi-bench/work/$NAME/" "$LOCAL/"
git -C "$LOCAL/workspace" log --oneline | head -3
echo "done: run.sh … --run-id ${RUN##*/} will continue from the next unfinished story"

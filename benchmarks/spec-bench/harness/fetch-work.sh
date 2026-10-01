#!/usr/bin/env bash
# fetch-work.sh <host> <run-dir> -- copy a run's harness work folder (the agent's workspace, with
# its git history, and its session files) from another machine, so the run can continue here.
#
#   benchmarks/spec-bench/harness/fetch-work.sh <node> benchmarks/reference/vidi/opus-5.5/run-2
#
# The folder is ~/.w/<id> on every machine, the id from the run's place in the repo (drive.work_dir_for); its long
# name, ~/.vidi-bench/work/<...>__benchmarks__<pack>__<run>, is a symlink to it on both (drive.link_work_dir), and
# is what is copied from, so a run from before the short dirs is fetched the same way. Needs ssh access to <host>
# (e.g. Tailscale SSH). Refuses to overwrite a local copy.
set -euo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ $# -eq 2 ]] || { sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }
HOST="$1"; RUN="${2%/}"
read -r NAME LOCAL < <(cd "$HARNESS" && uv run --quiet python -c "
import sys; from pathlib import Path; import drive
run = drive.REPO_ROOT / sys.argv[1]
print(drive.work_dir_name(run), drive.work_dir_for(run))" "$RUN")
[[ -e "$LOCAL" ]] && { echo "$LOCAL already exists here; not overwriting" >&2; exit 1; }
mkdir -p "$LOCAL"
echo "fetching $HOST:.vidi-bench/work/$NAME/ -> $LOCAL (its long name: ~/.vidi-bench/work/$NAME)"
rsync -a --exclude node_modules --exclude dist --exclude .wrangler "$HOST:.vidi-bench/work/$NAME/" "$LOCAL/"
(cd "$HARNESS" && uv run --quiet python -c "
import sys; from pathlib import Path; import drive
run = drive.REPO_ROOT / sys.argv[1]
drive.link_work_dir(run, drive.work_dir_for(run))" "$RUN")
git -C "$LOCAL/workspace" log --oneline | head -3
echo "done: run.sh … --run-id ${RUN##*/} will continue from the next unfinished story"

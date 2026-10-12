#!/usr/bin/env bash
# fetch-work.sh: copies a run's harness work folder from another machine. Runs the real script (and the real drive.py that names
# the folders) with HOME and the work root inside a temporary directory, and a stand-in rsync that records its arguments and
# "fetches" a small git workspace, so no machine is contacted.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

SCRIPT="$REPO_ROOT/benchmarks/spec-bench/harness/fetch-work.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
RUN="benchmarks/reference/vidi/opus-5.5/run-2"

mkdir -p "$TMP/bin"
cat > "$TMP/bin/rsync" <<'EOF'
#!/bin/sh
# the stand-in: record the arguments, then put a git workspace where the destination says
echo "$@" >> "$FAKE_RSYNC_LOG"
[ -n "$FAKE_RSYNC_FAIL" ] && exit 23
dest="$(eval echo \${$#})"
mkdir -p "$dest/workspace"
git -C "$dest/workspace" init -q -b main
echo hi > "$dest/workspace/f"; git -C "$dest/workspace" add f; git -C "$dest/workspace" commit -q -m "first story"
EOF
chmod +x "$TMP/bin/rsync"

run() {  # run <args...> : sets RC, OUT, ERR; HOME and the work root are private to the test
  rm -rf "$TMP/home"; mkdir -p "$TMP/home"; : > "$TMP/rsync.log"
  HOME="$TMP/home" VIDI_WORK_ROOT="$TMP/home/.w" PATH="$TMP/bin:$PATH" FAKE_RSYNC_LOG="$TMP/rsync.log" FAKE_RSYNC_FAIL="${FAIL:-}" \
    bash "$SCRIPT" "$@" >"$TMP/out" 2>"$TMP/err"; RC=$?
  OUT="$(cat "$TMP/out")"; ERR="$(cat "$TMP/err")"
}
contains() { [[ "$1" == *"$2"* ]]; }

echo "arguments"
run
assert_eq "no arguments print the usage and exit 2" "2" "$RC"
assert_ok "the usage names the script" contains "$OUT" "fetch-work.sh <host> <run-dir>"
run onlyhost
assert_eq "one argument is also the usage" "2" "$RC"
run host "$RUN" extra
assert_eq "three arguments are too many" "2" "$RC"

echo "a fetch"
run node-a "$RUN/"
assert_eq "it succeeds (a trailing slash on the run is ignored)" "0" "$RC"
assert_ok "it says what it fetches and from where" contains "$OUT" "fetching node-a:.vidi-bench/work/"
assert_ok "the rsync source is the long name on the host" contains "$(cat "$TMP/rsync.log")" "node-a:.vidi-bench/work/"
assert_ok "node_modules, dist and .wrangler are not copied" contains "$(cat "$TMP/rsync.log")" "--exclude node_modules --exclude dist --exclude .wrangler"
local_dir="$(ls -d "$TMP"/home/.w/*/ | head -1)"
assert_ok "the folder is ~/.w/<id>" test -d "$local_dir/workspace/.git"
assert_ok "the long name is linked to it" test -L "$(ls -d "$TMP"/home/.vidi-bench/work/*opus-5.5* | head -1)"
assert_ok "the last commits are shown" contains "$OUT" "first story"
assert_ok "it says how to continue" contains "$OUT" "run.sh … --run-id run-2 will continue from the next unfinished story"

echo "a local copy"
run node-a "$RUN"
# fetch again into the same home: it refuses to overwrite
HOME="$TMP/home" VIDI_WORK_ROOT="$TMP/home/.w" PATH="$TMP/bin:$PATH" FAKE_RSYNC_LOG="$TMP/rsync.log" bash "$SCRIPT" node-a "$RUN" >"$TMP/out" 2>"$TMP/err"; rc=$?
assert_eq "an existing local copy is not overwritten (exit 1)" "1" "$rc"
assert_ok "and says so" contains "$(cat "$TMP/err")" "already exists here; not overwriting"

echo "rsync fails"
FAIL=1 run node-a "$RUN"
assert_ok "a failing rsync stops the script (set -e)" test "$RC" -ne 0
assert_ok "and does not claim to be done" test -z "$(echo "$OUT" | grep '^done:')"

finish

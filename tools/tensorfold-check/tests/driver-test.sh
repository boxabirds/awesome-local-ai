#!/usr/bin/env bash
# run-checks.sh: it refuses to start while the Mac is benchmarking (unless --even-if-busy), and end to end against a
# fake `tensorfold` (tests/fake_server.py behind TensorFold's startup lines) it installs nothing, starts the server,
# runs checks 1 and 2, stops the server by its PID, and prints PASS/FAIL with the evidence and the check-3 command.
# pgrep, ps, uname and dbench's job files are stand-ins; no network, nothing installed outside a temp dir.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TFC="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$TFC/../.." && pwd)"
. "$REPO_ROOT/tests/lib.sh"
DRIVER="$TFC/run-checks.sh"
CFG="$REPO_ROOT/combinations/qwen/3.8/flash-next/macos/128GB/tensorfold-pi/config.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAKE_HOME="$WORK/home"; mkdir -p "$FAKE_HOME" "$WORK/bin" "$WORK/dbench/jobs"

# stand-ins: pgrep answers $PGREP_OUT, ps answers $PS_OUT, uname says Apple silicon
cat > "$WORK/bin/pgrep" <<'STUB'
#!/usr/bin/env bash
[[ -n "${PGREP_OUT:-}" ]] && { printf '%s\n' "$PGREP_OUT"; exit 0; }
exit 1
STUB
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "${PS_OUT:-}"\n' > "$WORK/bin/ps"
printf '#!/bin/sh\ncase "${1:-}" in -s) echo Darwin;; -m) echo arm64;; *) echo Darwin;; esac\n' > "$WORK/bin/uname"
# a fake tensorfold: --version, and `serve` runs the fake server with TensorFold's startup lines
cat > "$WORK/bin/tensorfold" <<STUB
#!/usr/bin/env bash
[[ "\${1:-}" == --version ]] && { echo "tensorfold 0.6.0"; exit 0; }
printf '%s\n' "\$@" > "$WORK/tensorfold.argv"
env | grep '^TENSORFOLD_' | sort > "$WORK/tensorfold.env"
port=""; prev=""
for a in "\$@"; do [[ "\$prev" == --port ]] && port="\$a"; prev="\$a"; done
exec python3 "$HERE/fake_server.py" --port "\$port" --cache "\${FAKE_CACHE:-keep}" --loaded-seconds "\${FAKE_LOAD_S:-0.1}" \
  --startup-line "[tensorfold] context window \${FAKE_KEEP:-200,704} tokens: the most one request can use in the 107.5 GiB memory budget and still keep its prompt for the next turn (the model's window is 262,144); have clients compact before it"
STUB
chmod +x "$WORK/bin/"*

# a checkpoint already downloaded and verified at the pinned revision: the fetch must not download anything
REPO_ID="$(bash -c ". '$CFG'; echo \$MODEL_REPO")"; REV="$(bash -c ". '$CFG'; echo \$MODEL_REVISION")"
STORE="$WORK/store"; PACK="$STORE/$REPO_ID"; mkdir -p "$PACK"
echo '{}' > "$PACK/config.json"
python3 -c 'import json,sys; json.dump({"repo": sys.argv[2], "revision": sys.argv[3], "sha256_verified": True,
  "checked_at": "test", "sizes": {"config.json": 3}}, open(sys.argv[1] + "/.awesome-local-ai-verified", "w"))' "$PACK" "$REPO_ID" "$REV"

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'; }
# real binaries, not version-manager shims (they need the real HOME); /bin/bash is the oldest bash a Mac has (3.2)
ln -s "$( (pyenv which uv 2>/dev/null || command -v uv) | head -1)" "$WORK/bin/uv"
REAL_PY="$(python3 -c 'import sys; print(sys.executable)')"
TOOL_PATH="$(dirname "$(command -v node 2>/dev/null || echo /usr/bin/x)"):$(dirname "$(command -v pi 2>/dev/null || echo /usr/bin/x)")"
drive() { # env... -- [driver args]; output in $WORK/out
  env -i PATH="$WORK/bin:$TOOL_PATH:/usr/bin:/bin:/usr/sbin" HOME="$FAKE_HOME" DBENCH_HOME="$WORK/dbench" \
      TENSORFOLD_BIN="$WORK/bin/tensorfold" TENSORFOLD_MODEL_STORE="$STORE" TFC_RUNS_ROOT="$WORK/runs" TFC_PYTHON="$REAL_PY" \
      UV_CACHE_DIR="$WORK/uv-cache" UV_PYTHON_DOWNLOADS=never "$@" >"$WORK/out" 2>&1
}
printf '#!/usr/bin/env bash\n[[ "${1:-}" == --version ]] && { echo "tensorfold 0.6.0"; exit 0; }\necho "tensorfold: this checkpoint is refused"; exit 1\n' > "$WORK/bin/tensorfold-dies"
chmod +x "$WORK/bin/tensorfold-dies"
runs() { ls "$WORK/runs" 2>/dev/null | grep -c . || true; }

echo "busy: refuses while the Mac is benchmarking"
drive PGREP_OUT="4242 python3 drive.py --pack benchmarks/vidi" /bin/bash "$DRIVER"
assert_eq "a running agent (drive.py) -> refused with exit 3" 3 "$?"
assert_ok "...naming it" grep -q 'drive.py' "$WORK/out"
assert_eq "...before anything is installed or started" 0 "$(runs)"
assert_fails "...no server was started" test -f "$WORK/tensorfold.argv"

echo '{"id":"canvas-mlx-07","state":{"status":"running","pid":1,"pgid":1,"attempt":1,"started_at":0}}' > "$WORK/dbench/jobs/canvas-mlx-07.json"
drive /bin/bash "$DRIVER"
assert_eq "a running dbench job -> refused" 3 "$?"
assert_ok "...naming the job" grep -q 'canvas-mlx-07' "$WORK/out"
rm "$WORK/dbench/jobs/canvas-mlx-07.json"

echo '{"id":"canvas-mlx-08","state":{"status":"queued"}}' > "$WORK/dbench/jobs/canvas-mlx-08.json"
drive /bin/bash "$DRIVER"
assert_eq "a queued dbench job on a node that is not held -> refused (it would start mid-check)" 3 "$?"
assert_ok "...saying to hold the node" grep -q 'hold' "$WORK/out"
echo '{"reason":"tensorfold checks","by":"x","at":0}' > "$WORK/dbench/hold.json"
drive TENSORFOLD_BIN="$WORK/bin/tensorfold-dies" /bin/bash "$DRIVER" --port "$(free_port)"
rc=$?
assert_ok "...but not once the node is held (it goes on, here to a server that dies)" test "$rc" -ne 3
assert_fails "...and does not mention the queued job" grep -q 'canvas-mlx-08' "$WORK/out"
rm -rf "$WORK/runs"
rm "$WORK/dbench/jobs/canvas-mlx-08.json" "$WORK/dbench/hold.json"
echo '{"id":"old","state":{"status":"done","exit_code":0}}' > "$WORK/dbench/jobs/old.json"

drive PS_OUT="  555 /x/mlx-serve --model m --serve --port 18010" /bin/bash "$DRIVER"
assert_eq "a model server already running -> refused" 3 "$?"
assert_ok "...naming it" grep -q 'mlx-serve' "$WORK/out"
assert_eq "still nothing started" 0 "$(runs)"

if ! command -v pi >/dev/null || ! command -v node >/dev/null; then
  echo "  skip end-to-end runs: pi and node are needed to capture pi's requests"
  finish; exit
fi

echo
echo "end to end, against a fake TensorFold that keeps its cache"
PORT="$(free_port)"
drive PGREP_OUT="4242 python3 drive.py" /bin/bash "$DRIVER" --even-if-busy --port "$PORT"
rc=$?
assert_eq "--even-if-busy runs anyway; both checks pass -> exit 0" 0 "$rc"
RUN="$WORK/runs/$(ls "$WORK/runs" | head -1)"
assert_ok "check 1 PASS printed" grep -q '^check 1 (long-context cache retention): PASS' "$WORK/out"
assert_ok "check 2 PASS printed" grep -q '^check 2 (tool calls with pi.s requests): PASS' "$WORK/out"
assert_ok "evidence: check 1 summary and results" test -s "$RUN/check1/summary.md" -a -s "$RUN/check1/results.json"
assert_ok "evidence: check 2 summary and results" test -s "$RUN/check2/summary.md" -a -s "$RUN/check2/results.json"
assert_ok "...and the paths are printed" grep -qF "$RUN/check1/summary.md" "$WORK/out"
assert_ok "the keep-prompt limit is recorded" grep -q '"keep_limit": 200704' "$RUN/keep-limit.json"
assert_ok "the server ran the combination's command line (fitted: no --context)" \
  bash -c "! grep -qx -- --context '$WORK/tensorfold.argv' && grep -qx -- '--reasoning-effort' '$WORK/tensorfold.argv'"
assert_ok "...with the combination's memory budget" grep -qx 'TENSORFOLD_MEMORY_LIMIT_GB=112' "$WORK/tensorfold.env"
assert_ok "the server was stopped by its PID" bash -c "! kill -0 \$(cat '$RUN/server.pid') 2>/dev/null"
assert_ok "the check-3 command is printed, one story" grep -qE '^ *dbench submit .*--combination qwen/3.8/flash-next/macos/128GB/tensorfold-pi .*--stories 1' "$WORK/out"
assert_ok "pi's context limit is confirmed against the keep-prompt limit" grep -q 'CONTEXT_LIMIT=131072 .*fits' "$WORK/out"
assert_ok "the run log is kept" test -s "$RUN/run.log"
assert_ok "the server's load time is reported" grep -q 'loaded in 0.1 s' "$WORK/out"
assert_fails "...with no harness-timeout warning for a fast load" grep -q 'would time out' "$WORK/out"

echo
echo "end to end, against a fake TensorFold that keeps less than pi needs"
PORT="$(free_port)"; rm -f "$WORK/tensorfold.argv"
drive FAKE_KEEP="140,288" FAKE_LOAD_S=1200 /bin/bash "$DRIVER" --port "$PORT"
assert_eq "both checks can still pass" 0 "$?"
assert_ok "a load slower than the harness waits is flagged" grep -q 'took 1200.0 s, so check 3 would time out' "$WORK/out"
assert_ok "the driver says what CONTEXT_LIMIT must become (keep - 16384)" grep -q 'set CONTEXT_LIMIT=123904' "$WORK/out"

echo
echo "end to end, against a fake TensorFold that loses its cache"
PORT="$(free_port)"
drive FAKE_CACHE=drop /bin/bash "$DRIVER" --port "$PORT"
assert_eq "check 1 fails -> exit 1" 1 "$?"
assert_ok "check 1 FAIL printed, naming the first turn that re-prefilled" grep -q '^check 1 (long-context cache retention): FAIL.*turn 2' "$WORK/out"
assert_fails "no check-3 command is printed" grep -q 'dbench submit' "$WORK/out"
RUN="$(ls -d "$WORK/runs/"* | tail -1)"
assert_ok "the server was stopped by its PID" bash -c "! kill -0 \$(cat '$RUN/server.pid') 2>/dev/null"

echo
echo "a server that dies while loading"
drive TENSORFOLD_BIN="$WORK/bin/tensorfold-dies" /bin/bash "$DRIVER" --port "$(free_port)"
assert_eq "-> exit 2 (could not run the checks)" 2 "$?"
assert_ok "...showing the server's own words" grep -q 'this checkpoint is refused' "$WORK/out"

finish

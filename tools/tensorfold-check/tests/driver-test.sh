#!/usr/bin/env bash
# run-checks.sh has two phases. Prepare (install the pinned TensorFold, fetch the pinned checkpoint, render pi's
# requests) uses only disk and network, so it runs whatever busy.sh says: `--prepare-only` stops after it, and with
# no option on a busy Mac it is done and then the script exits 3 with the checks waiting for the machine. The checks
# (start the server, checks 1 and 2, stop it, verdict) are refused while the Mac is benchmarking unless
# --even-if-busy. End to end against a fake `tensorfold` (tests/fake_server.py behind TensorFold's startup lines) it
# starts the server, runs checks 1 and 2, stops the server by its PID, and prints PASS/FAIL with the evidence and the
# check-3 command. pgrep, ps, uname, df, uv, hf, the sha256 tools and dbench's job files are stand-ins; no network,
# nothing installed outside a temp dir.
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
      UV_CACHE_DIR="$WORK/uv-cache" UV_PYTHON_DOWNLOADS=never "$@" >"${DRIVE_OUT:-$WORK/out}" 2>&1
}
printf '#!/usr/bin/env bash\n[[ "${1:-}" == --version ]] && { echo "tensorfold 0.6.0"; exit 0; }\necho "tensorfold: this checkpoint is refused"; exit 1\n' > "$WORK/bin/tensorfold-dies"
chmod +x "$WORK/bin/tensorfold-dies"
runs() { ls "$WORK/runs" 2>/dev/null | grep -c . || true; }

# ---- stand-ins for the prepare phase: they record what they were asked to do --------------------------------------
PIN_COMMIT="$(bash -c ". '$CFG'; echo \$TENSORFOLD_COMMIT")"
PIN_PYTHON="$(bash -c ". '$CFG'; echo \$TENSORFOLD_PYTHON")"
bash -c ". '$CFG'; printf '%s\n' \"\$MODEL_SHA256\"" | grep . > "$WORK/sha.table"
CALLS="$WORK/calls"; mkdir -p "$CALLS" "$WORK/netstub" "$WORK/pistub"
# How often a held download looks to see whether the test has let it go, and how long a test waits for one to start.
HOLD_POLL_S=0.2; HOLD_START_TRIES=150
# Free space `df` reports unless a test says otherwise: more than any checkpoint.
PLENTY_FREE_KB=999999999999
# `uv venv --python V DIR` makes DIR/bin/python, which answers the pinned commit; `uv pip install` puts the fake
# tensorfold (the one that would start a server) beside it.
cat > "$WORK/netstub/uv" <<STUB
#!/usr/bin/env bash
echo "uv \$*" >> "$CALLS/uv.log"
if [[ "\$1" == venv ]]; then
  dir="\${@: -1}"; mkdir -p "\$dir/bin"
  printf '#!/usr/bin/env bash\necho %s\n' "$PIN_COMMIT" > "\$dir/bin/python"; chmod +x "\$dir/bin/python"
elif [[ "\$1 \$2" == "pip install" ]]; then
  cp "$WORK/bin/tensorfold" "\$(dirname "\$4")/tensorfold"
fi
exit 0
STUB
# `hf download REPO --revision REV --local-dir DIR` writes a complete pack into DIR, or fails when the test has
# made $CALLS/hf-fails.
cat > "$WORK/netstub/hf" <<STUB
#!/usr/bin/env bash
echo "hf \$*" >> "$CALLS/hf.log"
[[ "\$1" == download ]] || exit 0
[[ -e "$CALLS/hf-fails" ]] && { echo "hf: connection reset"; exit 1; }
# a download still in progress: the first one only, so that an overlapping second one shows up as a second download
if [[ "\$(grep -c '^hf download ' "$CALLS/hf.log")" == 1 ]]; then
  while [[ -e "$CALLS/hf-holds" ]]; do sleep "$HOLD_POLL_S"; done
fi
dir="\${@: -1}"; mkdir -p "\$dir"
python3 - "\$dir" "$WORK/sha.table" <<'PY2'
import json, pathlib, sys
d = pathlib.Path(sys.argv[1])
names = [line.split()[1] for line in open(sys.argv[2])]
for n in names:
    (d / n).write_text(n)
for n in ("config.json", "generation_config.json", "chat_template.jinja", "tokenizer_config.json"):
    (d / n).write_text("{}")
shards = [n for n in names if n.endswith(".safetensors")]
(d / "model.safetensors.index.json").write_text(json.dumps({"weight_map": {str(i): n for i, n in enumerate(shards)}}))
PY2
STUB
# The sha256 tools answer the published hash of whichever file they are given.
cat > "$WORK/netstub/shasum" <<STUB
#!/usr/bin/env bash
f="\${@: -1}"
printf '%s  %s\n' "\$(awk -v n="\$(basename "\$f")" '\$2 == n {print \$1}' "$WORK/sha.table")" "\$f"
STUB
cp "$WORK/netstub/shasum" "$WORK/netstub/sha256sum"
cat > "$WORK/netstub/df" <<STUB
#!/usr/bin/env bash
echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
echo "/dev/fake 0 0 \$(cat "$CALLS/df-free-kb" 2>/dev/null || echo $PLENTY_FREE_KB) 1% /"
STUB
# pi and node, for cases that only need to see that the session would be rendered
printf '#!/usr/bin/env bash\necho "9.9.9"\n' > "$WORK/pistub/pi"
printf '#!/usr/bin/env bash\necho "node $*" >> "%s/node.log"\n' "$CALLS" > "$WORK/pistub/node"
chmod +x "$WORK/netstub/"* "$WORK/pistub/"*
STUB_PATH="$WORK/pistub:$WORK/netstub:$WORK/bin:/usr/bin:/bin:/usr/sbin"
PREP_HOME="$WORK/prephome"; PREP_STORE="$WORK/prepstore"
calls() { if [[ -f "$CALLS/$1.log" ]]; then grep -c -- "$2" "$CALLS/$1.log" || true; else echo 0; fi; }
servers_started() { ls "$WORK"/runs/*/server.pid "$WORK/tensorfold.argv" 2>/dev/null | grep -c . || true; }
# a Mac with nothing prepared: no TensorFold, no checkpoint
unprepared() { rm -rf "$PREP_HOME" "$PREP_STORE" "$CALLS"/* "$WORK/runs" "$WORK/tensorfold.argv"; mkdir -p "$PREP_HOME"; }
prep() { # env... -- [driver args]: the driver where install and download are the stand-ins
  drive PATH="$STUB_PATH" HOME="$PREP_HOME" TENSORFOLD_BIN= TENSORFOLD_MODEL_STORE="$PREP_STORE" "$@"
}
BUSY_AGENT="4242 python3 drive.py --pack benchmarks/vidi"

echo "busy, no option: it prepares, then the checks wait for the machine"
unprepared
prep PGREP_OUT="$BUSY_AGENT" /bin/bash "$DRIVER"
assert_eq "a running agent (drive.py) -> exit 3" 3 "$?"
assert_ok "...saying the checks are waiting for the machine" grep -q 'checks themselves are waiting for the machine' "$WORK/out"
assert_ok "...naming what it is busy with" grep -q 'drive.py' "$WORK/out"
assert_eq "TensorFold was installed at the pinned commit meanwhile" 1 "$(calls uv "^uv pip install .*@$PIN_COMMIT\$")"
assert_eq "...in a venv of the pinned Python" 1 "$(calls uv "^uv venv --python $PIN_PYTHON ")"
assert_eq "the checkpoint was downloaded at the pinned revision" 1 "$(calls hf "^hf download $REPO_ID --revision $REV ")"
assert_ok "...and verified" test -f "$PREP_STORE/$REPO_ID/.awesome-local-ai-verified"
assert_eq "pi's requests were rendered" 1 "$(calls node 'capture_pi_requests.mjs')"
assert_eq "no server was started" 0 "$(servers_started)"

echo
echo "busy, --prepare-only: the same work, and that is all it was asked for"
unprepared
prep PGREP_OUT="$BUSY_AGENT" /bin/bash "$DRIVER" --prepare-only
assert_eq "exit 0" 0 "$?"
assert_eq "TensorFold was installed" 1 "$(calls uv '^uv pip install ')"
assert_eq "the checkpoint was downloaded" 1 "$(calls hf '^hf download ')"
assert_eq "pi's requests were rendered" 1 "$(calls node 'capture_pi_requests.mjs')"
assert_eq "no server was started" 0 "$(servers_started)"
assert_ok "it says the checks are still to run" grep -q 'Prepared' "$WORK/out"
assert_fails "...without calling the machine busy" grep -q 'drive.py' "$WORK/out"
prep PGREP_OUT="$BUSY_AGENT" /bin/bash "$DRIVER" --prepare-only
assert_eq "again, everything already there: exit 0" 0 "$?"
assert_eq "...nothing installed a second time" 1 "$(calls uv '^uv pip install ')"
assert_eq "...nothing downloaded a second time" 1 "$(calls hf '^hf download ')"
assert_eq "...still no server" 0 "$(servers_started)"

echo
echo "idle, --prepare-only: it stops before the server"
unprepared
prep /bin/bash "$DRIVER" --prepare-only
assert_eq "exit 0" 0 "$?"
assert_eq "TensorFold was installed" 1 "$(calls uv '^uv pip install ')"
assert_eq "the checkpoint was downloaded" 1 "$(calls hf '^hf download ')"
assert_eq "no server was started" 0 "$(servers_started)"

echo
echo "a download that fails"
unprepared; touch "$CALLS/hf-fails"
prep /bin/bash "$DRIVER"
assert_eq "idle, no option -> exit 2 (could not run the checks)" 2 "$?"
assert_eq "...the download was tried" 1 "$(calls hf '^hf download ')"
assert_ok "...and it says the weights could not be fetched" grep -q 'could not install TensorFold or fetch the weights' "$WORK/out"
assert_eq "...and no server was started" 0 "$(servers_started)"
prep PGREP_OUT="$BUSY_AGENT" /bin/bash "$DRIVER"
assert_eq "busy, no option -> exit 2, not 3: there is nothing to wait for yet" 2 "$?"
prep PGREP_OUT="$BUSY_AGENT" /bin/bash "$DRIVER" --prepare-only
assert_eq "--prepare-only -> exit 2" 2 "$?"
assert_eq "...and no server was started" 0 "$(servers_started)"

echo
echo "one prepare at a time: a lock, held only while preparing"
LOCK="$WORK/runs/.prepare.lock"
# starts a prepare whose download stays in progress until hf-holds is removed; its exit code lands in first.rc
start_held_prepare() {
  unprepared; touch "$CALLS/hf-holds"
  ( DRIVE_OUT="$WORK/first.out" prep /bin/bash "$DRIVER" --prepare-only; echo $? > "$WORK/first.rc" ) &
  FIRST_JOB=$!
  local tries=0
  until [[ "$(calls hf '^hf download ')" == 1 ]] || (( tries++ >= HOLD_START_TRIES )); do sleep "$HOLD_POLL_S"; done
}
start_held_prepare
assert_ok "while the first is downloading, the lock names a running process" bash -c "kill -0 \$(cat '$LOCK')"
HOLDER="$(cat "$LOCK" 2>/dev/null)"
prep /bin/bash "$DRIVER" --prepare-only
assert_eq "a second --prepare-only meanwhile -> exit 2" 2 "$?"
assert_ok "...naming the first one's PID" grep -q "pid ${HOLDER:-unknown})" "$WORK/out"
prep /bin/bash "$DRIVER"
assert_eq "a second run with no option meanwhile -> exit 2" 2 "$?"
assert_eq "...and neither started a second download" 1 "$(calls hf '^hf download ')"
assert_eq "...nor a server" 0 "$(servers_started)"
assert_eq "the first one still holds the lock" "$HOLDER" "$(cat "$LOCK" 2>/dev/null)"
rm "$CALLS/hf-holds"; wait "$FIRST_JOB"
assert_eq "the first one finishes -> exit 0" 0 "$(cat "$WORK/first.rc")"
assert_fails "...and lets the lock go" test -e "$LOCK"

start_held_prepare
HOLDER="$(cat "$LOCK" 2>/dev/null)"
[[ -n "$HOLDER" ]] && kill -TERM "$HOLDER"
rm "$CALLS/hf-holds"; wait "$FIRST_JOB"
assert_eq "a prepare that is interrupted -> exit 130" 130 "$(cat "$WORK/first.rc")"
assert_fails "...lets the lock go" test -e "$LOCK"

unprepared; mkdir -p "$WORK/runs"
true & GONE=$!; wait "$GONE"
echo "$GONE" > "$LOCK"
prep /bin/bash "$DRIVER" --prepare-only
assert_eq "a lock left by a process that is no longer running is taken over -> exit 0" 0 "$?"
assert_eq "...and the work is done" 1 "$(calls hf '^hf download ')"
assert_fails "...and the lock is gone afterwards" test -e "$LOCK"

unprepared; touch "$CALLS/hf-fails"
prep /bin/bash "$DRIVER" --prepare-only
assert_eq "a prepare that fails -> exit 2" 2 "$?"
assert_fails "...lets the lock go" test -e "$LOCK"
rm "$CALLS/hf-fails"
prep PGREP_OUT="$BUSY_AGENT" /bin/bash "$DRIVER"
assert_eq "the next one is not held up by it; busy, so the checks wait -> exit 3" 3 "$?"
assert_fails "...and nothing holds the lock while the checks wait" test -e "$LOCK"

echo
echo "not enough disk for the checkpoint"
unprepared; echo 1 > "$CALLS/df-free-kb"
prep PGREP_OUT="$BUSY_AGENT" /bin/bash "$DRIVER" --prepare-only
assert_eq "-> exit 2" 2 "$?"
assert_ok "...for the disk reason" grep -q 'Not enough disk' "$WORK/out"
assert_eq "...before any download" 0 "$(calls hf '^hf download ')"
unprepared

echo
echo "what counts as busy (everything already prepared)"
ready() { drive PATH="$WORK/pistub:$WORK/bin:/usr/bin:/bin:/usr/sbin" "$@"; }
ready /bin/bash "$DRIVER" --help
assert_ok "--help describes --prepare-only" grep -q -- '--prepare-only' "$WORK/out"
ready PGREP_OUT="$BUSY_AGENT" /bin/bash "$DRIVER"
assert_eq "a running agent (drive.py) -> the checks wait, exit 3" 3 "$?"
assert_ok "...naming it" grep -q 'drive.py' "$WORK/out"
assert_eq "...no server was started" 0 "$(servers_started)"

echo '{"id":"canvas-mlx-07","state":{"status":"running","pid":1,"pgid":1,"attempt":1,"started_at":0}}' > "$WORK/dbench/jobs/canvas-mlx-07.json"
ready /bin/bash "$DRIVER"
assert_eq "a running dbench job -> the checks wait" 3 "$?"
assert_ok "...naming the job" grep -q 'canvas-mlx-07' "$WORK/out"
rm "$WORK/dbench/jobs/canvas-mlx-07.json"

echo '{"id":"canvas-mlx-08","state":{"status":"queued"}}' > "$WORK/dbench/jobs/canvas-mlx-08.json"
ready /bin/bash "$DRIVER"
assert_eq "a queued dbench job on a node that is not held -> the checks wait (it would start mid-check)" 3 "$?"
assert_ok "...saying to hold the node" grep -q 'hold' "$WORK/out"
echo '{"reason":"tensorfold checks","by":"x","at":0}' > "$WORK/dbench/hold.json"
ready TENSORFOLD_BIN="$WORK/bin/tensorfold-dies" /bin/bash "$DRIVER" --port "$(free_port)"
rc=$?
assert_ok "...but not once the node is held (it goes on, here to a server that dies)" test "$rc" -ne 3
assert_fails "...and does not mention the queued job" grep -q 'canvas-mlx-08' "$WORK/out"
rm -rf "$WORK/runs"
rm "$WORK/dbench/jobs/canvas-mlx-08.json" "$WORK/dbench/hold.json"
echo '{"id":"old","state":{"status":"done","exit_code":0}}' > "$WORK/dbench/jobs/old.json"

ready PS_OUT="  555 /x/mlx-serve --model m --serve --port 18010" /bin/bash "$DRIVER"
assert_eq "a model server already running -> the checks wait" 3 "$?"
assert_ok "...naming it" grep -q 'mlx-serve' "$WORK/out"
assert_eq "still no server started" 0 "$(servers_started)"
rm -rf "$WORK/runs"

if ! command -v pi >/dev/null || ! command -v node >/dev/null; then
  echo "  skip end-to-end runs: pi and node are needed to capture pi's requests"
  finish; exit
fi

echo
echo "busy, --prepare-only, with the real pi: the requests are rendered beside a benchmark"
drive PGREP_OUT="$BUSY_AGENT" /bin/bash "$DRIVER" --prepare-only
assert_eq "exit 0" 0 "$?"
RUN="$WORK/runs/$(ls "$WORK/runs" | head -1)"
assert_ok "pi's requests are in the run folder" test -s "$RUN/bodies/index.json"
assert_eq "no server was started" 0 "$(servers_started)"
SECONDS=0
drive PGREP_OUT="$BUSY_AGENT" /bin/bash "$DRIVER" --prepare-only
echo "  (prepare with everything already there: ${SECONDS}s)"
rm -rf "$WORK/runs"

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
assert_ok "...with the combination's memory budget" grep -qx 'TENSORFOLD_MEMORY_LIMIT_GB=89.6' "$WORK/tensorfold.env"
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

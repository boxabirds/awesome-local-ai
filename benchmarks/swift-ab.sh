#!/usr/bin/env bash
# benchmarks/swift-ab.sh -- A/B: Swift-Qwen3.8-27B vs the installed baseline.
#
#   Swift     ukisai/Swift-Qwen3.8-27B-GGUF : Q4_K_M   (MTP layers built in)
#   baseline  whatever this machine has installed (defaults to qwen38-27b)
#
# It measures the one axis Swift is designed to move -- reasoning-token VOLUME
# and the wall time that follows from it -- NOT raw tok/s, which is not
# comparable once the serving stack changes. Both models are driven through the
# SAME llama-server binary with the SAME ctx / KV / ub / np / sampling; only
# the weights and the MTP wiring differ (baseline: separate -md sidecar;
# Swift: built-in, no -md). That last difference is itself under test.
#
# The prompts, the greedy decoding and the per-request reasoning_effort sweep
# are copied from effort.sh, so the baseline column should land close to the
# committed numbers in combinations/qwen/.../benchmarks/reasoning-effort.txt
# (low 4026c / medium 5039c / xhigh 14004c over 5 prompts). If it does not,
# the hardware or build changed and both columns should be read relatively.
#
# ---------------------------------------------------------------------------
# WARNING -- read this before running.
#   * Loads a ~17 GB model onto the GPU, twice (Swift, then baseline).
#   * The card must be free. It REFUSES to start if there is not enough free
#     VRAM, rather than OOM mid-run. If a coding agent (pi / opencode) is
#     running on the installed server, running this INTERRUPTS it -- that is
#     your call, made at your terminal, not the agent's.
#   * It only ever manages llama-server processes it starts itself, on its own
#     bench port (default 18099). It never touches the port-8080 server and
#     never kills a process it did not start.
#   * After it finishes the GPU is free again; if you stopped your normal
#     server to make room, restart it (the script tells you how).
#
# USAGE
#   ./swift-ab.sh                 both models, asks before the download+load
#   ./swift-ab.sh --yes           skip the confirmation
#   ./swift-ab.sh --only swift    Swift only (baseline read from its TSV/committed)
#   ./swift-ab.sh --ctx 65536     bigger window (default 32768 is plenty here)
#   ./swift-ab.sh -v, --verbose   copious debug in the log (cmds, per-request, log tails)
#   ./swift-ab.sh --force         try even if the GPU looks busy (likely OOM)
#   ./swift-ab.sh --skip-download # Swift files already in $SWIFT_DIR
#
#   SWIFT_DIR=...  where the Swift GGUFs live (default ~/.local/share/swift-qwen38-27b/models)
#   EFFORTS="low medium xhigh"   the reasoning-effort levels to sweep
#   OUT=...           where logs + result TSVs land (default ./results)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"          # gives $ROOT, $MODEL, $MTP, $MMPROJ, $OUT
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
LOGS_DIR="${LOGS_DIR:-$REPO_ROOT/logs}"   # logs live here, not in $HOME
mkdir -p "$LOGS_DIR"

# ---- tunables -------------------------------------------------------------
HF_REPO="ukisai/Swift-Qwen3.8-27B-GGUF"
SWIFT_FILE="Swift-Qwen3.8-27B-Q4_K_M.gguf"
SWIFT_SHA="ad5811e291431bd0de1cec0c4004a5eac98daee9850882edac69a823209e88ab"
MMPROJ_FILE="mmproj-Swift-Qwen3.8-27B-F16.gguf"
MMPROJ_SHA="daa1116c9422fa390cc8688495da0e91781f92841dfc3b31a378ff252571745a"

LLAMA_SERVER="$ROOT/llama.cpp/build/bin/llama-server"
SWIFT_DIR="${SWIFT_DIR:-$HOME/.local/share/swift-qwen38-27b/models}"

CTX="${CTX:-32768}"              # deliberation bench needs no long window; keep it safe + fast
KV="${KV:-q4_0}"
UB="${UB:-256}"
NP="${NP:-1}"
PORT="${PORT:-18099}"            # bench port, never 8080
SPEC_N_SWIFT="${SPEC_N_SWIFT:-3}"  # Swift card's recommendation
SPEC_N_BASE="${SPEC_N_BASE:-2}"    # the baseline's current install config
EFFORTS="${EFFORTS:-low medium xhigh}"
NEED_FREE_MIB="${NEED_FREE_MIB:-19000}"   # ~17GB weights + 32k q4_0 KV + draft KV + slack

# committed baseline, for a sanity column (combinations/qwen/.../reasoning-effort.txt)
COMMITTED_BASE='low 4026 2632
medium 5039 3579
xhigh 14004 5230'

die() { echo "swift-ab: $*" >&2; exit 2; }

# verbose logging helpers. stdout IS the log when run under swift-start.sh, so a
# plain gated echo lands in the right place; vlines prefixes piped lines the same way.
v()      { (( VERBOSE )) && printf '    · %s\n' "$*"; }
vlines() { (( VERBOSE )) && sed 's/^/    · /'; }

# ---- args -----------------------------------------------------------------
ASSUME_YES=0; FORCE=0; SKIP_DL=0; ONLY="both"; VERBOSE="${VERBOSE:-0}"
while (( $# )); do
  case "$1" in
    --yes|-y) ASSUME_YES=1; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    --force)  FORCE=1; shift ;;
    --skip-download) SKIP_DL=1; shift ;;
    --only)   [[ $# -ge 2 ]] || die "--only needs baseline|swift|both"; ONLY="$2"; shift 2 ;;
    --ctx)    [[ $# -ge 2 ]] || die "--ctx needs a number"; CTX="$2"; shift 2 ;;
    --port)   [[ $# -ge 2 ]] || die "--port needs a number"; PORT="$2"; shift 2 ;;
    --help|-h) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

# ---- preflight ------------------------------------------------------------
[[ -x "$LLAMA_SERVER" ]] || die "llama-server not found at $LLAMA_SERVER"
command -v hf >/dev/null 2>&1 || die "the 'hf' CLI is needed for the download (pip install -U 'huggingface_hub[cli]')"
if [[ "$ONLY" != "swift" ]]; then
  [[ -f "$MODEL" ]] || die "baseline model missing: $MODEL"
  [[ -f "$MTP"  ]] || die "baseline MTP sidecar missing: $MTP"
fi

free_mib() { nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' '; }

echo "swift-ab: A/B on $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
echo "  baseline  $MODEL"
echo "            MTP sidecar $MTP  (spec draft-n-max $SPEC_N_BASE)"
echo "  swift     $HF_REPO : Q4_K_M  (built-in MTP, spec draft-n-max $SPEC_N_SWIFT)"
echo "  window    ctx=$CTX kv=$KV ub=$UB np=$NP  efforts: $EFFORTS"
echo "  bench on  127.0.0.1:$PORT   (the :8080 server is left alone)"
echo

# ---- GPU must be free -----------------------------------------------------
FREE="$(free_mib)"; FREE="${FREE:-0}"
if (( FREE < NEED_FREE_MIB )) && (( ! FORCE )); then
  echo "GPU is not free: ${FREE} MiB available, ~${NEED_FREE_MIB} MiB needed for a 27B load." >&2
  echo >&2
  echo "Free it, then re-run. For example:" >&2
  echo "    qwen38-27b-opencode --stop            # or: systemctl --user stop qwen38-27b" >&2
  echo >&2
  echo "If a coding agent is running on that server, stopping it interrupts the agent --" >&2
  echo "that is the point of doing this from your own terminal. Pass --force to try anyway" >&2
  echo "(it will almost certainly OOM)." >&2
  exit 1
fi
echo "GPU: ${FREE} MiB free -- enough to proceed."
echo

# ---- confirm --------------------------------------------------------------
if (( ! ASSUME_YES )) && [[ -t 0 ]]; then
  read -r -p "Download ${SWIFT_FILE} (~17 GB) if missing, then load two 27B models in turn? [Y/n] " reply
  case "${reply:-y}" in [Nn]*) echo "Aborted."; exit 0 ;; esac
fi

CUR_PID=""
cleanup() { [[ -n "$CUR_PID" ]] && kill "$CUR_PID" 2>/dev/null; wait "$CUR_PID" 2>/dev/null; }
trap cleanup EXIT INT TERM

# ---- download Swift (idempotent, sha256-verified) -------------------------
swift_gguf="$SWIFT_DIR/$SWIFT_FILE"
if [[ "$ONLY" == "both" || "$ONLY" == "swift" ]]; then
  if (( SKIP_DL )); then
    [[ -f "$swift_gguf" ]] || die "--skip-download set but $swift_gguf is not there"
  else
    if [[ ! -f "$swift_gguf" || ! -f "$SWIFT_DIR/$MMPROJ_FILE" ]]; then
      echo "Downloading Swift Q4_K_M + mmproj from $HF_REPO ..."
      mkdir -p "$SWIFT_DIR"
      hf download "$HF_REPO" "$SWIFT_FILE" "$MMPROJ_FILE" --local-dir "$SWIFT_DIR" \
        || die "download failed"
    fi
    echo "Verifying sha256 ..."
    ( cd "$SWIFT_DIR" && \
      echo "$SWIFT_SHA  $SWIFT_FILE"      | sha256sum --check - && \
      echo "$MMPROJ_SHA $MMPROJ_FILE"     | sha256sum --check - ) \
      || die "sha256 mismatch -- do not run an unverified model"
  fi
  echo
fi

# ---- verbose: everything is ready, dump the environment ------------------
v "==== ready ===="
v "server : $LLAMA_SERVER"
v "  ver  : $( "$LLAMA_SERVER" --version 2>&1 | head -2 | tr '\n' ' ' )"
v "gpu    : $(nvidia-smi --query-gpu=name,driver_version,memory.free --format=csv,noheader 2>/dev/null | tr '\n' ' ')"
v "cfg    : ctx=$CTX kv=$KV np=$NP ub=$UB port=$PORT efforts=[$EFFORTS]"
v "base   : $(ls -lh "$MODEL" 2>/dev/null | awk '{print $5"  "$9}')   mtp=$(ls -lh "$MTP" 2>/dev/null | awk '{print $5}')"
v "swift  : $(ls -lh "$swift_gguf" 2>/dev/null | awk '{print $5"  "$9}')   mmproj=$(ls -lh "$SWIFT_DIR/$MMPROJ_FILE" 2>/dev/null | awk '{print $5}')"

# ---- one server, one effort sweep ----------------------------------------
# bench <name> <llama-server model args...>
# writes $OUT/<name>.tsv  with:  effort  reasoning_chars  completion_tokens  wall_s
bench() {
  local name="$1"; shift
  local server_log="$LOGS_DIR/swift-ab-$name.log"
  v "==== launch $name ===="
  v "cmd: $LLAMA_SERVER -ngl 99 -c $CTX -fa on --jinja --cache-type-k $KV --cache-type-v $KV -np $NP -ub $UB -b 1024 --host 127.0.0.1 --port $PORT --temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0 $*"
  "$LLAMA_SERVER" \
    -ngl 99 -c "$CTX" -fa on --jinja \
    --cache-type-k "$KV" --cache-type-v "$KV" \
    -np "$NP" -ub "$UB" -b 1024 \
    --host 127.0.0.1 --port "$PORT" \
    --temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0 \
    "$@" > "$server_log" 2>&1 &
  CUR_PID=$!
  local up=0 tries=0
  for tries in $(seq 1 300); do
    kill -0 "$CUR_PID" 2>/dev/null || break
    curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { up=1; break; }
    sleep 1
  done
  v "health: up=$up after $tries tries (pid $CUR_PID)"
  if (( ! up )); then
    echo "  $name: server did not come up; tail of $server_log:" >&2
    tail -15 "$server_log" >&2
    kill "$CUR_PID" 2>/dev/null; wait "$CUR_PID" 2>/dev/null; CUR_PID=""
    return 1
  fi
  v "startup-log highlights (spec/context/KV/VRAM):"
  grep -inE 'spec|draft|acceptance|context|kv size|offloaded|vram|model size|total|loaded|n_ctx' "$server_log" | head -40 | vlines
  # draft acceptance, to confirm speculative decoding is actually live
  python3 - "$PORT" "$name" "$OUT/$name.tsv" "$EFFORTS" "$VERBOSE" <<'PY'
import json, sys, time, urllib.request
port, name, tsv, efforts = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split()
verbose = sys.argv[5] == "1"
PROMPTS = [
  "Write a Python function that merges two sorted lists.",
  "Explain the difference between a process and a thread, briefly.",
  "Write a bash one-liner that finds the 5 largest files under a directory.",
  "What does the -ub flag control in llama.cpp?",
  "Refactor this to remove the nested loop: for i in a:\n  for j in b:\n    if i==j: out.append(i)",
]
# greedy on purpose (see effort.sh): at temp 1.0 a handful of prompts cannot
# separate the effort levels from sampling noise.
def ask(prompt, effort):
    body = {"messages":[{"role":"user","content":prompt}], "max_tokens":2000,
            "temperature":0, "top_k":1, "top_p":1.0, "reasoning_effort":effort}
    t0 = time.time()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions",
            data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=240)); dt = time.time()-t0
    m = d["choices"][0]["message"]; u = d.get("usage", {})
    if verbose:
        print(f"    · [{name} {effort}] in={u.get('prompt_tokens')}tok  "
              f"reasoning={len(m.get('reasoning_content') or '')}c  "
              f"completion={u.get('completion_tokens')}tok  wall={dt:.2f}s")
    return len(m.get("reasoning_content") or ""), d["usage"]["completion_tokens"], dt

with open(tsv, "w") as f:
    f.write("effort\treasoning_chars\tcompletion_tokens\twall_s\n")
    if verbose:
        print(f"    · [{name}] {len(PROMPTS)} prompts, efforts: {efforts}")
        for i, p in enumerate(PROMPTS):
            print(f"        p{i}: {p.splitlines()[0][:64]}")
    for e in efforts:
        rc = ct = 0; wall = 0.0
        for p in PROMPTS:
            a, b, c = ask(p, e); rc += a; ct += b; wall += c
        n = len(PROMPTS)
        print(f"  {name:9} {e:7} reasoning={rc/n:6.0f}c  completion={ct/n:6.0f}tok  wall={wall/n:5.2f}s")
        f.write(f"{e}\t{int(rc)}\t{int(ct)}\t{wall:.2f}\n")
PY
  local rc=$?
  # Confirm speculative decoding is actually live, or the wall-time column is
  # not a fair test: a silent no-spec run makes Swift look *slower* when it is
  # really just decoding autoregressively.
  if grep -qi "draft acceptance" "$server_log"; then
    echo "  $name: speculative decoding LIVE ($(grep -oiE 'draft acceptance = [0-9.]+' "$server_log" | tail -1))"
    grep -inE 'draft acceptance|speculative' "$server_log" | vlines
  else
    echo "  $name: WARNING: no 'draft acceptance' in log -- spec decoding may be OFF; check $server_log"
    tail -20 "$server_log" | vlines
  fi
  v "last 25 lines of $server_log:"
  tail -25 "$server_log" | vlines
  kill "$CUR_PID" 2>/dev/null; wait "$CUR_PID" 2>/dev/null; CUR_PID=""
  sleep 4
  return $rc
}

run_base=0; run_swift=0
[[ "$ONLY" == "both" || "$ONLY" == "baseline" ]] && run_base=1
[[ "$ONLY" == "both" || "$ONLY" == "swift"    ]] && run_swift=1

echo "=== baseline (installed $MODEL) ==="
if (( run_base )); then
  bench base \
    -m "$MODEL" -a base \
    -md "$MTP" --spec-type draft-mtp --spec-draft-n-max "$SPEC_N_BASE" --spec-draft-ngl 99 \
      --spec-draft-type-k "$KV" --spec-draft-type-v "$KV" \
  || echo "  (baseline bench failed; continuing)"
  echo
fi

echo "=== swift ($HF_REPO : Q4_K_M) ==="
if (( run_swift )); then
  bench swift \
    -m "$swift_gguf" -a swift \
    --spec-type draft-mtp --spec-draft-n-max "$SPEC_N_SWIFT" \
  || echo "  (swift bench failed; continuing)"
  echo
fi

# ---- side-by-side ---------------------------------------------------------
echo "=== comparison (averaged per prompt; lower reasoning = less deliberation) ==="
python3 - "$OUT/base.tsv" "$OUT/swift.tsv" "$COMMITTED_BASE" <<'PY'
import sys
base_f, swift_f, committed = sys.argv[1], sys.argv[2], sys.argv[3].strip()
def load(p):
    d = {}
    try:
        for line in open(p):
            parts = line.rstrip("\n").split("\t")
            if len(parts) != 4 or parts[0] == "effort":   # header row
                continue
            e, rc, ct, wall = parts
            d[e] = (int(rc), int(ct), float(wall))
    except FileNotFoundError:
        pass
    return d
base, swift = load(base_f), load(swift_f)
comm = {}
for line in committed.splitlines():
    e, rc, ct = line.split(); comm[e] = (int(rc), int(ct))

_order = ["low", "medium", "xhigh"]
efforts = sorted(set(base) | set(swift), key=lambda e: _order.index(e) if e in _order else 99)
hdr = f"{'effort':8} {'base rch':>9} {'swift rch':>10} {'Δreason':>9} {'base tok':>9} {'swift tok':>10} {'base s':>7} {'swift s':>8} {'×fast':>6}"
print(hdr); print("-"*len(hdr))
for e in efforts:
    if e in base and e in swift:
        brc, bct, bw = base[e]; src, sct, sw = swift[e]
        red = (1 - src/brc)*100 if brc else 0
        spd = bw/sw if sw else 0
        print(f"{e:8} {brc:9d} {src:10d} {red:+8.1f}% {bct:9d} {sct:10d} {bw:7.2f} {sw:8.2f} {spd:5.2f}x")
    elif e in swift:
        src, sct, sw = swift[e]
        crc = comm.get(e, (0,0))[0]
        red = (1 - src/crc)*100 if crc else 0
        print(f"{e:8} {'(committed %dc)'%crc:9} {src:10d} {red:+8.1f}%* {'':9} {sct:10d} {'':7} {sw:8.2f} {'':6}")
print()
print("  Δreason = % fewer reasoning chars vs baseline (the deliberation cut)")
print("  ×fast   = baseline wall / swift wall at the same effort (higher = faster end-to-end)")
print("  *        baseline column is the committed reference, not this run")
PY

echo
echo "Server logs: $LOGS_DIR/swift-ab-{base,swift}.log"
echo "Data (TSV):  $OUT/{base,swift}.tsv"
echo "This log:    $LOGS_DIR/swift-ab.log"
echo
echo "GPU is free again. If you stopped your normal server to make room, restore it with:"
echo "    bash $REPO_ROOT/swift-stop.sh          # or: qwen38-27b-opencode"

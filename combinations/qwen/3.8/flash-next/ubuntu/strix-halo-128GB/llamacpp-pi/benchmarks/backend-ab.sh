#!/usr/bin/env bash
# backend-ab.sh -- Vulkan vs ROCm on the same two-backend build: the same prompts at temperature 0,
# the backend switched with GPU_BACKEND, so the only difference between the arms is the backend.
#
#   benchmarks/backend-ab.sh [--backends "vulkan rocm"] [--runs N] [--tokens N] [--port P]
#
# Each round loads the server once per backend and sends every prompt; rounds alternate the order
# (vulkan,rocm then rocm,vulkan) so warm-up and drift do not favour one arm. Needs the GPU to itself.
#
# Writes backend-ab/<timestamp>-<host>.tsv next to this script: a header recording the machine
# (kernel, llama.cpp commit, GPU clock level, power mode) and one row per run/backend/prompt.
# The power mode cannot be read from Linux: pass it, e.g. POWER_MODE=performance.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"

INSTALL_ID="qwen38-flash-next-strix"
SERVER_CMD="${INSTALL_ID}-server"
INSTALL_ROOT="$HOME/.local/share/$INSTALL_ID"
BACKENDS="vulkan rocm"
RUNS=3
TOKENS=300
PORT=18190
LOAD_TIMEOUT_S=900
REQUEST_TIMEOUT_S=600
POLL_S=2
STOP_GRACE_S=5
PREVIEW_CHARS=80
GPU_SYSFS="$(grep -l 0x1586 /sys/bus/pci/devices/*/device 2>/dev/null | head -1 | xargs -r dirname)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backends) BACKENDS="$2"; shift 2 ;;
    --runs)     RUNS="$2"; shift 2 ;;
    --tokens)   TOKENS="$2"; shift 2 ;;
    --port)     PORT="$2"; shift 2 ;;
    -h|--help)  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null || { echo "needs jq (sudo apt install jq)" >&2; exit 1; }
command -v "$SERVER_CMD" >/dev/null || { echo "no $SERVER_CMD on PATH: install the combination first" >&2; exit 1; }
if pgrep -f "$INSTALL_ROOT/llama.cpp/build/bin/llama-server" >/dev/null; then
  echo "a $INSTALL_ID server is already running; stop it first (the arms need the GPU to themselves)" >&2
  exit 1
fi

# ---- the prompts: one each of new code, a rewrite (output mostly in the input) and prose ----------
declare -A PROMPTS
PROMPTS[code]='Write a Python function that parses an ISO-8601 duration string like "P3DT4H12M" into total seconds, with input validation and docstring.'
PROMPTS[rewrite]='Rewrite this JavaScript to use async/await instead of promise chains, keeping behaviour identical:

function load(id) {
  return fetch("/api/items/" + id)
    .then(r => { if (!r.ok) throw new Error("bad " + r.status); return r.json(); })
    .then(item => fetch("/api/owners/" + item.ownerId))
    .then(r => r.json())
    .then(owner => ({ id, owner: owner.name }))
    .catch(e => { console.error(e); return null; });
}'
PROMPTS[prose]='Explain to a curious teenager why the sky is blue and sunsets are red, in a few friendly paragraphs.'
PROMPT_ORDER="code rewrite prose"

# ---- output ------------------------------------------------------------------------------------------
mkdir -p "$HERE/backend-ab"
OUT="$HERE/backend-ab/$(date +%Y%m%d-%H%M%S)-$(hostname -s).tsv"
{
  echo "# backend-ab $(date -Is) on $(hostname -s)"
  echo "# kernel $(uname -r); llama.cpp $(git -C "$INSTALL_ROOT/llama.cpp" rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "# gpu clock level: $(cat "$GPU_SYSFS/power_dpm_force_performance_level" 2>/dev/null || echo '?'); power mode: ${POWER_MODE:-not recorded (set POWER_MODE)}"
  echo "# build backends: $(sed -n 's/^GPU_BACKENDS="\(.*\)"/\1/p' "$INSTALL_ROOT/install.env")"
  echo "# runs $RUNS, max tokens $TOKENS, temperature 0, prompt cache off, thinking off"
  printf 'run\tbackend\tprompt\tdecode_tok_s\tprefill_tok_s\tdraft_accepted\tdraft_total\ttokens\toutput_sha\tload_s\tpreview\n'
} > "$OUT"

stop_server() { # pid
  kill -- "-$1" 2>/dev/null; sleep "$STOP_GRACE_S"
  pkill -f "$INSTALL_ROOT/llama.cpp/build/bin/llama-server.*--port $PORT" 2>/dev/null
  while pgrep -f "llama-server.*--port $PORT" >/dev/null; do sleep 1; done
}

run_backend() { # run backend
  local run="$1" backend="$2" log pid t0 load name body r
  log="/tmp/backend-ab-$backend.log"
  GPU_BACKEND="$backend" PORT="$PORT" setsid nohup "$SERVER_CMD" > "$log" 2>&1 < /dev/null &
  pid=$!
  t0=$(date +%s)
  until curl -sf -m "$POLL_S" "127.0.0.1:$PORT/v1/models" >/dev/null; do
    sleep "$POLL_S"
    if ! kill -0 "$pid" 2>/dev/null; then echo "$backend: server exited; see $log" >&2; tail -5 "$log" >&2; return 1; fi
    if (( $(date +%s) - t0 > LOAD_TIMEOUT_S )); then echo "$backend: no response in ${LOAD_TIMEOUT_S}s" >&2; stop_server "$pid"; return 1; fi
  done
  load=$(( $(date +%s) - t0 ))
  echo "run $run, $backend: loaded in ${load}s ($(grep -o 'GPU backend: [^)]*)' "$log"))"
  for name in $PROMPT_ORDER; do
    body=$(jq -n --arg c "${PROMPTS[$name]}" --argjson n "$TOKENS" \
      '{messages:[{role:"user",content:$c}], max_tokens:$n, temperature:0, cache_prompt:false,
        chat_template_kwargs:{enable_thinking:false}}')
    r=$(curl -s -m "$REQUEST_TIMEOUT_S" "127.0.0.1:$PORT/v1/chat/completions" -H 'Content-Type: application/json' -d "$body")
    jq -r --arg run "$run" --arg b "$backend" --arg p "$name" --arg load "$load" \
          --arg sha "$(jq -r '.choices[0].message.content' <<< "$r" | sha256sum | cut -c1-12)" --argjson pc "$PREVIEW_CHARS" \
      '[$run, $b, $p, (.timings.predicted_per_second*10|round/10), (.timings.prompt_per_second*10|round/10),
        (.timings.draft_n_accepted // 0), (.timings.draft_n // 0), .timings.predicted_n, $sha, $load,
        (.choices[0].message.content[0:$pc] | gsub("[\n\t]"; " "))] | @tsv' <<< "$r" | tee -a "$OUT" | cut -f2-8
  done
  stop_server "$pid"
}

for (( run = 1; run <= RUNS; run++ )); do
  order="$BACKENDS"
  (( run % 2 == 0 )) && order="$(tr ' ' '\n' <<< "$BACKENDS" | tac | tr '\n' ' ')"
  for backend in $order; do run_backend "$run" "$backend" || exit 1; done
done

echo
echo "mean decode tok/s by backend and prompt (output_sha equal across backends = identical text):"
awk -F'\t' '!/^#/ && NR > 1 && $1 ~ /^[0-9]+$/ { k = $2 "\t" $3; s[k] += $4; n[k]++; sha[k] = sha[k] " " $9 }
  END { for (k in s) printf "  %-8s %-8s %6.1f   sha:%s\n", substr(k, 1, index(k, "\t") - 1), substr(k, index(k, "\t") + 1), s[k] / n[k], sha[k] }' \
  "$OUT" | sort
echo "results: $OUT"

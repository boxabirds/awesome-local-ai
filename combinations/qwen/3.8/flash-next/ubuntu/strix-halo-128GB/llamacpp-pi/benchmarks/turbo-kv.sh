#!/usr/bin/env bash
# turbo-kv.sh -- does TurboQuant's compressed attention cache keep decode fast at long context,
# without hurting quality? Same weights, same MTP settings as the canvas run; only the build and
# the KV cache type change between arms.
#
#   benchmarks/turbo-kv.sh [--fills "32768 120000"] [--arms "base:f16 fork:f16 fork:turbo4"] [--no-kld]
#
# Arms are <build>:<kv type>. base = this install's llama.cpp (PR #28243 branch); fork = the
# TurboQuant fork (github.com/TheTom/llama-cpp-turboquant) built in $FORK_DIR, Vulkan only.
# For each arm and fill level: prefill and decode speed, MTP acceptance, GPU memory, and whether a
# tool call still comes back as valid JSON. Then, unless --no-kld, the KL divergence of the fork's
# turbo4 cache against its f16 cache (llama-perplexity), the quality measure the fork's docs ask for.
# Needs the GPU to itself. Writes turbo-kv/<timestamp>-<host>.tsv next to this script.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../../../../../../.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

INSTALL_ID="qwen38-flash-next-strix"
ROOT="$HOME/.local/share/$INSTALL_ID"
MODELS="$ROOT/models/Qwen3.8-Flash-Next-GGUF"
MODEL="$MODELS/UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf"
MTP="$MODELS/MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf"
BASE_BIN="$ROOT/llama.cpp/build/bin"
FORK_DIR="${FORK_DIR:-$HOME/turbo-exp/llama.cpp}"
FORK_BIN="$FORK_DIR/build/bin"
FILLS="32768 120000"
ARMS="base:f16 fork:f16 fork:turbo4"
KLD=1
PORT=18191
CTX=131072
DECODE_TOKENS=400
LOAD_TIMEOUT_S=900
REQUEST_TIMEOUT_S=3600
KLD_CTX=8192
KLD_CHUNKS=4
CHARS_PER_TOKEN_GUESS=3       # only for the first cut of filler text; /tokenize trims it exactly
GPU_SYSFS="$(grep -l 0x1586 /sys/bus/pci/devices/*/device 2>/dev/null | head -1 | xargs -r dirname)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fills) FILLS="$2"; shift 2 ;;
    --arms) ARMS="$2"; shift 2 ;;
    --no-kld) KLD=0; shift ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
command -v jq >/dev/null || { echo "needs jq" >&2; exit 1; }
[[ -x "$FORK_BIN/llama-server" ]] || { echo "no fork build at $FORK_BIN (see the header)" >&2; exit 1; }
if pgrep -f "llama-server" >/dev/null; then echo "a llama-server is running; the arms need the GPU to themselves" >&2; exit 1; fi

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"; [[ -n "${SPID:-}" ]] && kill -- "-$SPID" 2>/dev/null' EXIT
mkdir -p "$HERE/turbo-kv"
OUT="$HERE/turbo-kv/$(date +%Y%m%d-%H%M%S)-$(hostname -s).tsv"
{
  echo "# turbo-kv $(date -Is) on $(hostname -s); kernel $(uname -r)"
  echo "# base llama.cpp $(git -C "$ROOT/llama.cpp" rev-parse --short HEAD); fork $(git -C "$FORK_DIR" rev-parse --short HEAD)"
  echo "# gpu clock level: $(cat "$GPU_SYSFS/power_dpm_force_performance_level" 2>/dev/null); power mode: ${POWER_MODE:-not recorded}"
  echo "# MTP depth 4, p-min 0, temperature 0, prompt cache off, thinking off, $DECODE_TOKENS tokens decoded per request"
  printf 'arm\tfill_tokens\tprefill_tok_s\tdecode_tok_s\tdraft_accepted\tdraft_total\tgtt_used_mib\ttool_call_ok\toutput_sha\n'
} > "$OUT"

gtt_mib() { echo $(( $(cat "$GPU_SYSFS/mem_info_gtt_used" 2>/dev/null || echo 0) / 1048576 )); }

start_server() { # bin kv
  local bin="$1" kv="$2" dev=()
  # A two-backend build (base) sees the GPU twice: pin Vulkan, as the launcher does.
  [[ "$bin" == "$BASE_BIN" ]] && dev=(--device Vulkan0 --spec-draft-device Vulkan0)
  setsid nohup "$bin/llama-server" -m "$MODEL" -a flash-next -ngl 99 -c "$CTX" -fa on --jinja \
    --cache-type-k "$kv" --cache-type-v "$kv" -np 1 -ub 512 -b 2048 --host 127.0.0.1 --port "$PORT" \
    --temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0 --reasoning-effort low \
    -md "$MTP" --spec-type draft-mtp --spec-draft-n-max 4 --spec-draft-ngl 99 \
    --spec-draft-type-k f16 --spec-draft-type-v f16 --spec-draft-p-min 0.0 "${dev[@]}" \
    -lm dio --ctx-checkpoints 8 > "$WORK/server.log" 2>&1 < /dev/null &
  SPID=$!
  local t0; t0=$(date +%s)
  until curl -sf -m 2 "127.0.0.1:$PORT/v1/models" >/dev/null; do
    sleep 2
    kill -0 "$SPID" 2>/dev/null || { echo "server exited:"; tail -5 "$WORK/server.log"; return 1; }
    (( $(date +%s) - t0 > LOAD_TIMEOUT_S )) && { echo "no response in ${LOAD_TIMEOUT_S}s"; return 1; }
  done
}

stop_server() { kill -- "-$SPID" 2>/dev/null; while pgrep -f "llama-server.*--port $PORT" >/dev/null; do sleep 1; done; SPID=""; }

# Filler: this repo's own source, real code, trimmed to exactly N tokens by the running server.
make_filler() { # n -> $WORK/filler-<n>.txt
  local n="$1" f="$WORK/filler-$1.txt"
  [[ -s "$f" ]] && return
  (cd "$REPO_ROOT" && git ls-files -z -- 'lib/*.sh' 'benchmarks/spec-bench/harness/*.py' 'tools/dbench/src/*.rs' \
     | xargs -0 cat) | head -c $(( n * CHARS_PER_TOKEN_GUESS * 2 )) > "$WORK/raw.txt"
  jq -n --rawfile t "$WORK/raw.txt" '{content: $t}' | curl -s "127.0.0.1:$PORT/tokenize" -H 'Content-Type: application/json' -d @- \
    | jq -c --argjson n "$n" '{tokens: .tokens[:$n]}' \
    | curl -s "127.0.0.1:$PORT/detokenize" -H 'Content-Type: application/json' -d @- | jq -r .content > "$f"
}

ask() { # filler-file instruction [tools-json] -> response json
  local tools="${3:-null}"
  jq -n --rawfile ctx "$1" --arg q "$2" --argjson n "$DECODE_TOKENS" --argjson tools "$tools" '
    {messages: [{role: "user", content: ("Here is part of a codebase:\n\n" + $ctx + "\n\n" + $q)}],
     max_tokens: $n, temperature: 0, cache_prompt: false, chat_template_kwargs: {enable_thinking: false}}
    + (if $tools then {tools: $tools, tool_choice: "auto"} else {} end)' \
    | curl -s -m "$REQUEST_TIMEOUT_S" "127.0.0.1:$PORT/v1/chat/completions" -H 'Content-Type: application/json' -d @-
}

TOOLS='[{"type":"function","function":{"name":"write_file","description":"Write a file to disk",
  "parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}}]'
CODE_ASK="Write a new bash function, in the style of lib/common.sh above, that retries a command with exponential backoff. Code only."
TOOL_ASK="Save a file named hello.sh containing a bash script that prints hello. Use the write_file tool."

for arm in $ARMS; do
  build="${arm%%:*}"; kv="${arm#*:}"
  bin="$BASE_BIN"; [[ "$build" == fork ]] && bin="$FORK_BIN"
  echo "=== $arm: loading"
  start_server "$bin" "$kv" || { printf '%s\t-\t-\t-\t-\t-\t-\tLOAD FAILED\t-\n' "$arm" >> "$OUT"; stop_server; continue; }
  first=1
  for fill in $FILLS; do
    make_filler "$fill"
    r="$(ask "$WORK/filler-$fill.txt" "$CODE_ASK")"
    gtt="$(gtt_mib)"
    tool_ok="-"
    if [[ "$first" == 1 ]]; then   # once per arm, at the first fill level
      t="$(ask "$WORK/filler-$fill.txt" "$TOOL_ASK" "$TOOLS")"
      tool_ok="$(jq -r '.choices[0].message.tool_calls[0].function.arguments // empty' <<< "$t" \
                 | jq -e 'has("path") and has("content")' >/dev/null 2>&1 && echo yes || echo NO)"
      first=0
    fi
    jq -r --arg arm "$arm" --arg fill "$fill" --arg gtt "$gtt" --arg tool "$tool_ok" \
          --arg sha "$(jq -r '.choices[0].message.content // ""' <<< "$r" | sha256sum | cut -c1-12)" \
      '[$arm, .timings.prompt_n, (.timings.prompt_per_second*10|round/10), (.timings.predicted_per_second*10|round/10),
        (.timings.draft_n_accepted // 0), (.timings.draft_n // 0), $gtt, $tool, $sha] | @tsv' <<< "$r" | tee -a "$OUT"
  done
  stop_server
done

if [[ "$KLD" == 1 ]]; then
  echo "=== quality: KL divergence of the fork's turbo4 cache against its f16 cache"
  (cd "$REPO_ROOT" && git ls-files -z -- 'docs/*.md' | xargs -0 cat) > "$WORK/kld.txt"
  common=(-m "$MODEL" -f "$WORK/kld.txt" -c "$KLD_CTX" --chunks "$KLD_CHUNKS" -ngl 99 -fa on -lm dio)
  "$FORK_BIN/llama-perplexity" "${common[@]}" -ctk f16 -ctv f16 --kl-divergence-base "$WORK/base.kld" > "$WORK/kld-base.log" 2>&1
  "$FORK_BIN/llama-perplexity" "${common[@]}" -ctk turbo4 -ctv turbo4 --kl-divergence-base "$WORK/base.kld" --kl-divergence \
    > "$WORK/kld-turbo4.log" 2>&1
  { echo "# KL divergence, turbo4 vs f16 KV (fork build, ${KLD_CHUNKS} x ${KLD_CTX}-token chunks of this repo's docs):"
    grep -E "Mean +KLD|Same top p|Mean +PPL\(Q\)|Mean +PPL\(base\)" "$WORK/kld-turbo4.log" | sed 's/^/#   /'; } | tee -a "$OUT"
fi
echo "results: $OUT"

#!/usr/bin/env bash
# test-a.sh -- test A of the pre-registered gufo vs llama.cpp plan (docs/20260926-gufo-vs-llamacpp-eval-plan.md):
# throughput on the same UD-Q4_K_XL weights, one engine at a time, with the GPU to itself.
#
#   benchmarks/gufo-eval/test-a.sh [--engines "llamacpp gufo llamacpp-iq4xs"] [--fills 2048,32768,65536,120000] [--repeats 3]
#   benchmarks/gufo-eval/test-a.sh --dry-run    # each engine starts and answers one 2k request; minutes, not hours
#
# 1. Starts llama.cpp (the pinned MTP branch) and cuts the prompts to exact token counts with its
#    tokenizer: this repo's own source code, so both engines get byte-identical prompts.
# 2. For each engine: start its server (context 131072, one session, MTP on), run throughput.py
#    (engine-neutral, client-side timing), stop it. llamacpp and gufo run the same UD-Q4_K_XL weights
#    (the only quant gufo supports); llamacpp-iq4xs is the plan's reference, llama.cpp on UD-IQ4_XS,
#    the quant the benchmark runs use. Whatever server this script starts, it stops on every exit.
# Writes benchmarks/gufo-eval/results/<timestamp>-<host>/ : results.jsonl, the server logs, and
# versions.txt (image digest, llama.cpp commit, weights revision, every command line).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

ENGINES="llamacpp gufo llamacpp-iq4xs"
FILLS="2048,32768,65536,120000"
REPEATS=3
DECODE=400
DRY_FILLS="2048"
DRY_DECODE=16
CTX=131072
PORT=18291
: "${LOAD_TIMEOUT_S:=1200}"
: "${MODELS:=$HOME/gufo/models/qwen3.8-flash-next}"
MODEL_REL="UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf"
MTP_REL="MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf"
WEIGHTS_REV="38bb39ee97821de2c9009abb7e93950eec396e66"
: "${INSTALL:=$HOME/.local/share/qwen38-flash-next-strix}"
: "${LLAMA_BIN:=$INSTALL/llama.cpp/build/bin}"
# The benchmark runs' own weights (install.env MODEL_FILE), for the reference arm.
: "${IQ4_MODEL:=$INSTALL/models/Qwen3.8-Flash-Next-GGUF/UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf}"
: "${RESULTS:=$HERE/results}"
IMAGE="ghcr.io/gufo-org/toolboxes/gufo-runtime:latest"
CHARS_PER_TOKEN_GUESS=3   # only for the first cut of filler text; the tokenizer trims it exactly

while [[ $# -gt 0 ]]; do
  case "$1" in
    --engines) ENGINES="$2"; shift 2 ;;
    --fills) FILLS="$2"; shift 2 ;;
    --repeats) REPEATS="$2"; shift 2 ;;
    --dry-run) FILLS="$DRY_FILLS"; REPEATS=1; DECODE="$DRY_DECODE"; DRY=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

OUT="$RESULTS/$(date -u +%Y%m%d-%H%M%S)-$(hostname -s)${DRY:+-dry-run}"
mkdir -p "$OUT/prompts"
SPID=""

wait_up() {
  local t0; t0=$(date +%s)
  until curl -sf -m 2 "127.0.0.1:$PORT/v1/models" >/dev/null; do
    sleep 2
    if [[ -n "$SPID" ]] && ! kill -0 "$SPID" 2>/dev/null; then echo "server exited"; return 1; fi
    (( $(date +%s) - t0 > LOAD_TIMEOUT_S )) && { echo "no response in ${LOAD_TIMEOUT_S}s"; return 1; }
  done
  return 0  # the loop's own status is its body's last command (a false timeout check), not success
}

# llama.cpp on the given weights. --cache-ram 0: test A's prompts are all unique, so llama-server's
# host-RAM prompt cache (8 GB by default) only fills memory; on tritus it pushed swap to full.
start_llama_on() {
  local name="$1" model="$2"
  local cmd=("$LLAMA_BIN/llama-server" -m "$model" -lm dio -ngl 99 -c "$CTX" -fa on --jinja -np 1
    --host 127.0.0.1 --port "$PORT" --device Vulkan0 --spec-draft-device Vulkan0
    -md "$MODELS/$MTP_REL" --spec-type draft-mtp --spec-draft-n-max 4 --spec-draft-ngl 99
    --spec-draft-p-min 0.0 --ctx-checkpoints 8 --cache-ram 0)
  echo "$name: ${cmd[*]}" >> "$OUT/versions.txt"
  setsid nohup "${cmd[@]}" > "$OUT/server-$name.log" 2>&1 < /dev/null &
  SPID=$!
  wait_up
}
start_llamacpp() { start_llama_on llamacpp "$MODELS/$MODEL_REL"; }
start_llamacpp-iq4xs() { start_llama_on llamacpp-iq4xs "$IQ4_MODEL"; }

start_gufo() {
  local cmd=(podman run --rm --name gufo-test-a --userns=keep-id:uid=1000,gid=1000
    --device /dev/kfd --device /dev/dri --group-add keep-groups --ulimit memlock=-1
    -p "127.0.0.1:$PORT:8080" -v "$MODELS:/models:ro" "$IMAGE"
    gufo serve --host 0.0.0.0 --port 8080 llm --model "/models/$MODEL_REL"
    --speculative mtp --mtp-model "/models/$MTP_REL" --sessions 1 --context "$CTX")
  echo "gufo: ${cmd[*]}" >> "$OUT/versions.txt"
  setsid nohup "${cmd[@]}" > "$OUT/server-gufo.log" 2>&1 < /dev/null &
  SPID=$!
  wait_up
}

stop_server() {
  podman stop -t 10 gufo-test-a >/dev/null 2>&1
  [[ -n "$SPID" ]] && kill -- "-$SPID" 2>/dev/null
  # [l]lama: the pattern must not match this script's own command lines
  while pgrep -f "[l]lama-server.*--port $PORT" >/dev/null || podman ps -q --filter name=gufo-test-a 2>/dev/null | grep -q .; do sleep 1; done
  SPID=""
}
# 27 Sep: a failed start exited and left its llama-server running; the benchmark run resumed next to
# it and the kernel's OOM killer fired. Whatever happens, stop what this script started.
trap stop_server EXIT

make_prompts() { # needs llama.cpp running: /tokenize and /detokenize cut real code to exact lengths
  local raw="$OUT/prompts/raw.txt" n
  (cd "$REPO_ROOT" && git ls-files -z -- 'lib/*.sh' 'benchmarks/spec-bench/harness/*.py' 'tools/dbench/src/*.rs' \
     'tools/vidi-gallery/src/*.rs' | xargs -0 cat) > "$raw"
  for n in ${FILLS//,/ }; do
    head -c $(( n * CHARS_PER_TOKEN_GUESS * 2 )) "$raw" > "$OUT/prompts/cut.txt"
    jq -n --rawfile t "$OUT/prompts/cut.txt" '{content: $t}' \
      | curl -s "127.0.0.1:$PORT/tokenize" -H 'Content-Type: application/json' -d @- \
      | jq --argjson n "$n" '{tokens: .tokens[:$n]}' \
      | curl -s "127.0.0.1:$PORT/detokenize" -H 'Content-Type: application/json' -d @- \
      | jq -r .content > "$OUT/prompts/fill-$n.txt"
  done
  rm -f "$raw" "$OUT/prompts/cut.txt"
}

{
  echo "# test A $(date -u +%FT%TZ) on $(hostname -s); kernel $(uname -r)"
  echo "weights: unsloth/Qwen3.8-Flash-Next-GGUF @ $WEIGHTS_REV, $MODEL_REL + $MTP_REL"
  echo "llama.cpp: $(git -C "$LLAMA_BIN/../.." log --oneline -1 2>/dev/null)"
  echo "gufo image: $(podman image inspect "$IMAGE" --format '{{.Id}} {{.Created}}' 2>/dev/null)"
  echo "gpu clock level: $(cat /sys/class/drm/card*/device/power_dpm_force_performance_level 2>/dev/null | head -1)"
  echo "engines: $ENGINES; fills: $FILLS; repeats: $REPEATS; context: $CTX; decode $DECODE tokens, greedy, thinking off"
} > "$OUT/versions.txt"

echo "== prompts (llama.cpp tokenizer)"
start_llamacpp || { echo "llama.cpp did not start; see $OUT/server-llamacpp.log"; exit 1; }
make_prompts
stop_server
failed=0
for engine in $ENGINES; do
  # every engine gets a fresh server: same starting state for each
  "start_$engine" || { echo "$engine did not start; see $OUT/server-$engine.log" | tee -a "$OUT/results.jsonl"; failed=1; stop_server; continue; }
  echo "== $engine"
  uv run "$HERE/throughput.py" --engine "$engine" --url "http://127.0.0.1:$PORT" --prompts "$OUT/prompts" \
    --out "$OUT/results.jsonl" --fills "$FILLS" --repeats "$REPEATS" --decode "$DECODE" || failed=1
  stop_server
done
echo "done: $OUT"
exit $failed

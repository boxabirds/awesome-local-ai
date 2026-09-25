#!/usr/bin/env bash
# measure.sh -- the measurements that turn this combination into a measured one.
#
# Runs against the installed combination (reads its manifest via
# benchmarks/perf/lib.sh) and writes everything to ./results, stamped, with a
# header describing the machine. See README.md in this directory for what each
# result replaces.
#
#   ./measure.sh header      machine description only
#   ./measure.sh load        cold and warm load time (drops the page cache: sudo)
#   ./measure.sh profiles    server memory per profile, empty and after a long prompt
#   ./measure.sh bench       llama-bench decode/prefill at depth 0, 32k, 128k
#   ./measure.sh all         all of the above, in that order
#
#   POWER_MODE=performance   BIOS power mode; not readable from Linux, so say it
#   PORT=18181               scratch port for the server runs
#   DEPTHS=0,32768,131072    llama-bench depths (128k takes a while per rep)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../../../../../../.." && pwd)"
export LOCAL_AI_INSTALL_REL="${LOCAL_AI_INSTALL_REL:-.local/share/qwen38-flash-next-strix}"
OUT="${OUT:-$HERE/results}"
# shellcheck source=/dev/null
. "$REPO_ROOT/benchmarks/perf/lib.sh"

STAMP="$(date +%Y%m%d-%H%M)"
PORT="${PORT:-18181}"
DEPTHS="${DEPTHS:-0,32768,131072}"
BENCH_BIN="$ROOT/llama.cpp/build/bin/llama-bench"

gpu_dir() {
  local d
  for d in /sys/bus/pci/devices/*; do
    [[ "$(cat "$d/vendor" 2>/dev/null)" == "0x1002" && "$(cat "$d/device" 2>/dev/null)" == "0x1586" ]] \
      && { printf '%s' "$d"; return 0; }
  done
  return 1
}
GPU="$(gpu_dir)" || { echo "measure.sh: no Strix Halo GPU (1002:1586) found." >&2; exit 1; }
mib() { echo $(( $(cat "$GPU/$1") / 1048576 )); }

header() {
  local f="$OUT/machine-$STAMP.txt"
  {
    echo "# $(date -Is)  combination: ${COMBINATION}"
    echo "machine      $(cat /sys/class/dmi/id/sys_vendor 2>/dev/null) $(cat /sys/class/dmi/id/product_name 2>/dev/null)"
    echo "machine slug $(cat /sys/class/dmi/id/product_name 2>/dev/null | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
    echo "bios         $(cat /sys/class/dmi/id/bios_version 2>/dev/null) ($(cat /sys/class/dmi/id/bios_date 2>/dev/null))"
    echo "power mode   ${POWER_MODE:-NOT RECORDED -- set POWER_MODE=performance|balance|quiet|rack}"
    echo "kernel       $(uname -r)"
    echo "firmware     $(dpkg-query -W -f='${Version}' linux-firmware 2>/dev/null || echo '?')"
    echo "mesa/radv    $(vulkaninfo --summary 2>/dev/null | awk -F'= ' '/driverInfo/ {print $2; exit}' || echo '?')"
    echo "ram          $(( $(awk '/^MemTotal:/ {print $2}' /proc/meminfo) / 1024 )) MiB"
    echo "carve-out    $(mib mem_info_vram_total) MiB"
    echo "gtt limit    $(mib mem_info_gtt_total) MiB (ttm.pages_limit=$(cat /sys/module/ttm/parameters/pages_limit 2>/dev/null || echo '?'))"
    echo "perf level   $(cat "$GPU/power_dpm_force_performance_level" 2>/dev/null || echo '?')"
    echo "llama.cpp    $(git -C "$ROOT/llama.cpp" rev-parse --short HEAD 2>/dev/null) ($(cat "$ROOT/llama.cpp/.build-stamp" 2>/dev/null | cut -d' ' -f2))"
    echo "model        ${MODEL_FILE}"
  } | tee "$f"
}

# Start the server on the scratch port and wait for /health. Sets SERVER_PID
# and LOAD_S; not called in a subshell, or both would be lost.
start_server() {
  local log="$1" t0 i
  t0=$(date +%s)
  PORT="$PORT" "$SERVER_CMD" > "$log" 2>&1 &
  SERVER_PID=$!
  for i in $(seq 1 1800); do
    curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 && { LOAD_S=$(( $(date +%s) - t0 )); return 0; }
    kill -0 "$SERVER_PID" 2>/dev/null || { echo "server died; see $log" >&2; return 1; }
    sleep 1
  done
  echo "server not healthy after 30 min; see $log" >&2; return 1
}
stop_server() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; sleep 3; }
rss_mib() { ps -o rss= -p "$SERVER_PID" | awk '{printf "%d", $1/1024}'; }

load() {
  local f="$OUT/load-$STAMP.txt"
  echo "== load time (PROFILE=${PROFILE:-coding})" | tee "$f"
  sync; echo 3 | sudo tee /proc/sys/vm/drop_caches >/dev/null
  start_server "$OUT/load-cold-$STAMP.log"; stop_server
  echo "cold (page cache dropped)  ${LOAD_S} s" | tee -a "$f"
  start_server "$OUT/load-warm-$STAMP.log"; stop_server
  echo "warm (second start)        ${LOAD_S} s" | tee -a "$f"
}

# ~N tokens of varied text, so the prompt cannot be served from cache.
long_prompt() {
  python3 - "$1" <<'PY'
import json, random, sys
n = int(sys.argv[1]); random.seed(n)
words = "the model reads a file then edits a function and runs the tests again until they pass".split()
body = " ".join(random.choice(words) + str(random.randint(0, 999)) for _ in range(n // 2))
print(json.dumps({"messages": [{"role": "user", "content": body + "\nReply with exactly: OK"}],
                  "max_tokens": 16, "chat_template_kwargs": {"enable_thinking": False}}))
PY
}

profiles() {
  local f="$OUT/profiles-$STAMP.tsv" name ctx rest empty_rss empty_gtt full_rss full_gtt fill
  printf 'profile\tctx\tload_s\trss_empty_mib\tgtt_empty_mib\tprompt_tokens\trss_full_mib\tgtt_full_mib\n' | tee "$f"
  while IFS='|' read -r name ctx rest; do
    [[ -z "${name// }" || "$name" == \#* ]] && continue
    PROFILE="$name" start_server "$OUT/profile-$name-$STAMP.log" || continue
    empty_rss="$(rss_mib)"; empty_gtt="$(mib mem_info_gtt_used)"
    # Fill most of ONE slot's context. For multi-slot profiles this measures
    # one busy slot, not all of them: note it when reading the number.
    fill=$(( ctx * 3 / 4 )); [[ "$name" == "agents" ]] && fill=98304
    long_prompt "$fill" | curl -sf "http://127.0.0.1:${PORT}/v1/chat/completions" \
      -H 'Content-Type: application/json' -d @- \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["usage"]["prompt_tokens"])' > "$OUT/.pt" 2>/dev/null || echo '?' > "$OUT/.pt"
    full_rss="$(rss_mib)"; full_gtt="$(mib mem_info_gtt_used)"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$ctx" "$LOAD_S" "$empty_rss" "$empty_gtt" \
      "$(cat "$OUT/.pt")" "$full_rss" "$full_gtt" | tee -a "$f"
    stop_server
  done < "$ROOT/profiles.tsv"
  rm -f "$OUT/.pt"
}

bench() {
  [[ -x "$BENCH_BIN" ]] || { echo "measure.sh: no llama-bench at $BENCH_BIN" >&2; return 1; }
  local f="$OUT/bench-$STAMP.md"
  echo "== llama-bench, depths ${DEPTHS} (perf level: $(cat "$GPU/power_dpm_force_performance_level"))" | tee "$f"
  "$BENCH_BIN" -m "$MODEL" -ngl 99 -fa 1 -mmp 0 -ub 512 -b 2048 \
    -p 512,2048 -n 128 -d "$DEPTHS" -r 2 -o md 2>>"$OUT/bench-$STAMP.log" | tee -a "$f"
}

case "${1:-all}" in
  header)   header ;;
  load)     header; load ;;
  profiles) header; profiles ;;
  bench)    header; bench ;;
  all)      header; load; profiles; bench ;;
  *) sed -n '2,20p' "$0"; exit 1 ;;
esac
echo "results: $OUT"

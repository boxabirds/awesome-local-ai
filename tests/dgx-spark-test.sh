#!/usr/bin/env bash
# The DGX Spark path, exercised without a Spark.
#
# A GB10 is a CUDA device with unified memory: nvidia-smi names it and gives its
# compute capability (12.1), but answers "[N/A]" for memory.total, .used and
# .free. Every reader of those fields has to fall back to /proc/meminfo, or it
# does arithmetic on "[N/A]": bash prints "arithmetic syntax error", the test is
# false, and the installer refuses a 128 GB machine for having too little VRAM
# (seen on a DGX Spark, 29 Oct 2026). This fakes that nvidia-smi and a meminfo, then
# runs the real host probe, accelerator adapter, combination config and runtime
# launcher against them.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

COMBO="qwen/3.8/flash-next/ubuntu/dgx-spark/llamacpp-pi"
STRIX_COMBO="qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# ---- a fake GB10 ----------------------------------------------------------
# A DGX Spark's own figures: MemTotal 127,598,832 kB (124,608 MiB).
GB10_MEMTOTAL_KIB=127598832
GB10_MEMTOTAL_MIB=$(( GB10_MEMTOTAL_KIB / 1024 ))
FAKE_AVAIL_MIB=110000
mkdir -p "$SCRATCH/bin"
cat > "$SCRATCH/bin/nvidia-smi" <<'EOF'
#!/usr/bin/env bash
# Answers the queries the repo makes, the way a GB10 does.
q="$*"
case "$q" in
  *--query-compute-apps*) exit 0 ;;
esac
out=""
for f in $(sed -nE 's/.*--query-gpu=([^ ]+).*/\1/p' <<< "$q" | tr ',' ' '); do
  case "$f" in
    name)            v="NVIDIA GB10" ;;
    compute_cap)     v="12.1" ;;
    driver_version)  v="580.178.04" ;;
    memory.*)        v="[N/A]" ;;
    *)               v="0" ;;
  esac
  out="${out:+$out, }$v"
done
printf '%s\n' "$out"
EOF
chmod +x "$SCRATCH/bin/nvidia-smi"
printf 'MemTotal:       %s kB\nMemAvailable:   %s kB\nSwapTotal:      0 kB\n' \
  "$GB10_MEMTOTAL_KIB" $(( FAKE_AVAIL_MIB * 1024 )) > "$SCRATCH/meminfo"
FAKE_PATH="$SCRATCH/bin:$PATH"

echo "host probe"
probe() {
  PATH="$FAKE_PATH" PROC_MEMINFO="$SCRATCH/meminfo" bash -c '
    set -uo pipefail; LOG_FILE=/dev/null
    . "'"$REPO_ROOT"'/lib/common.sh"; . "'"$REPO_ROOT"'/lib/select.sh"
    _detect_linux 2>&1; echo "$HOST_ACCEL|$HOST_MEM_MIB"' | tail -1
}
assert_eq "a GB10 is a CUDA host whose memory is MemTotal" "cuda|${GB10_MEMTOTAL_MIB}" "$(probe)"

echo
echo "selection"
pick() {
  bash -c 'LOG_FILE=/dev/null; REPO_ROOT="'"$REPO_ROOT"'"; . "$REPO_ROOT/lib/common.sh"; . "$REPO_ROOT/lib/select.sh"
    HOST_OS=ubuntu; HOST_ARCH=aarch64; HOST_ACCEL=cuda; HOST_MEM_MIB='"$GB10_MEMTOTAL_MIB"'
    HOST_OS_PRETTY=test; HOST_MEM_DESC=test; candidates_for_host qwen | cut -d"|" -f2'
}
assert_eq "dgx-spark is a CUDA machine with 128 GB" "cuda|131072" \
  "$(bash -c '. "'"$REPO_ROOT"'/lib/select.sh"; _machine_segment dgx-spark')"
assert_ok "a GB10 is offered the Spark combination" grep -qxF "$COMBO" <<< "$(pick)"

echo
echo "qualification"
adapter() {
  PATH="$FAKE_PATH" PROC_MEMINFO="$SCRATCH/meminfo" BACKEND_NEEDS_BUILD_TOOLS=0 bash -c '
    set -uo pipefail
    REPO_ROOT="'"$REPO_ROOT"'"; LOG_FILE=/dev/null
    . "$REPO_ROOT/lib/common.sh"
    . "$REPO_ROOT/combinations/'"$COMBO"'/config.sh"
    . "$REPO_ROOT/lib/accel/cuda.sh"
    '"$1" 2>&1
}
out="$(adapter 'qualify_accel; echo "MEM=$ACCEL_MEM_MIB ARCH=$ACCEL_ARCH"')"
assert_ok    "the 128 GB Spark is not refused"          grep -q "^MEM=" <<< "$out"
assert_eq    "its device memory is MemTotal"            "MEM=${GB10_MEMTOTAL_MIB} ARCH=121" "$(grep '^MEM=' <<< "$out")"
assert_fails "no arithmetic on [N/A]"                   grep -q "syntax error" <<< "$out"
assert_ok    "sm_121 is an architecture it was run on"  grep -q "sm_121 is one this combination was run on" <<< "$out"
assert_eq    "the smoke report reads used and free from meminfo" \
  "$(( GB10_MEMTOTAL_MIB - FAKE_AVAIL_MIB )) ${FAKE_AVAIL_MIB}" "$(adapter 'accel_report_mem')"

echo
echo "the baseline differs from the Strix Halo llama.cpp stack only in the machine"
cfg() { bash -c 'LOG_FILE=/dev/null; err() { :; }; . "'"$REPO_ROOT"'/lib/common.sh"
  . "'"$REPO_ROOT"'/combinations/'"$1"'/config.sh"; echo "${'"$2"'}"'; }
for v in LLAMA_REPO_URL LLAMA_BRANCH QUANT MTP_QUANT MODEL_ASSETS SAFE_KV_TYPES SAMPLING_THINKING SAMPLING_INSTRUCT \
         REASONING_EFFORT_DEFAULT LLAMA_BATCH LLAMA_EXTRA_ARGS SPEC_DRAFT_N_MAX SPEC_DRAFT_P_MIN CONTEXT_LIMIT \
         OUTPUT_LIMIT MODEL_ALIAS_DEFAULT CLIENT; do
  assert_eq "same $v" "$(cfg "$STRIX_COMBO" "$v")" "$(cfg "$COMBO" "$v")"
done
assert_eq "...on CUDA"           "cuda" "$(cfg "$COMBO" ACCEL)"
assert_eq "...for sm_121"        "121"  "$(cfg "$COMBO" ACCEL_ARCHS_VERIFIED)"
assert_eq "...on DGX OS (24.04)" "24.04" "$(cfg "$COMBO" TARGET_OS_VERSION)"
assert_eq "same profile table" \
  "$(grep -v '^#' "$REPO_ROOT/combinations/$STRIX_COMBO/profiles.tsv" | cut -d'|' -f1-6)" \
  "$(grep -v '^#' "$REPO_ROOT/combinations/$COMBO/profiles.tsv" | cut -d'|' -f1-6)"
assert_ok "a root installer points at it" \
  grep -qxF "COMBINATION=\"$COMBO\"" "$REPO_ROOT/install-qwen-3.8-flash-next-ubuntu-dgx-spark-llamacpp-pi.sh"

echo
echo "the runtime launcher's pre-flight, with memory taken by something else"
FH="$SCRATCH/home"; REL=".local/share/qwen38-flash-next-spark"; R="$FH/$REL"
mkdir -p "$R/models/Qwen3.8-Flash-Next-GGUF/UD-IQ4_XS" "$R/models/Qwen3.8-Flash-Next-GGUF/MTP" "$R/llama.cpp/build/bin"
: > "$R/models/Qwen3.8-Flash-Next-GGUF/UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf"
: > "$R/models/Qwen3.8-Flash-Next-GGUF/MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf"
cp "$REPO_ROOT/combinations/$COMBO/profiles.tsv" "$REPO_ROOT/combinations/$COMBO/help.txt" "$R/"
printf '#!/usr/bin/env bash\n[[ "${1:-}" == "--help" ]] && { echo usage; exit 0; }\nprintf "%%s\\n" "$@"\n' \
  > "$R/llama.cpp/build/bin/llama-server"
chmod +x "$R/llama.cpp/build/bin/llama-server"
bash -c 'LOG_FILE=/dev/null; . "'"$REPO_ROOT"'/lib/common.sh"; . "'"$REPO_ROOT"'/combinations/'"$COMBO"'/config.sh"
cat <<EOF
INSTALL_ID="$INSTALL_ID"; DISPLAY_NAME="$DISPLAY_NAME"; BACKEND="$BACKEND"; ACCEL="$ACCEL"; ROOT_ENV_VAR="$ROOT_ENV_VAR"
MODEL_SUBDIR="$MODEL_SUBDIR"; MODEL_FILE="UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf"; MMPROJ_FILE=""; MTP_FILE="MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf"
MODEL_ALIAS_DEFAULT="$MODEL_ALIAS_DEFAULT"; DEFAULT_PROFILE="$DEFAULT_PROFILE"; SAFE_KV_TYPES="$SAFE_KV_TYPES"
REASONING_EFFORT_DEFAULT="$REASONING_EFFORT_DEFAULT"; REASONING_EFFORTS="$REASONING_EFFORTS"
SAMPLING_THINKING="$SAMPLING_THINKING"; SAMPLING_INSTRUCT="$SAMPLING_INSTRUCT"; SPEC_DRAFT_N_MAX="$SPEC_DRAFT_N_MAX"; SPEC_DRAFT_P_MIN="$SPEC_DRAFT_P_MIN"; SPEC_BUILTIN=""
LLAMA_BATCH="$LLAMA_BATCH"; LLAMA_EXTRA_ARGS="$LLAMA_EXTRA_ARGS"; SPEC_NGRAM_ARGS="${SPEC_NGRAM_ARGS:-}"
SERVER_CMD="${INSTALL_ID}-server"
EOF' > "$R/install.env"
# Less free than the default profile needs: the pre-flight must say so, with the meminfo figure.
TIGHT_AVAIL_MIB=50000
printf 'MemTotal:       %s kB\nMemAvailable:   %s kB\n' "$GB10_MEMTOTAL_KIB" $(( TIGHT_AVAIL_MIB * 1024 )) > "$SCRATCH/meminfo-tight"
launch_out="$(HOME="$FH" LOCAL_AI_INSTALL_REL="$REL" PORT=1 ALLOW_COEXIST=1 PATH="$FAKE_PATH" \
  PROC_MEMINFO="$SCRATCH/meminfo-tight" bash "$REPO_ROOT/lib/runtime/server-llamacpp.sh" 2>&1)"
assert_fails "no arithmetic on [N/A]" grep -q "syntax error" <<< "$launch_out"
assert_ok    "warns with the memory actually available" grep -q "only ${TIGHT_AVAIL_MIB} MiB is free" <<< "$launch_out"

finish

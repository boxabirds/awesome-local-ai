#!/usr/bin/env bash
# benchmarks/apple-silicon-probe.sh -- measure Bonsai 2 27B on an Apple silicon Mac.
#
# Unlike its neighbours this harness does NOT source lib.sh and does not need
# awesome-local-ai installed: it measures a machine that has no combination yet,
# in order to find out whether one can be written. It installs nothing outside
# its own work directory and never asks for sudo.
#
# It produces ONE report file, already scrubbed of your username, ready to paste
# into an issue or PR. See docs/measuring-bonsai2-on-apple-silicon.md for what
# the numbers are for and why each one is here.
#
#   ./apple-silicon-probe.sh              full run
#   ./apple-silicon-probe.sh --quick      skip the thermal soak (first look only)
#   ./apple-silicon-probe.sh --help
#
# bash 3.2 compatible: stock macOS /bin/bash is 3.2.57.

set -uo pipefail

WORK="${BONSAI_PROBE_DIR:-$HOME/bonsai2-probe}"
DEMO="$WORK/Bonsai-demo"
COOLDOWN="${COOLDOWN:-180}"
THERMAL_RUNS="${THERMAL_RUNS:-5}"
QUICK=0
REPO="prism-ml/Ternary-Bonsai-2-27B-gguf"
PTQ1="Ternary-Bonsai-2-27B-PTQ1_0.gguf"

while [ $# -gt 0 ]; do
  case "$1" in
    --quick) QUICK=1; COOLDOWN=10; THERMAL_RUNS=3; shift ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

RESULT="$WORK/bonsai2-$(hostname -s 2>/dev/null || echo mac)-$(date +%Y%m%d-%H%M).md"

# ---- output helpers -------------------------------------------------------
_step() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
_info() { printf '    %s\n' "$*"; }
_warn() { printf '\033[33m    WARNING: %s\033[0m\n' "$*"; }
_die()  { printf '\033[31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

# Everything that lands in the report goes through here, so the scrub is not
# something anyone has to remember.
say() { printf '%s\n' "$*" >> "$RESULT"; }
run_into_report() {
  # run_into_report <label> <cmd...>
  local label="$1"; shift
  _info "$label"
  say '```'
  "$@" 2>&1 | sed "s|$HOME|\$HOME|g" | tee -a "$RESULT" | grep -E '^\||error|Error|failed' || true
  say '```'
  say ""
}

# ---- preflight ------------------------------------------------------------
_step "Preflight"
[ "$(uname -s)" = "Darwin" ] || _die "This probe is for macOS. On Linux/NVIDIA use install.sh instead."
ARCH="$(uname -m)"
[ "$ARCH" = "arm64" ] || _warn "Architecture is $ARCH, not arm64 -- Metal results will not be representative."
command -v git   >/dev/null 2>&1 || _die "git not found. Run: xcode-select --install"
command -v curl  >/dev/null 2>&1 || _die "curl not found."
xcode-select -p  >/dev/null 2>&1 || _warn "Xcode command-line tools may be missing (xcode-select --install)."

FREE_GB=$(df -g "$HOME" 2>/dev/null | awk 'NR==2{print $4}')
if [ -n "${FREE_GB:-}" ] && [ "$FREE_GB" -lt 25 ] 2>/dev/null; then
  _warn "Only ${FREE_GB} GB free on \$HOME; this needs about 25 GB. Continuing anyway."
fi
_info "work dir: $WORK"
mkdir -p "$WORK" || _die "cannot create $WORK"

# ---- report header --------------------------------------------------------
: > "$RESULT"
say "# Bonsai 2 27B on Apple silicon -- probe report"
say ""
say "Produced by \`benchmarks/apple-silicon-probe.sh\` from awesome-local-ai."
say "Every number below is from this machine. Paths are scrubbed to \$HOME."
say ""
say "## Machine"
say '```'
{
  echo "chip:      $(sysctl -n machdep.cpu.brand_string 2>/dev/null)"
  echo "arch:      $ARCH"
  echo "ram_bytes: $(sysctl -n hw.memsize 2>/dev/null)"
  echo "cpus:      $(sysctl -n hw.ncpu 2>/dev/null)"
  echo "macos:     $(sw_vers -productVersion 2>/dev/null)"
  echo "model:     $(sysctl -n hw.model 2>/dev/null)"
  echo "wired_limit_mb: $(sysctl -n iogpu.wired_limit_mb 2>/dev/null || echo unset)"
} | tee -a "$RESULT"
say '```'
say ""

# ---- 1. the demo, prebuilt binaries only ----------------------------------
_step "1/6  Installing the demo (prebuilt Metal binaries, no source build)"
if [ -d "$DEMO/.git" ]; then
  _info "already cloned, skipping"
else
  git clone --depth 1 https://github.com/PrismML-Eng/Bonsai-demo.git "$DEMO" \
    || _die "clone failed"
fi

BIN="$DEMO/bin/mac"
if [ -x "$BIN/llama-bench" ]; then
  _info "binaries already present, skipping setup.sh"
else
  _info "running setup.sh with BONSAI_SKIP_MLX=1 (this downloads several GB)"
  _info "compiling is deliberately avoided: it would heat the machine before we measure it"
  ( cd "$DEMO" && BONSAI_SKIP_MLX=1 ./setup.sh ) || _warn "setup.sh returned non-zero; continuing to check what it produced"
fi
[ -x "$BIN/llama-bench" ] || _die "no llama-bench at $BIN. Check setup.sh output above."
[ -x "$BIN/llama-cli" ]   || _die "no llama-cli at $BIN."

# ---- 2. locate the weights ------------------------------------------------
_step "2/6  Locating weights"
# BSD find: no -printf. Newest .gguf wins if several matched.
PQ2="$(find "$DEMO/models" -name '*Bonsai-2*PQ2_0.gguf' -type f 2>/dev/null | head -1)"
PTQ1_PATH="$(find "$DEMO/models" -name "*$PTQ1" -type f 2>/dev/null | head -1)"

if [ -z "$PTQ1_PATH" ]; then
  _info "fetching the smaller packing ($PTQ1, 5.95 GB) -- the one that matters on 16 GB"
  mkdir -p "$DEMO/models"
  PTQ1_PATH="$DEMO/models/$PTQ1"
  curl -L -C - --fail --progress-bar \
    "https://huggingface.co/$REPO/resolve/main/$PTQ1" -o "$PTQ1_PATH" \
    || { _warn "download failed; continuing with PQ2_0 only"; PTQ1_PATH=""; }
fi

[ -n "$PQ2" ] || _warn "no PQ2_0 file found (setup.sh may have chosen a different band)"
[ -n "$PTQ1_PATH" ] || [ -n "$PQ2" ] || _die "no usable .gguf found at all."
PRIMARY="${PTQ1_PATH:-$PQ2}"
_info "primary model: $(basename "$PRIMARY")"
[ -n "$PQ2" ] && _info "also found:    $(basename "$PQ2")"

say "## Files"
say '```'
{ [ -n "$PTQ1_PATH" ] && ls -lh "$PTQ1_PATH" | awk '{print $9": "$5}'
  [ -n "$PQ2" ] && ls -lh "$PQ2" | awk '{print $9": "$5}'; } \
  | sed "s|$HOME|\$HOME|g" | sed "s|.*/||" | tee -a "$RESULT"
say '```'
say ""

# ---- 3. does it generate sense? -------------------------------------------
_step "3/6  Coherence check -- READ THIS OUTPUT YOURSELF"
say "## A. Coherence check"
say ""
say "Prompt: reverse a linked list, code only. Thinking is on by default, so the"
say "answer may follow a reasoning block."
say ""
SAMPLE="$WORK/.sample.txt"
"$BIN/llama-cli" -m "$PRIMARY" -ngl 99 -fa on -c 4096 --single-turn -n 500 \
  --temp 1.0 --top-p 0.95 --top-k 20 \
  -p "Write a Python function that reverses a linked list. Code only." \
  > "$SAMPLE" 2>&1
# tee to stdout AND the report; /dev/tty would break under redirection.
say '```'
sed "s|$HOME|\$HOME|g" "$SAMPLE" | tail -40 | tee -a "$RESULT"
say '```' 
say ""
if grep -qE '\bdef \b|return ' "$SAMPLE"; then
  _info "looks like code -- good sign"
  say "_Automated heuristic: found Python-shaped output._"
else
  _warn "NO code-shaped text found. This may be the silent-gibberish failure"
  _warn "(binary too old for these weights) -- or just a long reasoning block."
  _warn "READ the output above. If it is word salad, stop and report that."
  say "_Automated heuristic: **no** Python-shaped output found -- needs a human look._"
fi
say ""

# ---- 4. headline throughput ----------------------------------------------
_step "4/6  Headline throughput"
say "## B. Headline (pp512 / tg128)"
say ""
if [ -n "$PTQ1_PATH" ] && [ -n "$PQ2" ]; then
  run_into_report "both packings" "$BIN/llama-bench" -m "$PTQ1_PATH" -m "$PQ2" -p 512 -n 128 -fa 1 -ngl 99 -r 3
else
  run_into_report "single packing" "$BIN/llama-bench" -m "$PRIMARY" -p 512 -n 128 -fa 1 -ngl 99 -r 3
fi

# ---- 5. thermals ----------------------------------------------------------
_step "5/6  Thermal soak -- ${THERMAL_RUNS} consecutive runs"
say "## C. Thermal soak"
say ""
say "${THERMAL_RUNS} consecutive identical runs. Report every one: a fanless"
say "chassis can lose half its rate while the benchmark is still going, and an"
say "average hides both the cold rate and the sustained one."
say ""
if [ "$QUICK" -eq 1 ]; then
  say "_--quick: shortened soak, ${COOLDOWN}s cooldown. NOT a thermal result._"
  _warn "--quick: this is a smoke test, not a thermal measurement"
fi
_info "cooling down for ${COOLDOWN}s so run 1 starts cold..."
sleep "$COOLDOWN"

say "Thermal pressure before the soak:"
say '```'
(pmset -g therm 2>/dev/null || echo "pmset -g therm: unavailable") | tee -a "$RESULT"
say '```'
say ""

# Keep each run's tg128 so the report can state the decline itself rather than
# leaving it as arithmetic for whoever reads it.
TG_SERIES="$WORK/.tg_series"
: > "$TG_SERIES"
i=1
while [ "$i" -le "$THERMAL_RUNS" ]; do
  say "**run $i**"
  RUN_LOG="$WORK/.thermal-$i.txt"
  "$BIN/llama-bench" -m "$PRIMARY" -p 512 -n 128 -fa 1 -ngl 99 -r 1 > "$RUN_LOG" 2>&1
  sed "s|$HOME|\$HOME|g" "$RUN_LOG" | tee -a "$RESULT" | grep -E '^\|' || true
  say ""
  # "| model | ... | tg128 | 12.61 ± 0.58 |" -> 12.61
  awk -F'|' '/tg128/ { n=split($(NF-1), a, " "); print a[1] }' "$RUN_LOG" >> "$TG_SERIES"
  i=$((i + 1))
done

say "Thermal pressure after the soak:"
say '```'
(pmset -g therm 2>/dev/null || echo "pmset -g therm: unavailable") | tee -a "$RESULT"
say '```'
say ""

say "### Thermal verdict"
say ""
say '```'
awk 'NR==1{first=$1} {last=$1; n++; printf "  run %d: %s tok/s\n", NR, $1}
     END{
       if (n>1 && first>0) {
         printf "\n  first %.2f -> last %.2f  (%+.1f%%)\n", first, last, (last-first)/first*100
         if ((first-last)/first > 0.15)
           print "  VERDICT: throttling -- the sustained rate is NOT the headline rate."
         else
           print "  VERDICT: no significant throttling across these runs."
       } else { print "  (not enough runs to judge)" }
     }' "$TG_SERIES" | tee -a "$RESULT"
say '```'
say ""

# ---- 6. context ceiling and KV types --------------------------------------
_step "6/6  Context ceiling and KV types"
say "## D. Context ceiling"
say ""
say "First entry that fails is the ceiling on this machine."
say ""
for CTX in 8192 32768 65536 131072; do
  say "**ctx target $CTX**"
  run_into_report "ctx $CTX" "$BIN/llama-bench" -m "$PRIMARY" -n 128 -p 0 \
      -d $((CTX - 256)) -fa 1 -ngl 99 -r 1 -ctk q4_0 -ctv q4_0
done

say "## E. KV cache types"
say ""
say "On CUDA, q5_1 fell off a cliff -- 28 tok/s against 3015 -- with no warning,"
say "a silent fallback to CPU attention. This checks whether Metal does the same."
say ""
for KV in f16 q8_0 q4_0 q5_1; do
  say "**kv $KV**"
  run_into_report "kv $KV" "$BIN/llama-bench" -m "$PRIMARY" -p 512 -n 0 -fa 1 -ngl 99 -ctk "$KV" -ctv "$KV" -r 2
done

# ---- close ----------------------------------------------------------------
say "## Notes from the operator"
say ""
say "The thermal decline and the coherence sample are both above; whoever or"
say "whatever ran this can answer the first two from the report itself. The"
say "third needs a person in the room."
say ""
say "- Was the coherence output in section A actually sensible prose/code? "
say "- Did anything behave oddly (stalls, beachballs, memory pressure)? "
say "- Did the chassis get physically hot, and was anything else running? "
say ""

_step "Done"
_info "Report: $RESULT"
_info ""
_info "Please fill in the 'Notes from the operator' section at the bottom --"
_info "the thermal question in particular cannot be measured from inside."
_info ""
_info "The report contains no username; paste it as-is."

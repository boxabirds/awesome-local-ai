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
#   ./apple-silicon-probe.sh --only ceiling,kv    just those sections
#   ./apple-silicon-probe.sh --help
#
# Sections: coherence, headline, thermal, ceiling, kv, power  (default: all)
#           depth                                        (opt-in; slow, prefills)
#
# bash 3.2 compatible: stock macOS /bin/bash is 3.2.57.

set -uo pipefail

# Two locations, deliberately different things.
#
# WORK holds the llama.cpp clone and 13+ GB of weights. It stays OUT of the
# repo -- .gitignore blocks *.gguf and build/ for good reason, and nobody wants
# a git status full of model files.
#
# RESULT is the one small artefact worth keeping, so it lands IN the repo, next
# to this script, where the person who ran it will actually find it. It
# defaulted to the work directory once and cost two people a hunt through the
# filesystem. Not benchmarks/results/ either -- .gitignore excludes that.
WORK="${BONSAI_PROBE_DIR:-$HOME/bonsai2-probe}"
PROBE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
DEMO="$WORK/Bonsai-demo"
COOLDOWN="${COOLDOWN:-180}"
THERMAL_RUNS="${THERMAL_RUNS:-5}"
QUICK=0
REPO="prism-ml/Ternary-Bonsai-2-27B-gguf"
PTQ1="Ternary-Bonsai-2-27B-PTQ1_0.gguf"
# `depth` is deliberately NOT in the default set: it is the only section that
# prefills a long context, and on Apple silicon that is minutes to tens of
# minutes. Add it explicitly with --only depth when you actually want it.
ONLY="coherence,headline,thermal,ceiling,kv,power"

# wanted <section> -- is this section in the --only list?
wanted() { case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="${2:-}"; [ -n "$ONLY" ] || { echo "--only needs a list" >&2; exit 2; }; shift 2 ;;
    --quick) QUICK=1; COOLDOWN=10; THERMAL_RUNS=3; shift ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

RESULT="${RESULT:-$PROBE_DIR/bonsai2-$(hostname -s 2>/dev/null || echo mac)-$(date +%Y%m%d-%H%M).md}"

# ---- output helpers -------------------------------------------------------
_step() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
_info() { printf '    %s\n' "$*"; }
_warn() { printf '\033[33m    WARNING: %s\033[0m\n' "$*"; }
_die()  { printf '\033[31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

# Everything that lands in the report goes through here, so the scrub is not
# something anyone has to remember.
say() { printf '%s\n' "$*" >> "$RESULT"; }
# Run a command, tee its output into the report, and print a heartbeat while it
# works. Without the heartbeat a slow step is indistinguishable from a hang --
# which is exactly how the first version of this script looked on a Mac.
run_into_report() {
  # run_into_report <label> <cmd...>
  local label="$1"; shift
  local t0 out rc
  t0=$(date +%s)
  out="$WORK/.step.$$"
  _info "$label (running; a dot every 15s)"
  "$@" > "$out" 2>&1 &
  local pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 15
    printf '.'
  done
  wait "$pid"; rc=$?
  printf ' %ss\n' "$(( $(date +%s) - t0 ))"
  say '```'
  sed "s|$HOME|\$HOME|g" "$out" >> "$RESULT"
  say '```'
  say ""
  grep -E '^\||error|Error|failed' "$out" | head -8
  rm -f "$out"
  return $rc
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
_info "report  -> $RESULT"
_info "scratch -> $WORK   (clone + weights, stays out of the repo)"
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
  echo "gpu_cores: $(system_profiler SPDisplaysDataType 2>/dev/null | awk -F': ' '/Total Number of Cores/{print $2; exit}' || echo unknown)"
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
  _info "fetching $PTQ1 (5.95 GB) as the secondary packing"
  mkdir -p "$DEMO/models"
  PTQ1_PATH="$DEMO/models/$PTQ1"
  curl -L -C - --fail --progress-bar \
    "https://huggingface.co/$REPO/resolve/main/$PTQ1" -o "$PTQ1_PATH" \
    || { _warn "download failed; continuing with PQ2_0 only"; PTQ1_PATH=""; }
fi

if [ -z "$PQ2" ]; then
  _info "fetching Ternary-Bonsai-2-27B-PQ2_0.gguf (7.21 GB) -- the packing that"
  _info "prefills fastest, which is the bottleneck on Apple silicon"
  PQ2="$DEMO/models/Ternary-Bonsai-2-27B-PQ2_0.gguf"
  curl -L -C - --fail --progress-bar \
    "https://huggingface.co/$REPO/resolve/main/Ternary-Bonsai-2-27B-PQ2_0.gguf" -o "$PQ2" \
    || { _warn "PQ2_0 download failed; falling back to PTQ1_0"; PQ2=""; }
fi
[ -n "$PTQ1_PATH" ] || [ -n "$PQ2" ] || _die "no usable .gguf found at all."
# PQ2_0 is the primary, NOT the smaller PTQ1_0, and the reason is worth stating
# because the first version of this probe got it backwards.
#
# PTQ1_0 was chosen originally to save 1.26 GB on a 16 GB machine. But memory is
# not what binds here: the measured M2 run held a 262144 context in 7032 MiB and
# left ~9 GB unused. What binds is PREFILL, which is compute-bound -- and
# PTQ1_0's dense base-3 trit packing has to be unpacked with arithmetic, in
# exactly the phase that has no arithmetic to spare. Measured on a 4090, that
# costs it half its prefill: 1597 tok/s against PQ2_0's 3016.
#
# So a machine short on compute should run the packing that is cheaper to
# decode, not the one that is smaller on disk.
PRIMARY="${PQ2:-$PTQ1_PATH}"
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
if wanted coherence; then
_step "3/6  Coherence check -- READ THIS OUTPUT YOURSELF"
say "## A. Coherence check"
say ""
say "Prompt: reverse a linked list, code only, at reasoning effort \`medium\`."
say ""
say "The effort is set explicitly. Bonsai 2 defaults to \`xhigh\`, which spends"
say "most of a small token budget reasoning before it answers -- measured"
say "elsewhere in this repo, a 200-token budget returned 731 characters of"
say "reasoning and 9 of content. Left at the default, this check would often"
say "show a reasoning block and no code, and the heuristic below would cry wolf."
say "Its card states \`low\` is not supported, so \`medium\` is the floor."
say ""
SAMPLE="$WORK/.sample.txt"
# Driven through llama-server, not llama-cli. llama-cli renders its chat to the
# terminal and a plain redirect captured ZERO bytes on a 16 GB M2 while the same
# prompt worked by hand -- see docs/research/20260918-bonsai2-apple-silicon-m2-16gb.
# The server returns JSON, which either parses or does not.
"$BIN/llama-server" -m "$PRIMARY" -a probe -ngl 99 -fa on -c 4096 --jinja \
    -np 1 --host 127.0.0.1 --port 18098 > "$WORK/.coh-server.log" 2>&1 &
COH=$!
w=0; up=0
while [ "$w" -lt 240 ]; do
  kill -0 "$COH" 2>/dev/null || break
  curl -sf http://127.0.0.1:18098/health >/dev/null 2>&1 && { up=1; break; }
  sleep 3; w=$((w + 3))
done
if [ "$up" -eq 1 ]; then
  curl -s http://127.0.0.1:18098/v1/chat/completions \
    -H 'Content-Type: application/json' \
    -d '{"model":"probe","max_tokens":700,"reasoning_effort":"medium",
         "messages":[{"role":"user","content":"Write a Python function that reverses a linked list. Code only."}]}' \
    > "$WORK/.coh.json" 2>&1
  python3 - "$WORK/.coh.json" > "$SAMPLE" 2>&1 <<'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("COULD NOT PARSE SERVER RESPONSE: %s" % e); raise SystemExit
m = d["choices"][0]["message"]
r = m.get("reasoning_content") or ""
c = m.get("content") or ""
u = d.get("usage", {})
print("finish_reason: %s" % d["choices"][0].get("finish_reason"))
print("reasoning_chars: %d   content_chars: %d   completion_tokens: %s"
      % (len(r), len(c), u.get("completion_tokens")))
print("\n--- reasoning (first 600 chars) ---\n%s" % r[:600])
print("\n--- answer ---\n%s" % c)
PYEOF
else
  echo "server did not start; see .coh-server.log" > "$SAMPLE"
  grep -iE 'error|failed' "$WORK/.coh-server.log" | head -5 >> "$SAMPLE"
fi
kill "$COH" 2>/dev/null; wait "$COH" 2>/dev/null; sleep 2

# Show it. This section exists to be read by a human, so printing it is the
# whole point -- an earlier edit replaced the generator and took the display
# and the verdict with it, leaving step 3 silent.
say '```'
sed "s|$HOME|\$HOME|g" "$SAMPLE" | tail -60 | tee -a "$RESULT"
say '```'
say ""

# Distinguish the failure modes. They are NOT the same thing and must not
# print the same warning: a silent model, a broken pipe and a dead server each
# need a different next step.
if [ ! -s "$SAMPLE" ]; then
  _warn "The sample is EMPTY -- nothing was captured at all. That says nothing"
  _warn "about the model. Re-run with: $0 --only coherence"
  say "_Verdict: **empty capture** — the probe recorded nothing. Not evidence about the model._"
elif grep -q 'COULD NOT PARSE SERVER RESPONSE' "$SAMPLE"; then
  _warn "The server replied with something that is not JSON. See .coh.json"
  say "_Verdict: **unparseable server response** — see \`.coh.json\`._"
elif grep -q 'server did not start' "$SAMPLE"; then
  _warn "The server never became healthy. See .coh-server.log"
  say "_Verdict: **server did not start** — the weights or the binary, not the prompt._"
elif grep -qE '\bdef \b|return ' "$SAMPLE"; then
  _info "generated Python-shaped output -- good sign"
  say "_Verdict: **Python-shaped output found.** Read it anyway: coherent-looking"
  say "tokens are exactly what a too-old binary produces._"
else
  _warn "No code-shaped text. With effort pinned to medium and a 700-token budget"
  _warn "this points at the silent-gibberish failure (binary too old for these"
  _warn "weights) rather than an unfinished thought -- but READ the text above."
  say "_Verdict: **no code-shaped output** — read the text; this may be the"
  say "silent-gibberish failure a too-old binary produces._"
fi
say ""

# ---- 4. headline throughput ----------------------------------------------
fi

if wanted headline; then
_step "4/6  Headline throughput"
say "## B. Headline (pp512 / tg128), measured COLD"
say ""
say "Taken after a ${COOLDOWN}s idle period. The first version of this probe"
say "measured the headline immediately after the download and the coherence"
say "check, on an already-warm machine, and reported 3.83 tok/s where a cold"
say "run of the same benchmark gave 7.63 -- the headline was really a thermal"
say "result. Both numbers were true; only one was labelled."
say ""
_info "cooling down ${COOLDOWN}s so the headline is a cold number..."
sleep "$COOLDOWN"
if [ -n "$PTQ1_PATH" ] && [ -n "$PQ2" ]; then
  run_into_report "both packings" "$BIN/llama-bench" -m "$PTQ1_PATH" -m "$PQ2" -p 512 -n 128 -fa 1 -ngl 99 -r 3
else
  run_into_report "single packing" "$BIN/llama-bench" -m "$PRIMARY" -p 512 -n 128 -fa 1 -ngl 99 -r 3
fi

# ---- 5. thermals ----------------------------------------------------------
fi

if wanted thermal; then
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
fi

if wanted ceiling; then
_step "6/6  Context ceiling and KV types"
say "## D. Context ceiling"
say ""
say "Whether a context ALLOCATES, which is what decides the profile table. This"
say "deliberately does not prefill: filling 128k on a Mac at ~50 tok/s prompt"
say "rate would take the better part of an hour per row and measure decode"
say "decay, not whether the context fits."
say ""
CEILING="none"
for CTX in 8192 32768 65536 131072 262144; do
  _info "ctx $CTX: loading..."
  SRV_LOG="$WORK/.srv-$CTX.txt"
  "$BIN/llama-server" -m "$PRIMARY" -ngl 99 -fa on -c "$CTX" \
      -ctk q4_0 -ctv q4_0 -np 1 --host 127.0.0.1 --port 18099 > "$SRV_LOG" 2>&1 &
  SRV=$!
  ok_load=0
  w=0
  while [ "$w" -lt 180 ]; do
    kill -0 "$SRV" 2>/dev/null || break
    if curl -sf http://127.0.0.1:18099/health >/dev/null 2>&1; then ok_load=1; break; fi
    sleep 2; w=$((w + 2))
  done
  if [ "$ok_load" -eq 1 ]; then
    RSS=$(ps -o rss= -p "$SRV" 2>/dev/null | awk '{printf "%.0f", $1/1024}')
    say "- ctx **$CTX**: OK, resident ${RSS} MiB"
    _info "ctx $CTX: OK (${RSS} MiB resident)"
    CEILING="$CTX"
  else
    say "- ctx **$CTX**: FAILED"
    say '```'
    grep -iE 'error|out of memory|alloc|failed' "$SRV_LOG" | head -4 >> "$RESULT"
    say '```'
    _warn "ctx $CTX FAILED -- this is the ceiling"
    kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
    break
  fi
  kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
  sleep 3
done
say ""
say "Largest context that loaded: **$CEILING**"
say ""

if wanted depth; then
say "### Decode at depth"
say ""
say "OPT-IN (--only depth). Prefilling is slow on Apple silicon -- at ~50 tok/s"
say "prompt rate an 8k sample costs minutes and a 128k one costs most of an"
say "hour -- so no default run does it."
say ""
run_into_report "decode at depth 8192 (slow: prefills 8k tokens)" \
    "$BIN/llama-bench" -m "$PRIMARY" -n 128 -p 0 \
    -d 8192 -fa 1 -ngl 99 -r 1 -ctk q4_0 -ctv q4_0
fi

fi

if wanted kv; then
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
fi

if wanted power; then
_step "Power -- what the chip is actually allowed to spend"
say "## F. Power and energy per token"
say ""
say "Joules per token is the number that makes a laptop and a desktop GPU"
say "comparable. A 27B forward pass costs what it costs; the difference between"
say "machines is largely how many watts they are permitted to spend on it."
say "For reference, Prism ML publish 2.58 J/token for an RTX 4090 (91.1 tok/s"
say "at roughly 235 W board power)."
say ""
PM_LOG="$WORK/.powermetrics.txt"
if ! command -v powermetrics >/dev/null 2>&1; then
  say "_powermetrics not available; skipped._"
  _warn "powermetrics not found -- skipping the power section"
elif ! sudo -n true 2>/dev/null; then
  say "_Skipped: powermetrics needs sudo and no cached credential was available._"
  say "_Run \`sudo -v\` then re-run with \`--only power\` to fill this in._"
  _warn "powermetrics needs sudo. Run 'sudo -v' first, then: $0 --only power"
else
  _info "sampling GPU power while generating (about 90s)"
  sudo -n powermetrics --samplers gpu_power -i 1000 -n 120 > "$PM_LOG" 2>&1 &
  PM=$!
  "$BIN/llama-bench" -m "$PRIMARY" -p 0 -n 128 -fa 1 -ngl 99 -r 3 > "$WORK/.pwr-bench.txt" 2>&1
  kill "$PM" 2>/dev/null; wait "$PM" 2>/dev/null

  say '```'
  sed "s|$HOME|\$HOME|g" "$WORK/.pwr-bench.txt" | grep -E '^\|' | tee -a "$RESULT"
  say '```'
  say ""
  # mW or W, whichever this macOS prints
  python3 - "$PM_LOG" "$WORK/.pwr-bench.txt" 2>/dev/null <<'PYEOF' | tee -a "$RESULT"
import re, sys
pm = open(sys.argv[1], errors="ignore").read()
vals = [float(m) for m in re.findall(r'GPU Power:\s*([0-9.]+)\s*mW', pm)]
unit = "mW"
if not vals:
    vals = [float(m)*1000 for m in re.findall(r'GPU Power:\s*([0-9.]+)\s*W', pm)]
    unit = "W"
comb = [float(m) for m in re.findall(r'Combined Power \(CPU \+ GPU \+ ANE\):\s*([0-9.]+)\s*mW', pm)]
bench = open(sys.argv[2], errors="ignore").read()
tg = re.search(r'tg128\s*\|\s*([0-9.]+)', bench)
print("```")
if not vals:
    print("  powermetrics produced no GPU Power samples; see .powermetrics.txt")
else:
    busy = sorted(vals)[len(vals)//2:]          # upper half: the samples under load
    w = sum(busy)/len(busy)/1000.0
    print("  GPU power under load : %.1f W   (median-upper of %d samples)" % (w, len(vals)))
    if comb:
        cbusy = sorted(comb)[len(comb)//2:]
        print("  CPU+GPU+ANE          : %.1f W" % (sum(cbusy)/len(cbusy)/1000.0))
    if tg:
        t = float(tg.group(1))
        print("  generation           : %.2f tok/s" % t)
        print("  ENERGY PER TOKEN     : %.2f J/token   (GPU rail only)" % (w/t))
        print("  RTX 4090 reference   : 2.58 J/token at 91.1 tok/s (~235 W)")
        print("  ratio                : this machine spends %.2fx the energy per token" % ((w/t)/2.58))
print("```")
PYEOF
  say ""
fi
fi

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
_info "  (in the repo, next to this script -- commit it or paste it)"
_info ""
_info "Please fill in the 'Notes from the operator' section at the bottom --"
_info "the thermal question in particular cannot be measured from inside."
_info ""
_info "The report contains no username; paste it as-is."

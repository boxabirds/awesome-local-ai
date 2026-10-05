#!/usr/bin/env bash
# Strata backend (Linux, one NVIDIA card): the pinned checkout, the ranged download that verifies every byte, the
# server configuration it derives for the benchmark, the launcher's refusals, and the combination's data as the
# installer and the harness read it -- all without Strata, a GPU, a model or the network. `git`, `uv`, `nvidia-smi`,
# `free`, `ps` and the Strata server are stubs on PATH that record what they were asked to do; the download reads
# file:// URLs.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
. "$REPO_ROOT/lib/common.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$LOG_FILE"' EXIT
# Every Strata combination is checked the same way; they differ only in which fine-tune they serve. The launcher
# section below runs against the first, whose figures are measured.
COMBOS=("qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi" "qwen/3.8-swift-1.5/flash-next/ubuntu/nvidia4090/strata-pi")
COMBO="${COMBOS[0]}"
CFG="$REPO_ROOT/combinations/$COMBO/config.sh"
LAUNCHER="$REPO_ROOT/lib/runtime/server-strata.sh"
LIB="$REPO_ROOT/lib/strata.sh"

for COMBO in "${COMBOS[@]}"; do
  echo "combination config: $COMBO"
  CFG="$REPO_ROOT/combinations/$COMBO/config.sh"
  assert_ok "the combination exists with its four files" bash -c "cd '$REPO_ROOT/combinations/$COMBO' && test -f config.sh -a -f profiles.tsv -a -f help.txt -a -f README.md"
  assert_ok "opts out of automatic selection"          grep -qE '^AUTO_SELECT=0$' "$CFG"
  assert_ok "backend is strata"                        grep -qE '^BACKEND="strata"' "$CFG"
  assert_ok "the client is pi"                         grep -qE '^CLIENT="\$\{CLIENT:-pi\}"' "$CFG"
  assert_ok "Strata pinned to a full commit"           grep -qE '^STRATA_COMMIT="[0-9a-f]{40}"' "$CFG"
  # A release version beside the commit, in shape only: a hard-coded number goes stale the first time the pin moves,
  # as it did on 5 Oct 2026 (0.1.36 to 0.1.39). What matters is that both pins are there and well formed.
  assert_ok "...and a release version beside it"       grep -qE '^STRATA_VERSION="[0-9]+\.[0-9]+\.[0-9]+"' "$CFG"
  assert_ok "weights pinned to a full commit"          grep -qE '^MODEL_REVISION="[0-9a-f]{40}"' "$CFG"
  assert_ok "the quantization is IQ3_XXS, the owner's choice" grep -qE '^STRATA_QUANT="IQ3_XXS"' "$CFG"
  assert_eq "a hash for both GGUF files" 2 "$(bash -c ". '$CFG'; printf '%s\n' \"\$MODEL_SHA256\" | grep -cE '^[0-9a-f]{64}  '")"
  assert_eq "...and a size for each, in the same order" 2 "$(bash -c ". '$CFG'; printf '%s\n' \"\$MODEL_SIZES\" | grep -cE '^[0-9]+  '")"
  assert_ok "the context is 131072: the benchmark's minimum" grep -qE '^STRATA_CONTEXT=131072$' "$CFG"
  assert_ok "the VRAM reserve its own startup warning asked for" grep -qE '^STRATA_VRAM_RESERVE_MIB=969$' "$CFG"
  assert_ok "effort low, as the owner set for Flash-Next" grep -qE '^REASONING_EFFORT_DEFAULT="low"$' "$CFG"
  assert_ok "the installer's required variables are all set" bash -c "
    . '$REPO_ROOT/lib/common.sh'; . '$CFG'; . '$LIB'
    require_vars INSTALL_ID DISPLAY_NAME MODEL_DISPLAY_NAME TARGET_OS ACCEL BACKEND CLIENT MODEL_ALIAS_DEFAULT \
                 DEFAULT_PROFILE SAMPLING_THINKING DEFAULT_PROVIDER CONTEXT_LIMIT OUTPUT_LIMIT
    require_vars \$BACKEND_REQUIRED_VARS"
  assert_ok "the accelerator and client adapters exist" bash -c ". '$CFG'; test -f '$REPO_ROOT/lib/accel/'\$ACCEL.sh && test -f '$REPO_ROOT/lib/clients/'\$CLIENT.sh"
  . "$REPO_ROOT/benchmarks/spec-bench/harness/config-value.sh"
  assert_eq "the harness reads CONTEXT_LIMIT as the server's context" 131072 "$(cfg CONTEXT_LIMIT "$CFG")"
  assert_eq "...and OUTPUT_LIMIT 32768" 32768 "$(cfg OUTPUT_LIMIT "$CFG")"
  PT="$REPO_ROOT/combinations/$COMBO/profiles.tsv"
  SCHEMA="$(bash -c ". '$REPO_ROOT/lib/common.sh'; . '$LIB'; echo \$PROFILE_SCHEMA")"
  assert_ok "profiles.tsv declares the strata schema on line 1" bash -c "head -1 '$PT' | grep -qx '# $SCHEMA'"
  NCOL="$(awk -F'|' '{print NF}' <<< "$SCHEMA")"
  assert_ok "every profile row has as many columns as the schema declares" bash -c "awk -F'|' -v n='$NCOL' '!/^[[:space:]]*(#|\$)/ && NF!=n {bad=1} END{exit bad}' '$PT'"
  assert_eq "the default profile serves the full 131072" 131072 "$(awk -F'|' -v p="$(bash -c ". '$CFG'; echo \$DEFAULT_PROFILE")" '$1==p{print $2}' "$PT")"
  BASIS_COL="$(awk -F'|' '{for (i = 1; i <= NF; i++) if ($i == "basis") print i}' <<< "$SCHEMA")"
  assert_ok "the profile's memory figures say where they came from: MEASURED with a date, or ESTIMATED" bash -c "awk -F'|' -v c='$BASIS_COL' '!/^[[:space:]]*(#|\$)/ && \$c !~ /^(MEASURED-20[0-9][0-9]-[01][0-9]-[0-3][0-9]|ESTIMATED)\$/ {bad=1} END{exit bad}' '$PT'"
  MIN_COL="$(awk -F'|' '{for (i = 1; i <= NF; i++) if ($i == "min_vram_mib") print i}' <<< "$SCHEMA")"
  PEAK_COL="$(awk -F'|' '{for (i = 1; i <= NF; i++) if ($i == "need_vram_mib") print i}' <<< "$SCHEMA")"
  # The floor is what the launcher gates on, so it can never be the peak dressed up as one (A-045).
  assert_ok "every profile's VRAM floor is below its measured peak" bash -c "awk -F'|' -v m='$MIN_COL' -v k='$PEAK_COL' '!/^[[:space:]]*(#|\$)/ && \$m+0 >= \$k+0 {bad=1} END{exit bad}' '$PT'"
  assert_fails "no home paths in the combination or the module (machine names: tests/privacy-test.sh)" \
    grep -rIEn '/Users/|/home/[a-z]' "$REPO_ROOT/combinations/$COMBO" "$LIB" "$LAUNCHER"
  # The README states the pinned engine and weights; config.sh is what actually runs. They drifted apart when the
  # pin moved from 0.1.36 to 0.1.39 on 5 Oct 2026 and only the config was changed, so the reader was told the wrong
  # version. Whatever the README says the pins are, they are the config's.
  RM="$REPO_ROOT/combinations/$COMBO/README.md"
  # Where the weights sit inside the repository is the repository's business, not the quant's: ISTA-DASLab puts
  # each size in its own folder, UkisAI puts Swift's at the root. The config says which, and backend_fetch_model
  # must use it. On 5 Oct 2026 the base URL hard-coded the quant folder and the Swift download fetched nothing.
  assert_ok "the config says where the weights sit in the repository (MODEL_REPO_SUBDIR, possibly empty)" bash -c "
    grep -qE '^MODEL_REPO_SUBDIR=' '$CFG'"
  assert_ok "the README names the Strata version the config pins" bash -c "
    . '$CFG'; grep -qF \"v\$STRATA_VERSION\" '$RM'"
  assert_ok "...and the commit it pins, by its short form" bash -c "
    . '$CFG'; grep -qF \"\${STRATA_COMMIT:0:8}\" '$RM'"
  assert_ok "...and the weights revision" bash -c "
    . '$CFG'; grep -qF \"\${MODEL_REVISION:0:8}\" '$RM'"
done
COMBO="${COMBOS[0]}"; CFG="$REPO_ROOT/combinations/$COMBO/config.sh"

echo
echo "the pinned checkout"
BH="$WORK/bhome"; mkdir -p "$BH/stubs"
cat > "$BH/stubs/git" <<'STUB'
#!/usr/bin/env bash
echo "git $*" >> "$GIT_LOG"
case "$1" in
  clone) mkdir -p "${@: -1}/.git" ;;
  -C) shift 2; case "$1" in
        rev-parse)
          # The commit before the checkout, then the pinned one, so a move between commits can be exercised.
          if [[ -n "${FAKE_COMMIT_BEFORE:-}" && ! -e "${GIT_LOG}.seen" ]]; then
            : > "${GIT_LOG}.seen"; echo "${FAKE_COMMIT_BEFORE}"
          else echo "${FAKE_COMMIT}"; fi ;;
        *) : ;;
      esac ;;
esac
exit 0
STUB
chmod +x "$BH/stubs/git"
checkout() { # prints the directory it made; why it failed is in $WORK/checkout.out
  ( HOME="$BH"; PATH="$BH/stubs:/usr/bin:/bin"; export GIT_LOG="$WORK/git.log"
    export FAKE_COMMIT="${FAKE_COMMIT:-$(bash -c ". '$CFG'; echo \$STRATA_COMMIT")}"
    . "$REPO_ROOT/lib/common.sh"; . "$CFG"; . "$LIB"
    _strata_checkout_pinned >"$WORK/checkout.out" 2>&1 || exit 1
    printf '%s' "$STRATA_DIR" )
}
PIN="$(bash -c ". '$CFG'; echo \$STRATA_COMMIT")"
out="$(checkout)"
assert_eq "it lives under HOME, in the install's own folder" "$BH/.local/share/awesome-local-ai/strata/Strata" "$out"
assert_ok "it was cloned from the upstream repository" grep -qF "git clone https://github.com/Niko1221/Strata.git" "$WORK/git.log"
assert_ok "...and checked out at exactly the pinned commit" grep -qF "checkout --detach $PIN" "$WORK/git.log"
assert_fails "a checkout that reports another commit is refused" env FAKE_COMMIT=0123456789012345678901234567890123456789 bash -c "$(declare -f checkout); BH='$BH' WORK='$WORK' CFG='$CFG' LIB='$LIB' REPO_ROOT='$REPO_ROOT'; checkout"
assert_ok "...as a commit mismatch" grep -q 'commit mismatch' "$WORK/checkout.out"

# A build tree left by another commit is discarded: cmake caches the source configuration, and one configured for an
# earlier commit generated a tree with no "strata" target when 0.1.36 moved to 0.1.39 (5 Oct 2026).
SD="$BH/.local/share/awesome-local-ai/strata/Strata"
rm -f "$WORK/git.log.seen"; mkdir -p "$SD/build" "$SD/build-vision"; : > "$SD/build/CMakeCache.txt"
( FAKE_COMMIT_BEFORE=0123456789012345678901234567890123456789; export FAKE_COMMIT_BEFORE; checkout >/dev/null )
assert_ok "a build tree from another commit is discarded" bash -c "[[ ! -e '$SD/build' && ! -e '$SD/build-vision' ]]"
rm -f "$WORK/git.log.seen"; mkdir -p "$SD/build"; : > "$SD/build/CMakeCache.txt"
( checkout >/dev/null )
assert_ok "...and kept when the commit has not moved" bash -c "[[ -e '$SD/build/CMakeCache.txt' ]]"

echo
echo "the ranged download"
SRC="$WORK/src"; DST="$WORK/dst"; mkdir -p "$SRC" "$DST"
head -c 5000 /dev/urandom > "$SRC/a.gguf"; head -c 3001 /dev/urandom > "$SRC/b.gguf"
SIZE_A=5000; SIZE_B=3001
HASH_A="$(shasum -a 256 "$SRC/a.gguf" | cut -d' ' -f1)"; HASH_B="$(shasum -a 256 "$SRC/b.gguf" | cut -d' ' -f1)"
download() { # file size sha
  ( . "$REPO_ROOT/lib/common.sh"; . "$LIB"
    STRATA_SEG_BYTES=1024; STRATA_CONNECTIONS=4; STRATA_DL_PASSES=2
    strata_download "file://$SRC" "$DST" "$1" "$2" "$3" >"$WORK/dl.out" 2>&1 )
}
assert_ok "a file fetched in segments is joined into the right bytes" download a.gguf "$SIZE_A" "$HASH_A"
assert_eq "...and is byte for byte the source" "$HASH_A" "$(shasum -a 256 "$DST/a.gguf" | cut -d' ' -f1)"
assert_fails "no segment files are left behind" test -e "$DST/segs"
assert_ok "an odd final segment (3001 bytes) is joined too" download b.gguf "$SIZE_B" "$HASH_B"
assert_eq "...exactly" "$HASH_B" "$(shasum -a 256 "$DST/b.gguf" | cut -d' ' -f1)"
n="$(stat -c %Y "$DST/a.gguf" 2>/dev/null || stat -f %m "$DST/a.gguf")"
assert_ok "a file already there with the right hash is not fetched again" download a.gguf "$SIZE_A" "$HASH_A"
assert_eq "...it is left untouched" "$n" "$(stat -c %Y "$DST/a.gguf" 2>/dev/null || stat -f %m "$DST/a.gguf")"
rm -f "$DST/b.gguf"
assert_fails "a download whose bytes do not match the published hash is refused" download b.gguf "$SIZE_B" "$(printf '0%.0s' {1..64})"
assert_ok "...as a sha256 mismatch" grep -q 'sha256 mismatch for b.gguf' "$WORK/dl.out"
assert_fails "...and is not left in place as if it were good" test -e "$DST/b.gguf"
assert_fails "a file that is not at the source is refused" download missing.gguf 100 "$HASH_A"

echo
echo "the server's configuration"
SC="$WORK/setup.json"
cat > "$SC" <<'JSON'
{"exe": "/x/engine/strata", "args": ["--pack", "/x/pack", "--native", "/x/a.gguf", "--max-context", "4096", "--kv", "int8"],
 "cwd": "/x", "model_name": "qwen3.8-flash-next-iq3_xxs", "port": 8080, "gpu": 0, "log": "/x/old.log"}
JSON
derive() { ( . "$REPO_ROOT/lib/common.sh"; . "$LIB"; strata_run_config "$SC" "$WORK/run.json" "$@" ); }
assert_ok "a run configuration is derived from the one setup wrote" derive 131072 969 "$WORK/server.log" bench-id
J() { python3 -c "import json,sys; d=json.load(open('$WORK/run.json')); print(eval(sys.argv[1]))" "$1"; }
assert_eq "the context is the profile's, not setup's" 131072 "$(J "d['args'][d['args'].index('--max-context')+1]")"
assert_eq "the VRAM reserve is added to the engine's arguments" 969 "$(J "d['args'][d['args'].index('--vram-reserve-mib')+1]")"
assert_eq "everything else setup chose is kept" "--pack|--native" "$(J "'|'.join([a for a in d['args'] if a in ('--pack','--native')])")"
assert_eq "the served model name is the benchmark's" bench-id "$(J "d['model_name']")"
assert_eq "the log goes where the harness reads it" "$WORK/server.log" "$(J "d['log']")"
assert_eq "sampling defaults are the checkpoint's: temperature" 1.0 "$(J "d['sampling']['temperature']")"
assert_eq "...top_p" 0.95 "$(J "d['sampling']['top_p']")"
assert_eq "...top_k" 20 "$(J "d['sampling']['top_k']")"
assert_ok "setup's own file is not changed" grep -q '"--max-context", "4096"' "$SC"
derive 131072 969 "$WORK/server.log" bench-id
assert_eq "deriving twice does not add the reserve twice" 1 "$(J "d['args'].count('--vram-reserve-mib')")"

echo
echo "where the weights are fetched from"
. "$REPO_ROOT/lib/strata.sh" 2>/dev/null || true
assert_eq "a repository that gives each size its own folder" \
  "https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF/resolve/ed59f920/IQ3_XXS" \
  "$(strata_weights_base_url ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF ed59f920 IQ3_XXS)"
assert_eq "a repository that keeps them at the root: no trailing slash, no quant folder" \
  "https://huggingface.co/ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF/resolve/b22d729e" \
  "$(strata_weights_base_url ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF b22d729e "")"
assert_eq "...and the same when the folder is unset" \
  "https://huggingface.co/r/resolve/abc" "$(strata_weights_base_url r abc)"

# ...and that the fetch actually uses it. Asserting the helper alone passes while backend_fetch_model goes on
# building its own URL, which is how the Swift download came to fetch nothing: strata_download is stubbed here to
# record the base it is handed.
fetch_base() {
  ( set +u
    . "$REPO_ROOT/lib/common.sh"; . "$REPO_ROOT/lib/strata.sh"
    . "$REPO_ROOT/combinations/$1/config.sh"
    STRATA_DIR="$WORK/fake-strata"; STRATA_DATA_DIR="$WORK/fake-data"
    _strata_require_disk() { :; }
    _strata_run_setup() { :; }
    strata_download() { printf '%s\n' "$1" > "$WORK/fetch-base"; }
    backend_fetch_model >/dev/null 2>&1
    cat "$WORK/fetch-base" )
}
assert_eq "the fetch uses it: the folder repository" \
  "https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF/resolve/ed59f92082b1e93c0e96d60a8b11aab089b52f09/IQ3_XXS" \
  "$(fetch_base "qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi")"
assert_eq "the fetch uses it: the root repository" \
  "https://huggingface.co/ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF/resolve/b22d729eae29b5796f76fb70f91aef549b9fc52c" \
  "$(fetch_base "qwen/3.8-swift-1.5/flash-next/ubuntu/nvidia4090/strata-pi")"

echo
echo "the launcher (lib/runtime/server-strata.sh)"
LH="$WORK/lhome"; X="$LH/.local/share/x"; S="$LH/.local/share/awesome-local-ai/strata/Strata"; mkdir -p "$LH/bin" "$X" "$S/serve" "$S/.venv/bin"
cp "$SC" "$S/strata-iq3_xxs.json"
: > "$S/serve/server.py"
( set -e; HOME="$LH"; . "$REPO_ROOT/lib/common.sh"; . "$CFG"; . "$LIB"
  { printf 'INSTALL_ID=%q\nDISPLAY_NAME=%q\nBACKEND=strata\nACCEL=cuda\n' "$INSTALL_ID" "$DISPLAY_NAME"
    printf 'MODEL_ALIAS_DEFAULT=%q\nDEFAULT_PROFILE=%q\nDEFAULT_PORT=%q\nSERVER_CMD=test-server\n' "$MODEL_ALIAS_DEFAULT" "$DEFAULT_PROFILE" "$DEFAULT_PORT"
    printf 'REASONING_EFFORT_DEFAULT=%q\nSAMPLING_THINKING=%q\n' "$REASONING_EFFORT_DEFAULT" "$SAMPLING_THINKING"
    STRATA_DIR="$LH/.local/share/awesome-local-ai/strata/Strata"; backend_manifest_extra; } > "$X/install.env"
  cp "$REPO_ROOT/combinations/$COMBO/profiles.tsv" "$REPO_ROOT/combinations/$COMBO/help.txt" "$X/" )
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" > "$ARGV"\nexit 0\n' > "$S/.venv/bin/python"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "${FREE_VRAM_MIB:-24000}"\n' > "$LH/bin/nvidia-smi"
printf '#!/usr/bin/env bash\nprintf "              total        used        free      shared  buff/cache   available\\nMem:          63000       10000       20000           0       33000       %%s\\n" "${AVAIL_MIB:-52000}"\n' > "$LH/bin/free"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "${PS_OUT:-}"\n' > "$LH/bin/ps"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" > "$TAILARGS"\nexit 0\n' > "$LH/bin/tail"
chmod +x "$LH/bin/"* "$S/.venv/bin/python"
ARGV="$WORK/argv"; TAILARGS="$WORK/tailargs"
launch() { env -i PATH="$LH/bin:/usr/bin:/bin" HOME="$LH" LOCAL_AI_INSTALL_REL=.local/share/x ARGV="$ARGV" TAILARGS="$TAILARGS" PORT=18960 "$@" bash "$LAUNCHER" >"$WORK/launch.out" 2>&1; }
pair() { awk -v a="$2" -v b="$3" 'p==a && $0==b {f=1} {p=$0} END{exit !f}' "$1"; }

rm -f "$ARGV"; launch
assert_ok "it runs Strata's own server script" grep -qxF "$S/serve/server.py" "$ARGV"
assert_ok "...with the strata engine" pair "$ARGV" --engine strata
assert_ok "...bound to loopback only (no API key)" pair "$ARGV" --host 127.0.0.1
assert_ok "...on the port asked for" pair "$ARGV" --port 18960
assert_ok "...with the derived configuration, not setup's" bash -c "grep -xF -- --config '$ARGV' >/dev/null && grep -q 'strata-run.json' '$ARGV'"
assert_ok "the derived configuration carries the full context and the VRAM reserve" bash -c "python3 - '$X/strata-run.json' <<'PY'
import json, sys
a = json.load(open(sys.argv[1]))['args']
assert a[a.index('--max-context')+1] == '131072' and a[a.index('--vram-reserve-mib')+1] == '969'
PY"
assert_ok "reasoning effort low is set for clients that name none (pi sends none)" grep -q '"reasoning_effort": "low"' "$X/strata-run.shared-settings.json"
sleep 0.3
assert_ok "the engine's own log is followed into the server's output (the harness reads draft figures from it)" bash -c "grep -qxF -- -F '$TAILARGS' && grep -q 'strata-engine.log' '$TAILARGS'"
assert_ok "...and stops when the server does" grep -q -- '--pid=' "$TAILARGS"
rm -f "$ARGV"; launch PORT=18961 CTX=65536
assert_ok "CTX overrides the profile's context" bash -c "python3 - '$X/strata-run.json' <<'PY'
import json, sys
a = json.load(open(sys.argv[1]))['args']
assert a[a.index('--max-context')+1] == '65536'
PY"
rm -f "$ARGV"
assert_fails "a non-loopback bind is refused" launch HOST=0.0.0.0
assert_fails "an unknown profile is refused" launch PROFILE=nope
assert_fails "another model server running -> refused" launch PS_OUT="  4242 /x/llama-server -m m.gguf --port 8010"
assert_ok "...the refusal names it" grep -q 'llama-server' "$WORK/launch.out"
assert_fails "...and Strata never started" test -f "$ARGV"
# The gate is a floor, not the peak. Strata sizes its expert cache to what is free (--expert-cache auto), so the most
# it will use is not a precondition: on 5 Oct 2026 it refused 23,525 MiB free against a 23,955 MiB peak, while the same
# build ran in 16.5 GiB and answered a 108k-token prompt with the same prompt reuse (A-045).
rm -f "$ARGV"; launch FREE_VRAM_MIB=20000
assert_ok "VRAM above the floor but below the measured peak still starts: the expert cache sizes itself" test -f "$ARGV"
assert_fails "less VRAM than the floor is refused" launch FREE_VRAM_MIB=12000
assert_ok "...saying how much is free and how little it needs" grep -qE '12000 MiB.*1[0-9]{4}|1[0-9]{4} MiB.*12000' "$WORK/launch.out"
assert_fails "less RAM available than the model's resident set is refused" launch AVAIL_MIB=30000
assert_ok "...naming the RAM" grep -q 'RAM' "$WORK/launch.out"
rm -f "$ARGV"; launch ALLOW_COEXIST=1 PS_OUT="  4242 /x/llama-server -m m.gguf"
assert_ok "ALLOW_COEXIST=1 overrides the other-server refusal" test -f "$ARGV"
rm -f "$ARGV"
env -i PATH="$LH/bin:/usr/bin:/bin" HOME="$LH" LOCAL_AI_INSTALL_REL=.local/share/x ARGV="$ARGV" bash "$LAUNCHER" --help >"$WORK/launch.out" 2>&1
assert_fails "--help runs nothing" test -f "$ARGV"
assert_ok "--help renders the profile table" grep -qE '^  agent +131072 ctx' "$WORK/launch.out"

echo
echo "root installer"
INST="$REPO_ROOT/install-$(printf '%s' "$COMBO" | tr '/' '-').sh"
assert_ok "it exists and is executable" test -x "$INST"
assert_ok "it points at this combination" grep -qxF "COMBINATION=\"$COMBO\"" "$INST"
assert_ok "it parses" bash -n "$INST"
assert_ok "the module parses" bash -n "$LIB"
assert_ok "the launcher parses" bash -n "$LAUNCHER"

finish

# Every variable the CUDA install path reads must be declared by the config: an undeclared one is an "unbound
# variable" crash in the installer, not a message. Found on 5 Oct 2026, when the first real install of this
# combination stopped at lib/accel/cuda.sh line 22 with MIN_DRIVER_VERSION unbound.
for v in $(grep -ohE '\$\{?MIN_DRIVER_VERSION\b|\$\{?CUDA_ARCH\b' "$REPO_ROOT/lib/accel/cuda.sh" | tr -d '${' | sort -u); do
  assert_ok "the config declares $v, which the CUDA install path reads" \
    bash -c ". '$CFG' >/dev/null 2>&1; [[ -n \"\${$v:-}\" ]]"
done

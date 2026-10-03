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
COMBO="qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi"
CFG="$REPO_ROOT/combinations/$COMBO/config.sh"
LAUNCHER="$REPO_ROOT/lib/runtime/server-strata.sh"
LIB="$REPO_ROOT/lib/strata.sh"

echo "combination config"
assert_ok "the combination exists with its four files" bash -c "cd '$REPO_ROOT/combinations/$COMBO' && test -f config.sh -a -f profiles.tsv -a -f help.txt -a -f README.md"
assert_ok "opts out of automatic selection"          grep -qE '^AUTO_SELECT=0$' "$CFG"
assert_ok "backend is strata"                        grep -qE '^BACKEND="strata"' "$CFG"
assert_ok "the client is pi"                         grep -qE '^CLIENT="\$\{CLIENT:-pi\}"' "$CFG"
assert_ok "Strata pinned to a full commit"           grep -qE '^STRATA_COMMIT="[0-9a-f]{40}"' "$CFG"
assert_ok "...which is the v0.1.36 release"          grep -qE '^STRATA_VERSION="0\.1\.36"' "$CFG"
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
assert_ok "every profile row has 6 columns" bash -c "awk -F'|' '!/^[[:space:]]*(#|\$)/ && NF!=6 {bad=1} END{exit bad}' '$PT'"
assert_eq "the default profile serves the full 131072" 131072 "$(awk -F'|' -v p="$(bash -c ". '$CFG'; echo \$DEFAULT_PROFILE")" '$1==p{print $2}' "$PT")"
assert_ok "the profile's memory figures are labelled MEASURED, with the date" bash -c "awk -F'|' '!/^[[:space:]]*(#|\$)/ && \$5 !~ /^MEASURED-2026-10-02\$/ {bad=1} END{exit bad}' '$PT'"
assert_fails "no home paths in the combination or the module (machine names: tests/privacy-test.sh)" \
  grep -rIEn '/Users/|/home/[a-z]' "$REPO_ROOT/combinations/$COMBO" "$LIB" "$LAUNCHER"

echo
echo "the pinned checkout"
BH="$WORK/bhome"; mkdir -p "$BH/stubs"
cat > "$BH/stubs/git" <<'STUB'
#!/usr/bin/env bash
echo "git $*" >> "$GIT_LOG"
case "$1" in
  clone) mkdir -p "${@: -1}/.git" ;;
  -C) shift 2; case "$1" in rev-parse) echo "${FAKE_COMMIT}" ;; *) : ;; esac ;;
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
chmod +x "$LH/bin/"* "$S/.venv/bin/python"
ARGV="$WORK/argv"
launch() { env -i PATH="$LH/bin:/usr/bin:/bin" HOME="$LH" LOCAL_AI_INSTALL_REL=.local/share/x ARGV="$ARGV" PORT=18960 "$@" bash "$LAUNCHER" >"$WORK/launch.out" 2>&1; }
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
assert_fails "less than the VRAM the model needs is refused" launch FREE_VRAM_MIB=20000
assert_ok "...saying how much is free and how much it needs" grep -qE '20000 MiB.*2[0-9]{4}|2[0-9]{4} MiB.*20000' "$WORK/launch.out"
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

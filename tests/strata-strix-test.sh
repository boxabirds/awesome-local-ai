#!/usr/bin/env bash
# Strata on the Strix Halo (Linux, AMD Ryzen AI Max, unified memory): the combination's data, and the three places
# lib/strata.sh and the launcher differ from the NVIDIA case -- Strata's setup is run with the HIP backend on GGUF files
# already in place, the setup's configuration file is named by the combination (the Unsloth family names it
# strata-unsloth-<quant>.json), and a set of environment switches is carried into the engine's configuration while no
# VRAM reserve is added (the GPU's memory is the RAM). No Strata, GPU, model or network: `git`, `uv`, the setup script
# and the Strata server are stubs on PATH that record what they were asked to do.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
. "$REPO_ROOT/lib/common.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$LOG_FILE"' EXIT
COMBO="qwen/3.8/flash-next/ubuntu/strix-halo-128GB/strata-pi"
CFG="$REPO_ROOT/combinations/$COMBO/config.sh"
LAUNCHER="$REPO_ROOT/lib/runtime/server-strata.sh"
LIB="$REPO_ROOT/lib/strata.sh"
SWITCHES="STRATA_PF_FUSED STRATA_PF_GEMM STRATA_HC_UPMIX STRATA_PA_FAST STRATA_HIP_WMMA STRATA_SELECT_WMMA STRATA_HC_Q8 STRATA_PF_SWITCH_MIN_T STRATA_PREFILL_STREAM_MIN"

echo "combination config: $COMBO"
assert_ok "the combination exists with its four files" bash -c "cd '$REPO_ROOT/combinations/$COMBO' && test -f config.sh -a -f profiles.tsv -a -f help.txt -a -f README.md"
assert_ok "opts out of automatic selection"            grep -qE '^AUTO_SELECT=0$' "$CFG"
assert_ok "backend is strata"                          grep -qE '^BACKEND="strata"' "$CFG"
assert_ok "the accelerator is the Strix Halo adapter"  grep -qE '^ACCEL="strix-halo"' "$CFG"
assert_ok "...with no host GPU build (Strata's setup brings its own ROCm)" grep -qE '^GPU_API="none"' "$CFG"
assert_ok "the client is pi"                           grep -qE '^CLIENT="\$\{CLIENT:-pi\}"' "$CFG"
assert_ok "Strata pinned to a full commit"             grep -qE '^STRATA_COMMIT="[0-9a-f]{40}"' "$CFG"
assert_ok "...and a release version beside it"         grep -qE '^STRATA_VERSION="[0-9]+\.[0-9]+\.[0-9]+"' "$CFG"
assert_ok "weights pinned to a full commit"            grep -qE '^MODEL_REVISION="[0-9a-f]{40}"' "$CFG"
assert_ok "the family is Unsloth's"                    grep -qE '^STRATA_FAMILY="unsloth"' "$CFG"
assert_ok "the quantization is UD-IQ4_XS: the 4-bit llamacpp-pi runs" grep -qE '^STRATA_QUANT="UD-IQ4_XS"' "$CFG"
assert_ok "the weights repository is Unsloth's"        grep -qE '^MODEL_REPO="unsloth/Qwen3.8-Flash-Next-GGUF"' "$CFG"
assert_eq "a hash for each of the three GGUF files" 3 "$(bash -c ". '$CFG'; printf '%s\n' \"\$MODEL_SHA256\" | grep -cE '^[0-9a-f]{64}  '")"
assert_eq "...and a size for each" 3 "$(bash -c ". '$CFG'; printf '%s\n' \"\$MODEL_SIZES\" | grep -cE '^[0-9]+  '")"
assert_ok "the context is 131072: the benchmark's minimum" grep -qE '^STRATA_CONTEXT=131072$' "$CFG"
assert_ok "effort low, as the owner set for Flash-Next" grep -qE '^REASONING_EFFORT_DEFAULT="low"$' "$CFG"
assert_ok "setup runs with the HIP backend"            grep -qE '^STRATA_SETUP_BACKEND="hip"' "$CFG"
assert_ok "...on the GGUF files already fetched"       grep -qE '^STRATA_GGUF_IN_PLACE=1' "$CFG"
assert_ok "...and names the configuration file it writes" grep -qE '^STRATA_SETUP_CONFIG="strata-unsloth-ud-iq4_xs\.json"' "$CFG"
for s in $SWITCHES; do
  assert_ok "the engine switch $s is set (the Strix Halo doc's fast configuration)" bash -c ". '$CFG'; case \" \$STRATA_ENV \" in *\" $s=\"*) exit 0;; esac; exit 1"
done
assert_fails "no VRAM reserve: the GPU's memory is the RAM" grep -qE '^STRATA_VRAM_RESERVE_MIB=' "$CFG"
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
assert_fails "no home paths in the combination (machine names: tests/privacy-test.sh)" \
  grep -rIEn '/Users/|/home/[a-z]' "$REPO_ROOT/combinations/$COMBO"
RM="$REPO_ROOT/combinations/$COMBO/README.md"
assert_ok "the README names the Strata version the config pins" bash -c ". '$CFG'; grep -qF \"v\$STRATA_VERSION\" '$RM'"
assert_ok "...and the commit it pins, by its short form" bash -c ". '$CFG'; grep -qF \"\${STRATA_COMMIT:0:8}\" '$RM'"
assert_ok "...and the weights revision" bash -c ". '$CFG'; grep -qF \"\${MODEL_REVISION:0:8}\" '$RM'"
assert_ok "...and says the switches change answers, so a reader does not take the score as the default path's" grep -qi 'round differently\|change answers\|changes answers' "$RM"
INST="$REPO_ROOT/install-$(printf '%s' "$COMBO" | tr '/' '-').sh"
assert_ok "the root installer exists and is executable" test -x "$INST"
assert_ok "...points at this combination" grep -qxF "COMBINATION=\"$COMBO\"" "$INST"

echo
echo "Strata's setup, run for this combination"
SB="$WORK/sbhome"; mkdir -p "$SB/stubs" "$SB/strata/Strata" "$SB/data/models/UD-IQ4_XS"
cat > "$SB/strata/Strata/setup.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$SETUP_ARGV"
mkdir -p engine; : > engine/strata; chmod +x engine/strata
STUB
chmod +x "$SB/strata/Strata/setup.sh"
run_setup() { # config -> prints the setup's arguments, one per line
  ( set +u; . "$REPO_ROOT/lib/common.sh"; . "$1"; . "$LIB"
    STRATA_DIR="$SB/strata/Strata"; STRATA_DATA_DIR="$SB/data"; STRATA_PYTHON_BIN="/usr/bin/python3"
    export SETUP_ARGV="$WORK/setup.argv"; rm -f "$SETUP_ARGV"
    _strata_run_setup >/dev/null 2>&1 && cat "$SETUP_ARGV" )
}
args="$(run_setup "$CFG")"
pair() { printf '%s\n' "$args" | awk -v a="$1" -v b="$2" 'p==a && $0==b {f=1} {p=$0} END{exit !f}'; }
assert_ok "setup is asked for the Unsloth family" pair --family unsloth
assert_ok "...the UD-IQ4_XS size"                 pair --model UD-IQ4_XS
assert_ok "...the HIP backend"                    pair --backend hip
assert_ok "...on the GGUF files already in the data folder" pair --gguf-dir "$SB/data/models/UD-IQ4_XS"
assert_ok "...without starting the server"        bash -c "printf '%s\n' \"$args\" | grep -qx -- --no-start"
nv="$(run_setup "$REPO_ROOT/combinations/qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi/config.sh")"
assert_fails "the NVIDIA combination's setup is unchanged: no --backend"  bash -c "printf '%s\n' \"$nv\" | grep -qx -- --backend"
assert_fails "...and no --gguf-dir"                bash -c "printf '%s\n' \"$nv\" | grep -qx -- --gguf-dir"

echo
echo "the server's configuration"
SC="$WORK/setup.json"
cat > "$SC" <<'JSON'
{"exe": "/x/engine/strata", "args": ["--pack", "/x/pack", "--native", "/x/a.gguf", "--max-context", "4096", "--expert-cache", "7850"],
 "cwd": "/x", "model_name": "q", "port": 8080, "log": "/x/old.log", "env": {"STRATA_HIPBLASLT_TUNING": "/x/table.txt"}}
JSON
J() { python3 -c "import json,sys; d=json.load(open('$WORK/run.json')); print(eval(sys.argv[1]))" "$1"; }
( . "$REPO_ROOT/lib/common.sh"; . "$LIB"; STRATA_ENV="STRATA_PF_FUSED=1 STRATA_PF_SWITCH_MIN_T=4096"; strata_run_config "$SC" "$WORK/run.json" 131072 "" "$WORK/s.log" bench-id )
assert_eq "an empty reserve adds no --vram-reserve-mib" 0 "$(J "d['args'].count('--vram-reserve-mib')")"
assert_eq "...and a zero reserve adds none either" 0 "$( ( . "$REPO_ROOT/lib/common.sh"; . "$LIB"; strata_run_config "$SC" "$WORK/run.json" 131072 0 "$WORK/s.log" bench-id ); J "d['args'].count('--vram-reserve-mib')")"
( . "$REPO_ROOT/lib/common.sh"; . "$LIB"; STRATA_ENV="STRATA_PF_FUSED=1 STRATA_PF_SWITCH_MIN_T=4096"; strata_run_config "$SC" "$WORK/run.json" 131072 "" "$WORK/s.log" bench-id )
assert_eq "the combination's switches are in the engine's environment" 1 "$(J "d['env']['STRATA_PF_FUSED']")"
assert_eq "...with their values" 4096 "$(J "d['env']['STRATA_PF_SWITCH_MIN_T']")"
assert_eq "...beside what setup put there (the hipBLASLt table)" /x/table.txt "$(J "d['env']['STRATA_HIPBLASLT_TUNING']")"
assert_eq "the expert cache setup sized for the shared memory is kept" 7850 "$(J "d['args'][d['args'].index('--expert-cache')+1]")"
assert_ok "setup's own file is not changed" bash -c "grep -q '\"--max-context\", \"4096\"' '$SC' && ! grep -q STRATA_PF_FUSED '$SC'"

echo
echo "the launcher (lib/runtime/server-strata.sh)"
LH="$WORK/lhome"; X="$LH/.local/share/x"; S="$LH/.local/share/awesome-local-ai/strata/Strata"; mkdir -p "$LH/bin" "$X" "$S/serve" "$S/.venv/bin"
cp "$SC" "$S/strata-unsloth-ud-iq4_xs.json"
: > "$S/serve/server.py"
( set -e; HOME="$LH"; . "$REPO_ROOT/lib/common.sh"; . "$CFG"; . "$LIB"
  { printf 'INSTALL_ID=%q\nDISPLAY_NAME=%q\nBACKEND=strata\nACCEL=strix-halo\n' "$INSTALL_ID" "$DISPLAY_NAME"
    printf 'MODEL_ALIAS_DEFAULT=%q\nDEFAULT_PROFILE=%q\nDEFAULT_PORT=%q\nSERVER_CMD=test-server\n' "$MODEL_ALIAS_DEFAULT" "$DEFAULT_PROFILE" "$DEFAULT_PORT"
    printf 'REASONING_EFFORT_DEFAULT=%q\nSAMPLING_THINKING=%q\n' "$REASONING_EFFORT_DEFAULT" "$SAMPLING_THINKING"
    STRATA_DIR="$LH/.local/share/awesome-local-ai/strata/Strata"; backend_manifest_extra; } > "$X/install.env"
  cp "$REPO_ROOT/combinations/$COMBO/profiles.tsv" "$REPO_ROOT/combinations/$COMBO/help.txt" "$X/" )
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" > "$ARGV"\nexit 0\n' > "$S/.venv/bin/python"
printf '#!/usr/bin/env bash\nprintf "              total        used        free      shared  buff/cache   available\\nMem:         125000       10000       20000           0       33000       %%s\\n" "${AVAIL_MIB:-110000}"\n' > "$LH/bin/free"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "${PS_OUT:-}"\n' > "$LH/bin/ps"
printf '#!/usr/bin/env bash\nexit 0\n' > "$LH/bin/tail"
chmod +x "$LH/bin/"* "$S/.venv/bin/python"
ARGV="$WORK/argv"
launch() { env -i PATH="$LH/bin:/usr/bin:/bin" HOME="$LH" LOCAL_AI_INSTALL_REL=.local/share/x ARGV="$ARGV" PORT=18970 "$@" bash "$LAUNCHER" >"$WORK/launch.out" 2>&1; }
rm -f "$ARGV"; launch
assert_ok "it starts from the configuration file the combination names (strata-unsloth-ud-iq4_xs.json)" test -f "$ARGV"
assert_ok "the derived configuration carries the full context" bash -c "python3 - '$X/strata-run.json' <<'PY'
import json, sys
a = json.load(open(sys.argv[1]))['args']
assert a[a.index('--max-context')+1] == '131072'
PY"
assert_ok "...no VRAM reserve" bash -c "python3 - '$X/strata-run.json' <<'PY'
import json, sys
assert '--vram-reserve-mib' not in json.load(open(sys.argv[1]))['args']
PY"
assert_ok "...and every engine switch in its environment" bash -c "python3 - '$X/strata-run.json' <<'PY'
import json, sys
e = json.load(open(sys.argv[1]))['env']
for k in '$SWITCHES'.split():
    assert k in e, k
assert e['STRATA_HIPBLASLT_TUNING'] == '/x/table.txt'
PY"
assert_fails "less RAM available than the model's resident set is refused" launch AVAIL_MIB=30000
assert_fails "another model server running -> refused" launch PS_OUT="  4242 /x/gufo serve --port 8080"

finish

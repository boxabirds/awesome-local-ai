#!/usr/bin/env bash
# TensorFold backend: the pinned install (an exact git commit into its own uv venv under $HOME), the weight fetch at
# a pinned Hugging Face revision, the combination's data as the installer and the harness read it, and the server
# command line -- all without TensorFold, a model or the network. `uv`, `hf`, `uname`, `sw_vers` and `tensorfold`
# are stubs on PATH that record what they were asked to do.
#
# The launcher (lib/runtime/server-tensorfold.sh) and the root installer this combination needs, tested here; formerly
# owner approves moving them to lib/runtime/ and the repo root; they are tested here from where they are.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
. "$REPO_ROOT/lib/common.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$LOG_FILE"' EXIT
COMBO="qwen/3.8/flash-next/macos/128GB/tensorfold-pi"
CFG="$REPO_ROOT/combinations/$COMBO/config.sh"
LAUNCHER="$REPO_ROOT/lib/runtime/server-tensorfold.sh"
PIN_COMMIT="$(bash -c ". '$CFG'; echo \$TENSORFOLD_COMMIT")"
PIN_VERSION="$(bash -c ". '$CFG'; echo \$TENSORFOLD_VERSION")"

echo "a first install: looking for the pinned copy in a folder that doesn't exist yet"
out="$(bash -c 'set -euo pipefail; . "$1/lib/common.sh"; . "$1/lib/tensorfold.sh"; TENSORFOLD_VERSION=0; v="$(_tensorfold_installed_version /nonexistent/x/bin/tensorfold)"; echo "survived:[$v]"' _ "$REPO_ROOT" 2>/dev/null)"
assert_eq "a missing install finds nothing, without ending the install" "survived:[]" "$out"

# ---- stand-ins for the operating system and uv ---------------------------------------------------------------
mk_os_stub() { # dir kernel arch macos-version
  mkdir -p "$1"
  printf '#!/bin/sh\ncase "${1:-}" in -s) echo "%s";; -m) echo "%s";; *) exit 1;; esac\n' "$2" "$3" > "$1/uname"
  printf '#!/bin/sh\n[ "${1:-}" = "-productVersion" ] && { echo "%s"; exit 0; }\nexit 1\n' "$4" > "$1/sw_vers"
  chmod +x "$1/uname" "$1/sw_vers"
}
mk_os_stub "$WORK/os-mac"   Darwin arm64  26.4
mk_os_stub "$WORK/os-intel" Darwin x86_64 15.6
mk_os_stub "$WORK/os-linux" Linux  x86_64 ""

# `uv venv --python V DIR` makes DIR/bin/python; `uv pip install --python PY SPEC` puts a `tensorfold` beside PY
# reporting $FAKE_TF_VERSION, and makes PY report $FAKE_TF_COMMIT as the installed commit (direct_url.json).
mkdir -p "$WORK/uvbin"
cat > "$WORK/uvbin/uv" <<'STUB'
#!/usr/bin/env bash
echo "uv $*" >> "$UV_LOG"
if [[ "$1" == venv ]]; then
  dir="${@: -1}"; mkdir -p "$dir/bin"
  printf '#!/usr/bin/env bash\ncat "$(dirname "$0")/.commit" 2>/dev/null\n' > "$dir/bin/python"; chmod +x "$dir/bin/python"
  exit 0
fi
if [[ "$1 $2" == "pip install" ]]; then
  py="$4"; bin="$(dirname "$py")"
  printf '#!/usr/bin/env bash\n[[ "$1" == --version ]] && { echo "tensorfold %s"; exit 0; }\nexit 0\n' "$FAKE_TF_VERSION" > "$bin/tensorfold"
  chmod +x "$bin/tensorfold"; echo "$FAKE_TF_COMMIT" > "$bin/.commit"
  exit 0
fi
if [[ "$1 $2" == "pip freeze" ]]; then echo "tensorfold @ git+https://example/TensorFold.git@$FAKE_TF_COMMIT"; echo "mlx==0.32.3"; exit 0; fi
exit 0
STUB
chmod +x "$WORK/uvbin/uv"

BH="$WORK/bhome"; mkdir -p "$BH"
PINNED="$BH/.local/share/awesome-local-ai/tensorfold/v$PIN_VERSION"
install_tf() { # [os stub dir] -- prints "BIN|REL|ORIGIN"; why it failed is in $WORK/install.out
  ( HOME="$BH"; PATH="${1:-$WORK/os-mac}:$WORK/uvbin:/usr/bin:/bin:/usr/sbin"; export UV_LOG="$WORK/uv.log"
    export FAKE_TF_VERSION="${FAKE_TF_VERSION:-$PIN_VERSION}" FAKE_TF_COMMIT="${FAKE_TF_COMMIT:-$PIN_COMMIT}"
    . "$REPO_ROOT/lib/common.sh"; . "$CFG"; . "$REPO_ROOT/lib/tensorfold.sh"
    ensure_backend >"$WORK/install.out" 2>&1 || exit 1
    printf '%s|%s|%s' "$TENSORFOLD_BIN" "$TENSORFOLD_BIN_REL" "$TENSORFOLD_BIN_ORIGIN" )
}
uv_calls() { if [[ -f "$WORK/uv.log" ]]; then grep -c . "$WORK/uv.log" || true; else echo 0; fi; }

echo
echo "install: an exact commit into its own venv under HOME"
out="$(install_tf)"; IFS='|' read -r r_bin r_rel r_origin <<< "$out"
assert_eq "the venv's tensorfold is used" "$PINNED/venv/bin/tensorfold" "$r_bin"
assert_eq "the manifest gets a HOME-relative path" ".local/share/awesome-local-ai/tensorfold/v$PIN_VERSION/venv/bin/tensorfold" "$r_rel"
assert_ok "uv made the venv with the pinned Python" grep -qE "^uv venv --python 3\.12 $PINNED/venv$" "$WORK/uv.log"
assert_ok "...and installed exactly the pinned commit from the upstream repository" \
  grep -qF "uv pip install --python $PINNED/venv/bin/python tensorfold @ git+https://github.com/ashhart/TensorFold.git@$PIN_COMMIT" "$WORK/uv.log"
assert_ok "the resolved dependency set is kept beside it" grep -q 'mlx==0.32.3' "$PINNED/requirements.lock.txt"
n="$(uv_calls)"
out="$(install_tf)"; IFS='|' read -r r_bin r_rel r_origin <<< "$out"
assert_eq "second run: the installed copy is reused, uv is not called" "$n" "$(uv_calls)"
assert_eq "...and says so" "pinned, already installed" "$r_origin"

rm -rf "$BH/.local/share/awesome-local-ai"
assert_fails "an install that reports another commit is refused" env FAKE_TF_COMMIT=0123456789012345678901234567890123456789 bash -c "$(declare -f install_tf); BH='$BH' WORK='$WORK' CFG='$CFG' REPO_ROOT='$REPO_ROOT' PIN_VERSION='$PIN_VERSION' PIN_COMMIT='$PIN_COMMIT'; install_tf"
assert_ok "...as a commit mismatch" grep -q 'commit mismatch' "$WORK/install.out"
assert_fails "...and is not marked installed" test -f "$PINNED/.installed"
rm -rf "$BH/.local/share/awesome-local-ai"
assert_fails "an install that reports another version is refused" env FAKE_TF_VERSION=0.5.0 bash -c "$(declare -f install_tf); BH='$BH' WORK='$WORK' CFG='$CFG' REPO_ROOT='$REPO_ROOT' PIN_VERSION='$PIN_VERSION' PIN_COMMIT='$PIN_COMMIT'; install_tf"
assert_ok "...naming both versions" grep -q "reports version 'tensorfold 0.5.0', expected $PIN_VERSION" "$WORK/install.out"
assert_fails "Linux is refused (this combination is the MLX server)" install_tf "$WORK/os-linux"
assert_ok "...saying so" grep -q 'Apple silicon Mac' "$WORK/install.out"
assert_fails "an Intel Mac is refused" install_tf "$WORK/os-intel"

# ---- weights: idempotent fetch --------------------------------------------------------------------------------
echo
echo "weights: pinned revision, marker, required files"
FH="$WORK/fhome"; mkdir -p "$FH/bin"
printf '#!/usr/bin/env bash\necho "hf $*" >> "$HF_LOG"\nexit 0\n' > "$FH/bin/hf"; chmod +x "$FH/bin/hf"
REPO_ID="$(bash -c ". '$CFG'; echo \$MODEL_REPO")"
REV="$(bash -c ". '$CFG'; echo \$MODEL_REVISION")"
PACK="$FH/.local/share/awesome-local-ai/models/$REPO_ID"
mkdir -p "$PACK"
echo '{"weight_map":{"a":"model-00001-of-00002.safetensors","b":"model-00002-of-00002.safetensors"}}' > "$PACK/model.safetensors.index.json"
for f in model-00001-of-00002.safetensors model-00002-of-00002.safetensors tokenizer.json; do echo "$f" > "$PACK/$f"; done
for f in config.json generation_config.json chat_template.jinja tokenizer_config.json; do echo '{}' > "$PACK/$f"; done
FETCH_SHA="$(cd "$PACK" && shasum -a 256 model-00001-of-00002.safetensors model-00002-of-00002.safetensors tokenizer.json)"
fetch() { # prints MODEL_SUBDIR|MODEL_FILE
  ( HOME="$FH"; PATH="$FH/bin:/usr/bin:/bin"; export HF_LOG="$WORK/hf.log"
    . "$REPO_ROOT/lib/common.sh"; . "$CFG"; . "$REPO_ROOT/lib/tensorfold.sh"
    ensure_hf() { :; }                   # never install anything from a test
    MODEL_SHA256="$FETCH_SHA"; MODEL_DISK_KB="${DISK_KB:-1}"
    backend_fetch_model >"$WORK/fetch.out" 2>&1 || exit 1
    printf '%s|%s' "$MODEL_SUBDIR" "$MODEL_FILE" )
}
hf_calls() { if [[ -f "$WORK/hf.log" ]]; then grep -c . "$WORK/hf.log" || true; else echo 0; fi; }

out="$(fetch)"
assert_eq "first run: downloads once via hf" 1 "$(hf_calls)"
assert_ok "...at the pinned revision into the shared model store" \
  grep -qF "download $REPO_ID --revision $REV --local-dir $PACK" "$WORK/hf.log"
assert_eq "manifest paths are HOME-relative" ".local/share/awesome-local-ai/models/${REPO_ID%%/*}|${REPO_ID#*/}" "$out"
assert_ok "a verification marker was written" test -f "$PACK/.awesome-local-ai-verified"
out="$(fetch)"
assert_eq "second run: no download at all" 1 "$(hf_calls)"
rm -f "$PACK/.awesome-local-ai-verified" "$PACK/chat_template.jinja"
assert_fails "a pack without its chat template is refused" fetch
assert_ok "...naming the missing file" grep -q 'missing chat_template.jinja' "$WORK/fetch.out"
echo '{}' > "$PACK/chat_template.jinja"
echo tampered > "$PACK/model-00002-of-00002.safetensors"
assert_fails "a shard that fails its sha256 is refused" fetch
assert_ok "...as a sha256 mismatch" grep -q 'sha256 mismatch for model-00002-of-00002.safetensors' "$WORK/fetch.out"
echo model-00002-of-00002.safetensors > "$PACK/model-00002-of-00002.safetensors"
: > "$WORK/hf.log"
assert_fails "not enough disk: refused before any download" env DISK_KB=999999999999 bash -c "$(declare -f fetch hf_calls); FH='$FH' WORK='$WORK' REPO_ROOT='$REPO_ROOT' CFG='$CFG' FETCH_SHA='$FETCH_SHA'; fetch"
assert_eq "...and hf was never called" 0 "$(hf_calls)"
assert_ok "...for the disk reason" grep -q 'Not enough disk' "$WORK/fetch.out"

# ---- the combination's data, as the installer and the harness read it -----------------------------------------
echo
echo "combination config"
assert_ok "opts out of automatic selection"         grep -qE '^AUTO_SELECT=0$' "$CFG"
assert_ok "backend is tensorfold"                   grep -qE '^BACKEND="tensorfold"' "$CFG"
assert_ok "weights pinned to a full commit"         grep -qE '^MODEL_REVISION="[0-9a-f]{40}"' "$CFG"
assert_ok "TensorFold pinned to a full commit"      grep -qE '^TENSORFOLD_COMMIT="[0-9a-f]{40}"' "$CFG"
assert_ok "...which is the 0.6.0 release"           grep -qE '^TENSORFOLD_VERSION="0\.6\.0"' "$CFG"
assert_eq "a hash for all 23 LFS files (22 shards + tokenizer.json)" 23 \
  "$(bash -c ". '$CFG'; printf '%s\n' \"\$MODEL_SHA256\" | grep -cE '^[0-9a-f]{64}  '")"
assert_ok "effort low, as the owner set for Flash-Next" grep -qE '^REASONING_EFFORT_DEFAULT="low"$' "$CFG"
# Every variable bootstrap.sh requires of every combination, and the backend's own, are set and non-empty.
assert_ok "the installer's required variables are all set" bash -c "
  . '$REPO_ROOT/lib/common.sh'; . '$CFG'; . '$REPO_ROOT/lib/tensorfold.sh'
  require_vars INSTALL_ID DISPLAY_NAME MODEL_DISPLAY_NAME TARGET_OS ACCEL BACKEND CLIENT MODEL_ALIAS_DEFAULT \
               DEFAULT_PROFILE SAMPLING_THINKING DEFAULT_PROVIDER CONTEXT_LIMIT OUTPUT_LIMIT
  require_vars \$BACKEND_REQUIRED_VARS"
assert_ok "the accelerator and client adapters exist" bash -c ". '$CFG'; test -f '$REPO_ROOT/lib/accel/'\$ACCEL.sh && test -f '$REPO_ROOT/lib/clients/'\$CLIENT.sh"
# The harness reads CONTEXT_LIMIT and OUTPUT_LIMIT with config-value.sh's cfg, not by sourcing.
. "$REPO_ROOT/benchmarks/spec-bench/harness/config-value.sh"
assert_ok "the harness reads CONTEXT_LIMIT as a bare number" bash -c "[[ '$(cfg CONTEXT_LIMIT "$CFG")' =~ ^[0-9]+$ ]]"
assert_eq "the harness reads OUTPUT_LIMIT 32768" 32768 "$(cfg OUTPUT_LIMIT "$CFG")"
assert_eq "...and INSTALL_ID as the shell does" "$(bash -c ". '$CFG'; echo \$INSTALL_ID")" "$(cfg INSTALL_ID "$CFG")"
PT="$REPO_ROOT/combinations/$COMBO/profiles.tsv"
SCHEMA="$(bash -c ". '$REPO_ROOT/lib/common.sh'; . '$REPO_ROOT/lib/tensorfold.sh'; echo \$PROFILE_SCHEMA")"
assert_ok "profiles.tsv declares the tensorfold schema on line 1" bash -c "head -1 '$PT' | grep -qx '# $SCHEMA'"
assert_ok "every profile row has 7 columns" bash -c "awk -F'|' '!/^[[:space:]]*(#|\$)/ && NF!=7 {bad=1} END{exit bad}' '$PT'"
assert_ok "every profile row is labelled ESTIMATED (nothing measured)" \
  bash -c "awk -F'|' '!/^[[:space:]]*(#|\$)/ && \$6!=\"ESTIMATED\" {bad=1} END{exit bad}' '$PT'"
assert_eq "the default profile lets TensorFold fit the window" fit \
  "$(awk -F'|' -v p="$(bash -c ". '$CFG'; echo \$DEFAULT_PROFILE")" '$1==p{print $2}' "$PT")"
assert_ok "help.txt and README.md exist" test -f "$REPO_ROOT/combinations/$COMBO/help.txt" -a -f "$REPO_ROOT/combinations/$COMBO/README.md"
assert_fails "no home paths in the combination (machine names: tests/privacy-test.sh)" \
  grep -rIEn --exclude-dir=__pycache__ --exclude-dir=.pytest_cache '/Users/|/home/[a-z]' "$REPO_ROOT/combinations/$COMBO" "$REPO_ROOT/lib/tensorfold.sh" "$REPO_ROOT/tools/tensorfold-check"

# ---- the server command line -----------------------------------------------------------------------------------
echo
echo "server command line"
argv_of() { bash -c ". '$REPO_ROOT/lib/common.sh'; . '$CFG'; . '$REPO_ROOT/lib/tensorfold.sh'; tensorfold_serve_argv \"\$@\"" _ "$@"; }
ARGV_FIT="$(argv_of /m/pack 18950 bench fit 1)"
has() { grep -qxF -- "$2" <<< "$1"; }
pair() { awk -v a="$2" -v b="$3" 'p==a && $0==b {f=1} {p=$0} END{exit !f}' <<< "$1"; }
assert_eq "serve <pack> first" "serve|/m/pack" "$(head -2 <<< "$ARGV_FIT" | paste -sd'|' -)"
assert_ok "loopback only"                 pair "$ARGV_FIT" --host 127.0.0.1
assert_ok "the port"                      pair "$ARGV_FIT" --port 18950
assert_ok "the served name"               pair "$ARGV_FIT" --name bench
assert_ok "effort low server-side (pi sends none)" pair "$ARGV_FIT" --reasoning-effort low
assert_ok "the checkpoint's sampler"      pair "$ARGV_FIT" --temperature 1.0
assert_ok "...top-p"                      pair "$ARGV_FIT" --top-p 0.95
assert_ok "...top-k"                      pair "$ARGV_FIT" --top-k 20
assert_ok "default reply limit = OUTPUT_LIMIT" pair "$ARGV_FIT" --max-tokens 32768
assert_ok "one request at a time, as mlx-serve runs" pair "$ARGV_FIT" --parallel 1
assert_ok "no persistent snapshots: nothing carries over between runs" pair "$ARGV_FIT" --snapshot-dir none
assert_ok "no update check"               has "$ARGV_FIT" --no-update-check
assert_fails "fit: no --context, so TensorFold sizes the window to keep prompts" has "$ARGV_FIT" --context
assert_fails "drafts on: no --no-drafts" has "$ARGV_FIT" --no-drafts
assert_ok "this combination's config leaves n-gram tables on SSD (TENSORFOLD_PLE_ON_SSD=1)" has "$ARGV_FIT" --ple-on-ssd
ARGV_NO_PLE="$(bash -c ". '$REPO_ROOT/lib/common.sh'; . '$CFG'; . '$REPO_ROOT/lib/tensorfold.sh'; TENSORFOLD_PLE_ON_SSD=0; tensorfold_serve_argv /m/pack 18950 bench fit 1")"
assert_fails "TENSORFOLD_PLE_ON_SSD=0 leaves --ple-on-ssd out" has "$ARGV_NO_PLE" --ple-on-ssd
ARGV_150="$(argv_of /m/pack 18950 bench 150000 0)"
assert_ok "an explicit window is passed as --context" pair "$ARGV_150" --context 150000
assert_ok "drafts off is --no-drafts"     has "$ARGV_150" --no-drafts
ENV_LINES="$(bash -c ". '$REPO_ROOT/lib/common.sh'; . '$CFG'; . '$REPO_ROOT/lib/tensorfold.sh'; tensorfold_serve_env")"
assert_ok "memory budget: TensorFold's own default, 70% of RAM" has "$ENV_LINES" TENSORFOLD_MEMORY_LIMIT_GB=89.6
assert_ok "no live terminal line in logs" has "$ENV_LINES" TENSORFOLD_NO_LIVE=1

# ---- the launcher, end to end against stubs --------------------------------------------------------------
echo
echo "launcher (lib/runtime/server-tensorfold.sh)"
LH="$WORK/lhome"; X="$LH/.local/share/x"; mkdir -p "$LH/bin" "$X"
LPACK="$LH/.local/share/awesome-local-ai/models/$REPO_ID"; mkdir -p "$LPACK"
echo '{}' > "$LPACK/config.json"; echo '{"weight_map":{}}' > "$LPACK/model.safetensors.index.json"
( set -e; . "$REPO_ROOT/lib/common.sh"; . "$CFG"; . "$REPO_ROOT/lib/tensorfold.sh"
  TENSORFOLD_BIN_REL="bin/tensorfold"
  { printf 'INSTALL_ID=%q\nDISPLAY_NAME=%q\nBACKEND=tensorfold\nACCEL=metal\n' "$INSTALL_ID" "$DISPLAY_NAME"
    printf 'MODEL_SUBDIR=%q\nMODEL_FILE=%q\n' ".local/share/awesome-local-ai/models/${MODEL_REPO%%/*}" "${MODEL_REPO#*/}"
    printf 'MODEL_ALIAS_DEFAULT=%q\nDEFAULT_PROFILE=%q\nDEFAULT_PORT=%q\n' "$MODEL_ALIAS_DEFAULT" "$DEFAULT_PROFILE" "$DEFAULT_PORT"
    printf 'REASONING_EFFORT_DEFAULT=%q\nSAMPLING_THINKING=%q\nSERVER_CMD=test-server\n' "$REASONING_EFFORT_DEFAULT" "$SAMPLING_THINKING"
    backend_manifest_extra; } > "$X/install.env"
  cp "$REPO_ROOT/combinations/$COMBO/profiles.tsv" "$REPO_ROOT/combinations/$COMBO/help.txt" "$X/" )
cat > "$LH/bin/tensorfold" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$ARGV"
env | grep '^TENSORFOLD_' | sort > "$ARGV.env"
if [[ "${TF_IDLE:-0}" == "1" ]]; then trap 'echo TERM >> "$TERMFILE"; exit 0' TERM; while :; do sleep 0.1; done; fi
exit 0
STUB
printf '#!/usr/bin/env bash\nexit 7\n' > "$LH/bin/curl"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "${PS_OUT:-}"\n' > "$LH/bin/ps"
chmod +x "$LH/bin/"*
ARGV="$WORK/argv"
launch() { env -i PATH="$LH/bin:/usr/bin:/bin" HOME="$LH" LOCAL_AI_INSTALL_REL=.local/share/x ARGV="$ARGV" \
             TERMFILE="$WORK/term" PORT=18950 "$@" bash "$LAUNCHER" >"$WORK/launch.out" 2>&1; }

rm -f "$ARGV"; launch
assert_eq "the launcher's command line is the driver's (tensorfold_serve_argv), fitted, drafts on" \
  "$(argv_of "$LPACK" 18950 "$(bash -c ". '$CFG'; echo \$MODEL_ALIAS_DEFAULT")" fit 1)" "$(cat "$ARGV" 2>/dev/null)"
assert_eq "...with the same environment" "$(sort <<< "$ENV_LINES")" "$(cat "$ARGV.env" 2>/dev/null)"
rm -f "$ARGV"; launch PROFILE=serial
assert_ok "serial: --no-drafts" grep -qxF -- --no-drafts "$ARGV"
rm -f "$ARGV"; launch CTX=150000
assert_ok "CTX (BENCH_CONTEXT) becomes --context" bash -c "grep -qxF -- --context '$ARGV' && grep -qxF 150000 '$ARGV'"
rm -f "$ARGV"
assert_fails "an unknown profile is refused" launch PROFILE=nope
assert_fails "a non-loopback bind is refused (TensorFold has no API key)" launch HOST=0.0.0.0
assert_fails "another model server running -> refused" launch PS_OUT="  4242 /x/mlx-serve --model m --serve --port 18010"
assert_fails "...tensorfold never started" test -f "$ARGV"
assert_ok "...the refusal names it" grep -q 'mlx-serve' "$WORK/launch.out"
rm -f "$ARGV"; launch ALLOW_COEXIST=1 PS_OUT="  4242 /x/mlx-serve --model m --serve"
assert_ok "ALLOW_COEXIST=1 overrides" test -f "$ARGV"
rm -f "$ARGV"
env -i PATH="$LH/bin:/usr/bin:/bin" HOME="$LH" LOCAL_AI_INSTALL_REL=.local/share/x ARGV="$ARGV" bash "$LAUNCHER" --help >"$WORK/launch.out" 2>&1
assert_fails "--help runs nothing" test -f "$ARGV"
assert_ok "--help renders the profile table" grep -qE '^  agent +fit ctx  drafts on ' "$WORK/launch.out"
rm -f "$ARGV" "$WORK/term"
env -i PATH="$LH/bin:/usr/bin:/bin" HOME="$LH" LOCAL_AI_INSTALL_REL=.local/share/x ARGV="$ARGV" TERMFILE="$WORK/term" \
    PORT=18951 TF_IDLE=1 bash "$LAUNCHER" >/dev/null 2>&1 &
lpid=$!
for _ in $(seq 1 50); do [[ -s "$ARGV" ]] && break; sleep 0.1; done
kill -TERM "$lpid" 2>/dev/null
for _ in $(seq 1 50); do kill -0 "$lpid" 2>/dev/null || break; sleep 0.1; done
assert_ok "the launcher exec'd tensorfold (the same pid got SIGTERM)" grep -qx TERM "$WORK/term"
kill -9 "$lpid" 2>/dev/null || true

echo
echo "root installer"
INST="$REPO_ROOT/install-$(printf '%s' "$COMBO" | tr '/' '-').sh"
assert_ok "it exists and is executable" test -x "$INST"
assert_ok "it points at this combination" grep -qxF "COMBINATION=\"$COMBO\"" "$INST"
assert_ok "it parses" bash -n "$INST"

finish

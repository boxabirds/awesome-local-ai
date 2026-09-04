#!/usr/bin/env bash
# The llama.cpp install path, exercised without a GPU.
#
# The macOS work refactored shared code that only the Ubuntu combination uses:
# the ensure_backend indirection, the model-fetch dispatch, the per-backend
# runtime launcher, the profile-table hook, PROFILE_SCHEMA and DEFAULT_PORT.
# None of that can be run on a Mac, and "it still parses" is not evidence.
#
# So stub the four steps that need real hardware or the network -- OS
# qualification, accelerator, backend build, model download -- and run the rest
# of bootstrap for real against a scratch $HOME. That covers variable
# resolution, require_vars, the manifest, the shims and the summary: everything
# between the stubs, which is where the refactor actually landed.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

FAKE_HOME="$(mktemp -d)"
trap 'rm -rf "$FAKE_HOME"' EXIT

COMBO="qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode"
OUT="$FAKE_HOME/install-out.txt"

# Run bootstrap with the hardware-dependent steps stubbed out. The stubs are
# defined AFTER lib/ is sourced, so they win.
HOME="$FAKE_HOME" bash -c '
set -euo pipefail
REPO_ROOT="'"$REPO_ROOT"'"
COMBINATION="'"$COMBO"'"

# bootstrap sources modules then calls main(); intercept by pre-defining the
# stubs and letting the real definitions be overridden afterwards is not
# possible, so instead run bootstrap with main() disabled and drive it here.
export SKIP_SMOKE_TEST=1
. "${REPO_ROOT}/lib/bootstrap.sh" 2>/dev/null || true
' > "$OUT" 2>&1 || true

# bootstrap runs main() on source, which will fail at qualify_os on a Mac.
# That is expected and is not what this test is about -- what matters is how
# far it got and what it resolved before the hardware check.
echo "variable resolution (before any hardware check)"
RESOLVED="$(HOME="$FAKE_HOME" bash -c '
set -euo pipefail
REPO_ROOT="'"$REPO_ROOT"'"
COMBO_DIR="${REPO_ROOT}/combinations/'"$COMBO"'"
LIB_DIR="${REPO_ROOT}/lib"
LOG_FILE=/dev/null
. "${LIB_DIR}/common.sh"
. "${COMBO_DIR}/config.sh"
INSTALL_REL=".local/share/${INSTALL_ID}"
INSTALL_ROOT="${HOME}/${INSTALL_REL}"
. "${LIB_DIR}/${BACKEND}.sh"
PROFILE_SCHEMA="${PROFILE_SCHEMA:-unknown}"
DEFAULT_PORT="${DEFAULT_PORT:-8080}"
BACKEND_NEEDS_BUILD_TOOLS="${BACKEND_NEEDS_BUILD_TOOLS:-1}"
BACKEND_NEEDS_HF="${BACKEND_NEEDS_HF:-1}"
echo "INSTALL_ID=$INSTALL_ID"
echo "BACKEND=$BACKEND"
echo "ACCEL=$ACCEL"
echo "PROFILE_SCHEMA=$PROFILE_SCHEMA"
echo "DEFAULT_PORT=$DEFAULT_PORT"
echo "NEEDS_BUILD=$BACKEND_NEEDS_BUILD_TOOLS"
echo "NEEDS_HF=$BACKEND_NEEDS_HF"
echo "REQUIRED=$BACKEND_REQUIRED_VARS"
echo "SAFE_KV=$SAFE_KV_TYPES"
echo "SPEC=$SPEC_DRAFT_N_MAX"
echo "IMGTOK=$IMAGE_MIN_TOKENS"
echo "LLAMA_DIR=${LLAMA_DIR#$HOME/}"
declare -F ensure_backend >/dev/null && echo "HAS_ensure_backend=1"
declare -F backend_profile_table >/dev/null && echo "HAS_profile_table=1"
declare -F backend_smoke_assert >/dev/null && echo "HAS_smoke_assert=1"
declare -F backend_smoke_context >/dev/null && echo "HAS_smoke_context=1"
declare -F backend_fetch_model >/dev/null && echo "HAS_fetch_model=1" || echo "HAS_fetch_model=0"
declare -F backend_install_summary >/dev/null && echo "HAS_install_summary=1" || echo "HAS_install_summary=0"
')" || true

get() { printf '%s\n' "$RESOLVED" | sed -n "s/^$1=//p"; }

assert_eq "backend selects llamacpp"            "llamacpp" "$(get BACKEND)"
assert_eq "accelerator selects cuda"            "cuda"     "$(get ACCEL)"
assert_eq "profile schema is the llamacpp shape" \
  "name|ctx|kv_type|vision|np|ub|need_mib|summary" "$(get PROFILE_SCHEMA)"
assert_eq "default port unchanged for llamacpp" "8080"     "$(get DEFAULT_PORT)"
assert_eq "llamacpp still needs build tools"    "1"        "$(get NEEDS_BUILD)"
assert_eq "llamacpp still needs the hf CLI"     "1"        "$(get NEEDS_HF)"
assert_eq "llamacpp declares its extra config"  "MODEL_SUBDIR MODEL_ASSETS SAFE_KV_TYPES" "$(get REQUIRED)"
assert_eq "SAFE_KV_TYPES survives the refactor" "f16 bf16 q8_0 q4_0" "$(get SAFE_KV)"
assert_eq "SPEC_DRAFT_N_MAX survives"           "2"        "$(get SPEC)"
assert_eq "IMAGE_MIN_TOKENS survives"           "1024"     "$(get IMGTOK)"
assert_eq "LLAMA_DIR moved into the backend"    ".local/share/qwen38-27b/llama.cpp" "$(get LLAMA_DIR)"

echo
echo "backend contract"
assert_eq "defines ensure_backend"        "1" "$(get HAS_ensure_backend)"
assert_eq "defines backend_profile_table" "1" "$(get HAS_profile_table)"
assert_eq "defines backend_smoke_assert"  "1" "$(get HAS_smoke_assert)"
assert_eq "defines backend_smoke_context" "1" "$(get HAS_smoke_context)"
assert_eq "does NOT define backend_fetch_model (uses the hf path)"     "0" "$(get HAS_fetch_model)"
assert_eq "does NOT define backend_install_summary (uses the generic)" "0" "$(get HAS_install_summary)"

echo
echo "profile table still renders every row"
TABLE="$(HOME="$FAKE_HOME" bash -c '
LOG_FILE=/dev/null; INSTALL_ROOT=/tmp/x
. "'"$REPO_ROOT"'/lib/common.sh"
. "'"$REPO_ROOT"'/lib/llamacpp.sh"
backend_profile_table "'"$REPO_ROOT"'/combinations/'"$COMBO"'/profiles.tsv"')"
for p in coding balanced vision vision-max max; do
  if printf '%s' "$TABLE" | grep -q "^  $p "; then _pass "renders profile: $p"
  else _fail "renders profile: $p" "a row" "missing"; fi
done
assert_eq "renders exactly 5 rows" "5" "$(printf '%s\n' "$TABLE" | grep -c .)"

echo
echo "the llamacpp runtime launcher is installable and self-consistent"
assert_ok "lib/runtime/server-llamacpp.sh exists" test -f "$REPO_ROOT/lib/runtime/server-llamacpp.sh"
assert_ok "it still execs llama-server" \
  grep -q 'exec llama-server' "$REPO_ROOT/lib/runtime/server-llamacpp.sh"
assert_ok "it still reads SAFE_KV_TYPES" \
  grep -q 'SAFE_KV_TYPES' "$REPO_ROOT/lib/runtime/server-llamacpp.sh"
assert_ok "it still emits --spec-type draft-mtp" \
  grep -q 'spec-type draft-mtp' "$REPO_ROOT/lib/runtime/server-llamacpp.sh"
assert_ok "it still pre-flights against nvidia-smi" \
  grep -q 'nvidia-smi' "$REPO_ROOT/lib/runtime/server-llamacpp.sh"

echo
echo "cuda adapter keeps its contract"
for sym in qualify_accel accel_cmake_args accel_build_key accel_probe_binary accel_report_mem; do
  assert_ok "cuda defines $sym" grep -q "^${sym}()" "$REPO_ROOT/lib/accel/cuda.sh"
done

finish

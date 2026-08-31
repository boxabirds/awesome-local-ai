#!/usr/bin/env bash
# lib/bootstrap.sh -- the installer engine.
#
# Every root-level install-*.sh script is a pointer: it sets COMBINATION to a
# path under combinations/ and sources this file. Everything else -- resolving
# the config, ordering the install steps, wiring the accelerator and client
# adapters -- happens here, once, for all combinations.

set -euo pipefail

[[ -n "${COMBINATION:-}" ]] || { echo "bootstrap.sh: COMBINATION is not set." >&2; exit 1; }
[[ -n "${REPO_ROOT:-}"   ]] || { echo "bootstrap.sh: REPO_ROOT is not set." >&2; exit 1; }

LIB_DIR="${REPO_ROOT}/lib"
COMBO_DIR="${REPO_ROOT}/combinations/${COMBINATION}"
LOG_FILE="${REPO_ROOT}/install.log"

# shellcheck source=lib/common.sh
. "${LIB_DIR}/common.sh"

[[ -d "$COMBO_DIR" ]] || err "No such combination: ${COMBINATION}
       Expected: ${COMBO_DIR}
       Available combinations:
$(cd "${REPO_ROOT}/combinations" 2>/dev/null && find . -name config.sh -printf '         %h\n' | sed 's|\./||' | sort)"

for f in config.sh profiles.tsv help.txt; do
  [[ -f "${COMBO_DIR}/${f}" ]] || err "Combination ${COMBINATION} is missing ${f}."
done

# ---- combination config ---------------------------------------------------
# shellcheck source=/dev/null
. "${COMBO_DIR}/config.sh"

require_vars INSTALL_ID DISPLAY_NAME MODEL_DISPLAY_NAME TARGET_OS ACCEL BACKEND \
             CLIENT MODEL_SUBDIR MODEL_ASSETS MODEL_ALIAS_DEFAULT DEFAULT_PROFILE \
             SAFE_KV_TYPES SAMPLING_THINKING DEFAULT_PROVIDER CONTEXT_LIMIT OUTPUT_LIMIT

# Derived paths. INSTALL_REL is kept relative so nothing baked into the
# installed runtime contains a username.
INSTALL_REL="${INSTALL_REL:-.local/share/${INSTALL_ID}}"
INSTALL_ROOT="${HOME}/${INSTALL_REL}"
LLAMA_DIR="${INSTALL_ROOT}/llama.cpp"
MODEL_DIR="${INSTALL_ROOT}/${MODEL_SUBDIR}"
BIN_DIR="${HOME}/.local/bin"
SERVER_CMD="${SERVER_CMD:-${INSTALL_ID}-server}"
SESSION_CMD="${SESSION_CMD:-${INSTALL_ID}-${CLIENT}}"
ROOT_ENV_VAR="${ROOT_ENV_VAR:-LOCAL_AI_ROOT}"

# ---- modules --------------------------------------------------------------
for m in os deps hf model launcher service smoke summary; do
  # shellcheck source=/dev/null
  . "${LIB_DIR}/${m}.sh"
done

[[ -f "${LIB_DIR}/accel/${ACCEL}.sh" ]] || err \
  "No accelerator module for ACCEL='${ACCEL}' (expected lib/accel/${ACCEL}.sh).
       See docs/adding-a-combination.md."
# shellcheck source=/dev/null
. "${LIB_DIR}/accel/${ACCEL}.sh"

[[ -f "${LIB_DIR}/${BACKEND}.sh" ]] || err \
  "No backend module for BACKEND='${BACKEND}' (expected lib/${BACKEND}.sh)."
# shellcheck source=/dev/null
. "${LIB_DIR}/${BACKEND}.sh"

[[ -f "${LIB_DIR}/clients/${CLIENT}.sh" ]] || err \
  "No client adapter for CLIENT='${CLIENT}' (expected lib/clients/${CLIENT}.sh)."
# shellcheck source=/dev/null
. "${LIB_DIR}/clients/${CLIENT}.sh"

# ---- run ------------------------------------------------------------------
main() {
  info "=== ${DISPLAY_NAME} -- ${COMBINATION} ==="
  info "Log: $LOG_FILE"
  mkdir -p "$INSTALL_ROOT" "$BIN_DIR" "$MODEL_DIR"
  export PATH="${BIN_DIR}:${PATH}"

  qualify_os
  ensure_system_deps
  ensure_build_tools
  qualify_accel
  ensure_hf
  ensure_llama_cpp
  ensure_model
  install_runtime
  create_service

  if [[ "${SKIP_SMOKE_TEST:-0}" != "1" ]]; then
    smoke_test || warn "Smoke test did not pass; see ${INSTALL_ROOT}/smoke.log"
  fi

  print_summary
}

main "$@"

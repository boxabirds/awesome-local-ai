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
$(list_combinations | sed 's|^|         |')"

for f in config.sh profiles.tsv help.txt; do
  [[ -f "${COMBO_DIR}/${f}" ]] || err "Combination ${COMBINATION} is missing ${f}."
done

# ---- combination config ---------------------------------------------------
# shellcheck source=/dev/null
. "${COMBO_DIR}/config.sh"

# Required of every combination, whatever the backend. How the weights are
# named and fetched is backend-specific, so that half is checked after the
# backend module has been sourced (see BACKEND_REQUIRED_VARS below).
require_vars INSTALL_ID DISPLAY_NAME MODEL_DISPLAY_NAME TARGET_OS ACCEL BACKEND \
             CLIENT MODEL_ALIAS_DEFAULT DEFAULT_PROFILE \
             SAMPLING_THINKING DEFAULT_PROVIDER CONTEXT_LIMIT OUTPUT_LIMIT

# Derived paths. INSTALL_REL is kept relative so nothing baked into the
# installed runtime contains a username.
INSTALL_REL="${INSTALL_REL:-.local/share/${INSTALL_ID}}"
INSTALL_ROOT="${HOME}/${INSTALL_REL}"
MODEL_DIR="${INSTALL_ROOT}/${MODEL_SUBDIR:-models}"
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

# The backend decides which generic install steps apply to it. Defaults
# describe a backend that is compiled locally and fetches single files from the
# Hub (llama.cpp); one that ships as a prebuilt package and pulls whole model
# repos itself (mtplx) turns both off.
# Column layout of this combination's profiles.tsv, recorded in the manifest so
# the runtime and any future tooling can tell the shapes apart. The backend
# owns the default; a combination may override it.
PROFILE_SCHEMA="${PROFILE_SCHEMA:-name|ctx|kv_type|vision|np|ub|need_mib|summary}"

# The port this combination was measured on and whose number goes into the
# client config. Overridable per run with PORT.
DEFAULT_PORT="${DEFAULT_PORT:-8080}"

# Set by a backend whose model cache lives outside the install root, so the
# runtime can resolve it from $HOME without a path being baked in.
MODEL_CACHE_ENV_VAR="${MODEL_CACHE_ENV_VAR:-}"

BACKEND_NEEDS_BUILD_TOOLS="${BACKEND_NEEDS_BUILD_TOOLS:-1}"
BACKEND_NEEDS_HF="${BACKEND_NEEDS_HF:-1}"

declare -F ensure_backend >/dev/null || err \
  "Backend module lib/${BACKEND}.sh does not define ensure_backend.
       See docs/adding-a-combination.md."

# What this backend additionally needs from a combination's config. llama.cpp
# wants a list of files to pull; mtplx wants a repo id and fetches the pack.
if [[ -n "${BACKEND_REQUIRED_VARS:-}" ]]; then
  # shellcheck disable=SC2086
  require_vars ${BACKEND_REQUIRED_VARS}
fi


[[ -f "${LIB_DIR}/clients/${CLIENT}.sh" ]] || err \
  "No client adapter for CLIENT='${CLIENT}' (expected lib/clients/${CLIENT}.sh)."
# shellcheck source=/dev/null
. "${LIB_DIR}/clients/${CLIENT}.sh"

# ---- run ------------------------------------------------------------------
main() {
  info "=== ${DISPLAY_NAME} -- ${COMBINATION} ==="
  info "Log: $LOG_FILE"
  mkdir -p "$INSTALL_ROOT" "$BIN_DIR"
  if [[ "$BACKEND_NEEDS_HF" == "1" ]]; then mkdir -p "$MODEL_DIR"; fi
  export PATH="${BIN_DIR}:${PATH}"

  qualify_os
  ensure_system_deps
  if [[ "$BACKEND_NEEDS_BUILD_TOOLS" == "1" ]]; then ensure_build_tools; fi
  qualify_accel
  if [[ "$BACKEND_NEEDS_HF" == "1" ]]; then ensure_hf; fi
  ensure_backend
  ensure_model
  install_runtime
  create_service

  if [[ "${SKIP_SMOKE_TEST:-0}" != "1" ]]; then
    smoke_test || warn "Smoke test did not pass; see ${INSTALL_ROOT}/smoke.log"
  fi

  print_summary
}

main "$@"

#!/usr/bin/env bash
# lib/summary.sh -- the closing report.
#
# Driven entirely by the manifest and the combination's profiles.tsv, so a new
# combination gets a correct summary for free. Two optional hooks let a
# combination add its own lines: combination_performance and
# combination_troubleshooting.

# Refs are backend-specific; ask the backend when it can shorten one.
_summary_ref_label() {
  [[ -n "${1:-}" ]] || { printf '?'; return; }
  if declare -F backend_ref_label >/dev/null; then
    backend_ref_label "$1"
  else
    printf '%s' "$1"
  fi
}

print_summary() {
  local tick="${GREEN}OK${NC}" cross="${YELLOW}--${NC}"

  # The headline is a claim about this machine, so it follows what
  # verification actually observed. Saying "ready" after a failed smoke test is
  # the one thing that would make the rest of this report untrustworthy.
  say ""
  case "${VERIFY_STATUS:-skipped}" in
    failed)
      say "${RED}==============================================================${NC}"
      say "${RED}  ${DISPLAY_NAME} is installed but DID NOT WORK here${NC}"
      say "${RED}==============================================================${NC}"
      ;;
    recovered)
      say "${YELLOW}==============================================================${NC}"
      say "${YELLOW}  ${DISPLAY_NAME} is ready -- on an earlier ${BACKEND}${NC}"
      say "${YELLOW}==============================================================${NC}"
      ;;
    skipped)
      say "${YELLOW}==============================================================${NC}"
      say "${YELLOW}  ${DISPLAY_NAME} is installed -- NOT verified${NC}"
      say "${YELLOW}==============================================================${NC}"
      ;;
    *)
      say "${GREEN}==============================================================${NC}"
      say "${GREEN}  ${DISPLAY_NAME} is installed and ready${NC}"
      say "${GREEN}==============================================================${NC}"
      ;;
  esac
  say ""
  say "${BOLD}COMBINATION${NC}"
  say "  ${COMBINATION}"
  say "  Device      ${ACCEL_DESC}"
  say "  OS          ${OS_PRETTY}"
  say ""
  say "${BOLD}WHAT WAS INSTALLED${NC}"
  # What "the weights" look like is backend-specific: separate files with
  # optional sidecars for llama.cpp, one self-contained pack for mtplx. A
  # backend that ships its MTP head inside the pack must not be reported as
  # having no speculative decoding.
  if declare -F backend_install_summary >/dev/null; then
    backend_install_summary | while IFS= read -r l; do say "$l"; done
  else
    say "  Model       $(basename "$MODEL_GGUF")  ($(human_size "$MODEL_GGUF"))"
    if [[ -n "$MTP_HEAD" ]]; then
      say "  MTP head    $(basename "$MTP_HEAD")  ($(human_size "$MTP_HEAD"))  -> ~2x faster generation"
    else
      say "  MTP head    ${YELLOW}not installed${NC} -- no speculative decoding"
    fi
    if [[ -n "$MMPROJ" ]]; then
      say "  Vision      $(basename "$MMPROJ")  ($(human_size "$MMPROJ"))  -> a vision profile"
    else
      say "  Vision      ${YELLOW}not installed${NC} -- text only"
    fi
  fi
  local backend_sha="?"
  declare -F "${BACKEND}_sha" >/dev/null && backend_sha="$("${BACKEND}_sha")"
  say "$(printf '  %-11s %s  (%s%s)' "$BACKEND" "$backend_sha" "$ACCEL" \
        "$( [[ -n "${ACCEL_ARCH:-}" ]] && echo " sm_${ACCEL_ARCH}" )")"
  say "  Files in    ${INSTALL_ROOT}"
  say "  Commands    ${BIN_DIR}/${SERVER_CMD}, ${BIN_DIR}/${SESSION_CMD}"
  say ""

  if [[ "${VERIFY_STATUS:-}" == "recovered" ]]; then
    say "${BOLD}${YELLOW}A NEWER ${BACKEND} DID NOT WORK HERE${NC}"
    say "  ${BACKEND} $(_summary_ref_label "$ROLLED_BACK_FROM") failed verification on this machine,"
    say "  so the last build that passed was rebuilt and used instead:"
    say "    now running   $(_summary_ref_label "$ROLLED_BACK_TO")"
    say "    failed        $(_summary_ref_label "$ROLLED_BACK_FROM")"
    say "  Everything below was verified against the build you are running."
    say "  Please report this upstream -- see ${INSTALL_ROOT}/smoke.log."
    say ""
  fi

  if [[ "${VERIFY_STATUS:-}" == "failed" ]]; then
    say "${BOLD}${RED}WHAT WENT WRONG${NC}"
    say "  The install completed but the server did not pass verification, so"
    say "  this configuration is NOT known to work on this machine."
    say "  Log         ${INSTALL_ROOT}/smoke.log"
    say ""
    say "  Most common causes, in order:"
    say "    * something else is holding the device -- check it, then re-run"
    say "    * the profile does not fit -- try PROFILE=balanced"
    say "    * the weights are incomplete -- delete them and re-run"
    say ""
  fi

  if [[ -n "$SMOKE_CTX" || -n "$SMOKE_GEN" ]]; then
    say "${BOLD}VERIFIED ON THIS MACHINE${NC}"
    [[ -n "$SMOKE_CTX"  ]] && say "  [${tick}] loads at ${SMOKE_CTX} context, server RSS ${SMOKE_RSS:-?} MiB (${SMOKE_FREE} MiB free)"
    [[ "$SMOKE_GEN" == "ok" ]] && say "  [${tick}] generates text over the API"
    if [[ -n "$SMOKE_ACC" ]]; then
      say "  [${tick}] speculative decoding live (${SMOKE_ACC})"
    elif [[ -n "$MTP_HEAD" || "${BACKEND_MTP_INTERNAL:-0}" == "1" ]]; then
      say "  [${cross}] speculative decoding NOT confirmed -- check ${INSTALL_ROOT}/smoke.log"
    fi
    say ""
  fi

  say "${BOLD}START IT${NC}"
  local w=$(( ${#SERVER_CMD} + 7 ))
  (( ${#SESSION_CMD} > w )) && w=${#SESSION_CMD}
  say "  ${GREEN}$(printf "%-${w}s" "$SESSION_CMD")${NC}  # start server on demand + ${CLIENT}, stop when idle"
  say "$(printf "  %-${w}s  # just the server, in the foreground" "$SERVER_CMD")"
  say "$(printf "  %-${w}s  # all profiles, with caveats" "$SERVER_CMD --help")"
  (( SERVICE_CREATED )) && \
  say "  systemctl --user enable --now ${INSTALL_ID}   # run it as a service"
  say ""
  say "${BOLD}CONNECT A CLIENT${NC}  (OpenAI-compatible)"
  say "  Endpoint    http://127.0.0.1:${DEFAULT_PORT}/v1"
  say "  Model id    ${MODEL_ALIAS_DEFAULT}"
  say "  API key     any value -- it is ignored"
  say "  Check it    curl http://127.0.0.1:${DEFAULT_PORT}/v1/models"
  say ""
  say "${BOLD}CHOOSE A PROFILE${NC}  PROFILE=<name> ${SERVER_CMD}"
  # The columns of profiles.tsv are the backend's business -- another backend
  # has no KV type and no vision flag to show -- so it renders its own table.
  backend_profile_table "${COMBO_DIR}/profiles.tsv" | while IFS= read -r l; do say "$l"; done
  say ""

  if declare -F combination_performance >/dev/null; then
    say "${BOLD}MEASURED PERFORMANCE${NC}"
    combination_performance | while IFS= read -r l; do say "  $l"; done
    say ""
  fi

  say "${BOLD}IF SOMETHING LOOKS WRONG${NC}"
  if declare -F combination_troubleshooting >/dev/null; then
    combination_troubleshooting | while IFS= read -r l; do say "  $l"; done
  fi
  say "  Setup log           ${LOG_FILE}"
  say ""
  say "${BOLD}LEARN MORE${NC}"
  say "  ${COMBO_DIR#"$REPO_ROOT"/}/README.md"
  say "  README.md            the catalogue of combinations"

  if ((${#PKG_MISSING[@]})); then
    say ""
    say "${YELLOW}NOTE: skipped system packages (no passwordless sudo):${NC} ${PKG_MISSING[*]}"
    say "  sudo apt-get install -y --no-install-recommends ${PKG_MISSING[*]}"
    say "  then re-run this script for a CURL-enabled build."
  fi
  say ""
  say "Re-running this script is safe: it only upgrades what is outdated."
  say ""
}

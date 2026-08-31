#!/usr/bin/env bash
# lib/summary.sh -- the closing report.
#
# Driven entirely by the manifest and the combination's profiles.tsv, so a new
# combination gets a correct summary for free. Two optional hooks let a
# combination add its own lines: combination_performance and
# combination_troubleshooting.

print_summary() {
  local tick="${GREEN}OK${NC}" cross="${YELLOW}--${NC}"

  say ""
  say "${GREEN}==============================================================${NC}"
  say "${GREEN}  ${DISPLAY_NAME} is installed and ready${NC}"
  say "${GREEN}==============================================================${NC}"
  say ""
  say "${BOLD}COMBINATION${NC}"
  say "  ${COMBINATION}"
  say "  Device      ${ACCEL_DESC}"
  say "  OS          ${OS_PRETTY}"
  say ""
  say "${BOLD}WHAT WAS INSTALLED${NC}"
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
  local backend_sha="?"
  declare -F "${BACKEND}_sha" >/dev/null && backend_sha="$("${BACKEND}_sha")"
  say "$(printf '  %-11s %s  (%s%s)' "$BACKEND" "$backend_sha" "$ACCEL" \
        "$( [[ -n "${ACCEL_ARCH:-}" ]] && echo " sm_${ACCEL_ARCH}" )")"
  say "  Files in    ${INSTALL_ROOT}"
  say "  Commands    ${BIN_DIR}/${SERVER_CMD}, ${BIN_DIR}/${SESSION_CMD}"
  say ""

  if [[ -n "$SMOKE_CTX" || -n "$SMOKE_GEN" ]]; then
    say "${BOLD}VERIFIED ON THIS MACHINE${NC}"
    [[ -n "$SMOKE_CTX"  ]] && say "  [${tick}] loads at ${SMOKE_CTX} context, using ${SMOKE_MEM} MiB (${SMOKE_FREE} MiB free)"
    [[ "$SMOKE_GEN" == "ok" ]] && say "  [${tick}] generates text over the API"
    if [[ -n "$SMOKE_ACC" ]]; then
      say "  [${tick}] speculative decoding live (draft acceptance ${SMOKE_ACC})"
    elif [[ -n "$MTP_HEAD" ]]; then
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
  say "  Endpoint    http://127.0.0.1:8080/v1"
  say "  Model id    ${MODEL_ALIAS_DEFAULT}"
  say "  API key     any value -- it is ignored"
  say "  Check it    curl http://127.0.0.1:8080/v1/models"
  say ""
  say "${BOLD}CHOOSE A PROFILE${NC}  PROFILE=<name> ${SERVER_CMD}"
  local name ctx kv vision np ub need summary
  while IFS='|' read -r name ctx kv vision np ub need summary; do
    [[ -z "${name// }" || "$name" == \#* ]] && continue
    say "$(printf '  %-11s %7s ctx  %-4s KV  vision %-3s  %s' \
        "$name" "$ctx" "$kv" "$( [[ "$vision" == 1 ]] && echo on || echo off )" "$summary")"
  done < "${COMBO_DIR}/profiles.tsv"
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

#!/usr/bin/env bash
# lib/run.sh -- work out what is installed and run it.
#
# The installer leaves a manifest at $HOME/.local/share/<install-id>/install.env
# for every combination that has been installed. That is the source of truth:
# this script discovers those manifests rather than guessing at model names or
# assuming a particular combination, so it keeps working as combinations are
# added, and it can tell you clearly when there is more than one.
#
# It also invokes commands by absolute path, so it works before ~/.local/bin is
# on your PATH -- a common first-run stumble.

set -euo pipefail

BIN_DIR="${HOME}/.local/bin"
SHARE_DIR="${HOME}/.local/share"

# ---- discovery ------------------------------------------------------------
# One record per installed combination:
#   install_id|combination|display_name|server_cmd|session_cmd|client|root
discover() {
  local f
  shopt -s nullglob
  for f in "${SHARE_DIR}"/*/install.env; do
    (
      set +u
      # shellcheck disable=SC1090
      . "$f" 2>/dev/null || exit 0
      [[ -n "$INSTALL_ID" ]] || exit 0
      printf '%s|%s|%s|%s|%s|%s|%s\n' \
        "$INSTALL_ID" "$COMBINATION" "$DISPLAY_NAME" \
        "$SERVER_CMD" "$SESSION_CMD" "$CLIENT" "$(dirname "$f")"
    )
  done
  shopt -u nullglob
}

# An install is only usable if the manifest, the commands and the weights are
# all present. A half-removed install should say so, not fail obscurely later.
health_of() {
  local root="$1" server_cmd="$2" session_cmd="$3"
  ( set +u
    local model
    # shellcheck disable=SC1091
    . "${root}/install.env" 2>/dev/null
    # A backend that fetches single files keeps them under the install root; one
    # with its own model cache (mtplx) records a $HOME-relative path to it. Both
    # are resolved the same way, but the artefact is a file in the first case
    # and a directory in the second, so accept either.
    if [[ -n "${MODEL_CACHE_ENV_VAR:-}" && -n "${!MODEL_CACHE_ENV_VAR:-}" ]]; then
      model="${!MODEL_CACHE_ENV_VAR}/${MODEL_FILE}"
    elif [[ -d "${HOME}/${MODEL_SUBDIR}" ]]; then
      model="${HOME}/${MODEL_SUBDIR}/${MODEL_FILE}"
    else
      model="${root}/${MODEL_SUBDIR}/${MODEL_FILE}"
    fi
    [[ -e "$model" ]] || { echo "weights missing"; exit 0; }
    [[ -x "${HOME}/.local/bin/${server_cmd}"  ]] || { echo "command ${server_cmd} missing"; exit 0; }
    [[ -x "${HOME}/.local/bin/${session_cmd}" ]] || { echo "command ${session_cmd} missing"; exit 0; }
    # The launcher is per-backend now; the shim points at whichever one applies.
    [[ -x "${HOME}/.local/bin/local-ai-${BACKEND}-server" ]] || { echo "runtime missing"; exit 0; }
    echo ok
  )
}

installer_for() {
  # combination path -> the root script that installs it
  printf 'install-%s.sh' "$(echo "$1" | tr '/' '-')"
}

list_installs() {
  local any=0 rec id combo display server session client root health
  while IFS='|' read -r id combo display server session client root; do
    [[ -z "$id" ]] && continue
    any=1
    health="$(health_of "$root" "$server" "$session")"
    if [[ "$health" == "ok" ]]; then
      printf '  %-14s %s\n' "$id" "$combo"
    else
      printf '  %-14s %s   [%s]\n' "$id" "$combo" "$health"
    fi
    printf '  %-14s   client: %s   commands: %s, %s\n\n' "" "$client" "$server" "$session"
  done < <(discover)
  (( any )) || return 1
}

no_installs() {
  echo "Nothing is installed yet." >&2
  echo >&2
  echo "Available combinations in this checkout:" >&2
  local s
  shopt -s nullglob
  for s in "${REPO_ROOT}"/install-*.sh; do
    printf '  ./%s\n' "$(basename "$s")" >&2
  done
  shopt -u nullglob
  echo >&2
  echo "Run the one that matches your hardware, then try ./run.sh again." >&2
  exit 1
}

usage() {
  cat <<'HELP'
run.sh -- run whatever this machine has installed.

USAGE
  ./run.sh [selector] [command] [-- client args...]

  With one combination installed, the selector is optional. With several,
  pass any unambiguous part of the install id or combination path.

COMMANDS
  (none)          start the server on demand and launch the client, then shut
                  the server down once you stop using it            [default]
  --server        run the server in the foreground, no client
  --server-only   start the server and its idle watcher, then return
  --status        server, watcher, clients, idle timer
  --stop          stop the watcher and the server it started
  --list          what is installed on this machine
  --help          this text

EXAMPLES
  ./run.sh                             # the common case
  ./run.sh --status
  PROFILE=vision ./run.sh              # env passes through to the server
  THINKING=0 ./run.sh
  ./run.sh -- run "explain this repo"  # pass arguments to the client
  ./run.sh qwen38-27b --server         # pick an install explicitly

Environment understood by the server (PROFILE, PORT, CTX, KV_TYPE, VISION,
THINKING, THINKING_BUDGET, NP, UB) is passed straight through. See
`<install-id>-server --help` for the profile table.
HELP
}

# ---- argument parsing -----------------------------------------------------
SELECTOR=""
ACTION="session"
PASSTHRU=()

while (( $# )); do
  case "$1" in
    --help|-h)     usage; exit 0 ;;
    --list)        ACTION="list"; shift ;;
    --server)      ACTION="server"; shift ;;
    --server-only) ACTION="server-only"; shift ;;
    --status)      ACTION="status"; shift ;;
    --stop)        ACTION="stop"; shift ;;
    --)            shift; PASSTHRU=("$@"); break ;;
    -*)            echo "run.sh: unknown option '$1' (try --help)" >&2; exit 2 ;;
    *)
      [[ -n "$SELECTOR" ]] && { echo "run.sh: more than one selector given ('$SELECTOR', '$1')" >&2; exit 2; }
      SELECTOR="$1"; shift ;;
  esac
done

# ---- select ---------------------------------------------------------------
# Not `mapfile`: that is bash 4+, and stock macOS still ships bash 3.2.
INSTALLS=()
while IFS= read -r _line; do INSTALLS+=("$_line"); done < <(discover)
(( ${#INSTALLS[@]} )) || { [[ "$ACTION" == "list" ]] && { echo "Nothing is installed yet."; exit 0; }; no_installs; }

if [[ "$ACTION" == "list" ]]; then
  echo "Installed:"
  echo
  list_installs
  exit 0
fi

# Matching is tiered, most specific first, and stops at the first tier that
# yields anything. A plain substring sweep is not enough: "llama" is a
# substring of "llamacpp-opencode", so it would match a Qwen install running
# on llama.cpp as readily as a Llama one.
#
#   1. exact install id            2. exact combination path
#   3. install id prefix           4. substring of either
MATCHES=()
if [[ -z "$SELECTOR" ]]; then
  MATCHES=("${INSTALLS[@]}")
else
  for tier in exact-id exact-combo prefix-id substring; do
    for rec in "${INSTALLS[@]}"; do
      IFS='|' read -r id combo _ <<< "$rec"
      case "$tier" in
        exact-id)    [[ "$id" == "$SELECTOR" ]] && MATCHES+=("$rec") ;;
        exact-combo) [[ "$combo" == "$SELECTOR" ]] && MATCHES+=("$rec") ;;
        prefix-id)   [[ "$id" == "$SELECTOR"* ]] && MATCHES+=("$rec") ;;
        substring)   [[ "$id" == *"$SELECTOR"* || "$combo" == *"$SELECTOR"* ]] && MATCHES+=("$rec") ;;
      esac
    done
    (( ${#MATCHES[@]} )) && break
  done
fi

if (( ${#MATCHES[@]} == 0 )); then
  echo "run.sh: nothing installed matches '${SELECTOR}'." >&2
  echo >&2; echo "Installed:" >&2; echo >&2; list_installs >&2
  exit 1
fi

if (( ${#MATCHES[@]} > 1 )); then
  if [[ -n "$SELECTOR" ]]; then
    echo "run.sh: '${SELECTOR}' matches ${#MATCHES[@]} installs; be more specific." >&2
  else
    echo "run.sh: ${#MATCHES[@]} combinations are installed; say which one." >&2
  fi
  echo >&2
  for rec in "${MATCHES[@]}"; do
    IFS='|' read -r id combo _ _ _ _ _ <<< "$rec"
    printf '  ./run.sh %-14s   # %s\n' "$id" "$combo" >&2
  done
  exit 1
fi

IFS='|' read -r ID COMBO DISPLAY SERVER_CMD SESSION_CMD CLIENT ROOT <<< "${MATCHES[0]}"

# ---- qualify --------------------------------------------------------------
HEALTH="$(health_of "$ROOT" "$SERVER_CMD" "$SESSION_CMD")"
if [[ "$HEALTH" != "ok" ]]; then
  echo "run.sh: the '${ID}' install is incomplete -- ${HEALTH}." >&2
  echo >&2
  echo "Re-run its installer to repair it (it is idempotent and will only fix" >&2
  echo "what is missing):" >&2
  echo >&2
  echo "  ./$(installer_for "$COMBO")" >&2
  exit 1
fi

# Invoke by absolute path so this works before ~/.local/bin is on PATH, but
# still mention it, because the commands themselves will not be found later.
case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *) echo "note: ${BIN_DIR} is not on your PATH, so '${SESSION_CMD}' will not be" >&2
     echo "      found directly. Add it to your shell profile:" >&2
     echo "        export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2
     echo >&2 ;;
esac
export PATH="${BIN_DIR}:${PATH}"

# ---- run ------------------------------------------------------------------
case "$ACTION" in
  server)       exec "${BIN_DIR}/${SERVER_CMD}"  "${PASSTHRU[@]}" ;;
  server-only)  exec "${BIN_DIR}/${SESSION_CMD}" --server-only ;;
  status)       exec "${BIN_DIR}/${SESSION_CMD}" --status ;;
  stop)         exec "${BIN_DIR}/${SESSION_CMD}" --stop ;;
  session)
    if (( ${#PASSTHRU[@]} )); then
      exec "${BIN_DIR}/${SESSION_CMD}" -- "${PASSTHRU[@]}"
    else
      exec "${BIN_DIR}/${SESSION_CMD}"
    fi ;;
esac

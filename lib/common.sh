#!/usr/bin/env bash
# lib/common.sh -- logging, privilege and small utilities shared by every
# combination's installer. Sourced, never executed.

# Colours are suppressed when stdout is not a TTY so the log file stays clean.
if [[ -t 1 ]]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
  BLUE=$'\033[0;34m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

# LOG_FILE is set by bootstrap.sh before anything here is called.
log() {
  local level="$1"; shift
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*" | tee -a "$LOG_FILE"
}

info() { log "INFO"  "${BLUE}$*${NC}"; }
ok()   { log "OK"    "${GREEN}$*${NC}"; }
warn() { log "WARN"  "${YELLOW}$*${NC}"; }
err()  { log "ERROR" "${RED}$*${NC}"; exit 1; }

# Printed directly rather than through log(), so the final summary is not
# buried under timestamps and level tags. Still tee'd to the log, colours out.
say() { echo "$*"; echo "$*" | sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_FILE"; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# True only if we can become root without an interactive password prompt.
can_sudo() {
  [[ $EUID -eq 0 ]] && return 0
  need_cmd sudo && sudo -n true 2>/dev/null
}

run_as_root() {
  if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

human_size() { [[ -f "$1" ]] && du -h "$1" 2>/dev/null | cut -f1 || echo "-"; }

# Every combination directory, as a `family/version/size/os/memory/stack` path.
# BSD find has no -printf, so derive the directory from the config path instead
# of asking find to print it.
list_combinations() {
  local d="${REPO_ROOT}/combinations"
  [[ -d "$d" ]] || return 0
  find "$d" -name config.sh 2>/dev/null \
    | sed -e "s|^${d}/||" -e 's|/config\.sh$||' \
    | sort
}

# Every value a config declares is required to be non-empty; catching a typo
# here is much cheaper than catching it 20 GB into a download.
require_vars() {
  local v
  for v in "$@"; do
    [[ -n "${!v:-}" ]] || err "Combination config is missing required variable: ${v}"
  done
}

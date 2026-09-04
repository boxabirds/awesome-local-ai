#!/usr/bin/env bash
# lib/select.sh -- work out which combination suits THIS machine.
#
# Sourced by ./install.sh. The combination tree is deliberately uniform --
#   combinations/<family>/<version>/<size>/<os>/<memory>/<stack>/
# -- so the path segments alone carry everything selection needs: which OS a
# combination targets and how much memory it was measured against. That means
# picking one is a matter of reading the tree and probing the host, with no
# per-combination registry to keep in sync.
#
# The probe is deliberately coarse. It answers "which machine class is this?",
# not "will this model fit?" -- the second question belongs to qualify_accel in
# the accelerator adapter, which runs with the combination's own thresholds and
# refuses with actionable numbers. Selection narrows; qualification decides.

HOST_OS=""; HOST_OS_PRETTY=""; HOST_ARCH=""; HOST_ACCEL=""
HOST_MEM_MIB=0; HOST_MEM_DESC=""

detect_host() {
  HOST_ARCH="$(uname -m)"
  case "$(uname -s)" in
    Darwin) _detect_macos ;;
    Linux)  _detect_linux ;;
    *) HOST_OS="unknown"; HOST_OS_PRETTY="$(uname -s)" ;;
  esac
}

_detect_macos() {
  HOST_OS="macos"
  HOST_OS_PRETTY="macOS $(sw_vers -productVersion 2>/dev/null || echo '?')"
  if [[ "$HOST_ARCH" == "arm64" ]]; then
    HOST_ACCEL="metal"
    # Unified memory: the machine class IS its RAM. What the GPU may actually
    # wire is smaller and is the accelerator adapter's business, not selection's.
    HOST_MEM_MIB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1048576 ))
    HOST_MEM_DESC="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo 'Apple silicon'), ${HOST_MEM_MIB} MiB unified memory"
  else
    HOST_ACCEL="none"
    HOST_MEM_DESC="Intel Mac (no Metal GPU worth serving from)"
  fi
}

_detect_linux() {
  HOST_OS="linux"
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    HOST_OS="${ID:-linux}"
    HOST_OS_PRETTY="${PRETTY_NAME:-${ID:-Linux}}"
  else
    HOST_OS_PRETTY="Linux (no /etc/os-release)"
  fi

  if command -v nvidia-smi >/dev/null 2>&1; then
    HOST_ACCEL="cuda"
    HOST_MEM_MIB="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)"
    HOST_MEM_MIB="${HOST_MEM_MIB:-0}"
    HOST_MEM_DESC="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1), ${HOST_MEM_MIB} MiB VRAM"
  else
    HOST_ACCEL="none"
    HOST_MEM_DESC="no NVIDIA GPU detected"
  fi
}

# "24GB" -> 24576, "128GB" -> 131072. Returns 0 for anything unparseable so a
# malformed segment never silently qualifies.
_memory_segment_mib() {
  local seg="$1" num unit
  num="$(printf '%s' "$seg" | sed -nE 's/^([0-9]+).*/\1/p')"
  unit="$(printf '%s' "$seg" | sed -nE 's/^[0-9]+([A-Za-z]+)$/\1/p' | tr 'a-z' 'A-Z')"
  [[ -n "$num" ]] || { printf '0'; return; }
  case "$unit" in
    GB|GIB) printf '%s' $(( num * 1024 )) ;;
    MB|MIB) printf '%s' "$num" ;;
    *)      printf '0' ;;
  esac
}

# A combination's OS segment against the detected OS. Debian-family hosts may
# run an Ubuntu combination; that is a warning at qualification, not a reason
# to hide it from selection.
_os_matches() {
  local want="$1"
  [[ "$want" == "$HOST_OS" ]] && return 0
  case "$HOST_OS:$want" in
    debian:ubuntu|pop:ubuntu|linuxmint:ubuntu|elementary:ubuntu) return 0 ;;
  esac
  return 1
}

# Candidate combinations for this host, best last, as
#   <score>|<combination path>
# Nameplate memory never matches its tier exactly -- a "24GB" card reports
# 24564 MiB and a 64 GB Mac 65536 -- so allow 5% under the tier before ruling
# a machine out.
candidates_for_host() {
  local family_filter="${1:-}"
  local combo family version size os mem stack tier
  while IFS= read -r combo; do
    [[ -n "$combo" ]] || continue
    IFS='/' read -r family version size os mem stack <<< "$combo"
    [[ -n "$stack" ]] || continue
    [[ -z "$family_filter" || "$family" == "$family_filter" ]] || continue
    _os_matches "$os" || continue

    tier="$(_memory_segment_mib "$mem")"
    (( tier > 0 )) || continue
    awk -v h="$HOST_MEM_MIB" -v t="$tier" 'BEGIN{exit !(h >= t*0.95)}' || continue

    # Score is the memory tier: the largest combination this machine can hold
    # is the one tuned for the most capable machine of its class, and is what
    # someone running the default installer wants.
    printf '%s|%s\n' "$tier" "$combo"
  done < <(list_combinations) | sort -t'|' -k1,1n
}

# The single best combination for this host, or empty.
best_for_host() {
  candidates_for_host "${1:-}" | tail -1 | cut -d'|' -f2
}

# combination path -> the root script that installs it
installer_script_for() { printf 'install-%s.sh' "$(printf '%s' "$1" | tr '/' '-')"; }

# Why nothing matched, in terms the user can act on.
explain_no_match() {
  local family_filter="${1:-}"
  echo "No combination in this repo matches this machine." >&2
  echo >&2
  echo "  Detected: ${HOST_OS_PRETTY} (${HOST_ARCH}), ${HOST_MEM_DESC}" >&2
  echo "  Accelerator: ${HOST_ACCEL}" >&2
  echo >&2
  if [[ "$HOST_ACCEL" == "none" ]]; then
    echo "  No supported accelerator was found. Every combination here needs" >&2
    echo "  either an NVIDIA GPU or Apple silicon." >&2
    echo >&2
  fi
  echo "  What this repo has:" >&2
  local combo family version size os mem stack tier
  while IFS= read -r combo; do
    IFS='/' read -r family version size os mem stack <<< "$combo"
    tier="$(_memory_segment_mib "$mem")"
    local why="needs ${mem} on ${os}"
    if _os_matches "$os" && (( HOST_MEM_MIB > 0 )) && (( tier > HOST_MEM_MIB )); then
      why="needs ${mem}; this machine has ${HOST_MEM_MIB} MiB"
    elif ! _os_matches "$os"; then
      why="targets ${os}; this machine is ${HOST_OS}"
    fi
    printf '    %-52s %s\n' "$combo" "$why" >&2
  done < <(list_combinations)
  echo >&2
  echo "  To add one for this machine: docs/adding-a-combination.md" >&2
}

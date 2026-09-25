#!/usr/bin/env bash
# lib/select.sh -- work out which combination suits THIS machine.
#
# Sourced by ./install.sh. The combination tree is deliberately uniform --
#   combinations/<family>/<version>/<size>/<os>/<machine>/<stack>/
# -- so the path segments alone carry everything selection needs: which OS a
# combination targets, which accelerator it was measured on and how much
# memory that had. That means picking one is a matter of reading the tree and
# probing the host, with no per-combination registry to keep in sync.
#
# The <machine> segment names the hardware a combination was MEASURED on:
#
#   nvidia4090          a device with one memory size -- the name implies it
#   strix-halo-128GB    a platform sold in several sizes -- <accel>-<memory>
#   64GB                legacy, memory only; any accelerator on the OS
#
# It records where the numbers came from, not the only machine allowed to run
# them. Selection matches on accelerator FAMILY and memory, so a 3090 is
# offered the nvidia4090 combination; the accelerator adapter is what says
# "this exact device was not measured".
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
  elif _has_strix_halo_gpu; then
    HOST_ACCEL="strix-halo"
    # Unified memory, as on a Mac: the machine class is its physical memory.
    # MemTotal alone understates it by whatever the BIOS carved out for the
    # GPU, and a machine left at the vendor's 96GB carve-out would otherwise
    # be classed as a 32GB box. How much the GPU may actually address (the
    # GTT limit) is the accelerator adapter's business, not selection's.
    local ram_kib vram_bytes
    ram_kib="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null)"
    vram_bytes="$(_strix_halo_sysfs mem_info_vram_total)"
    HOST_MEM_MIB=$(( ${ram_kib:-0} / 1024 + ${vram_bytes:-0} / 1048576 ))
    HOST_MEM_DESC="AMD Strix Halo (Radeon 8060S, gfx1151), ${HOST_MEM_MIB} MiB unified memory"
  else
    HOST_ACCEL="none"
    HOST_MEM_DESC="no NVIDIA GPU or AMD Strix Halo detected"
  fi
}

# Strix Halo's integrated GPU is PCI 1002:1586 (Radeon 8060S / 8050S, gfx1151).
# Read sysfs rather than lspci so detection needs no package installed.
# SYSFS_PCI is overridable so tests can fake a machine.
_has_strix_halo_gpu() {
  local d
  for d in "${SYSFS_PCI:-/sys/bus/pci/devices}"/*; do
    [[ -r "$d/vendor" && -r "$d/device" ]] || continue
    [[ "$(cat "$d/vendor")" == "0x1002" && "$(cat "$d/device")" == "0x1586" ]] && return 0
  done
  return 1
}

# One amdgpu sysfs counter for the Strix Halo GPU, in bytes; empty if absent.
_strix_halo_sysfs() {
  local d
  for d in "${SYSFS_PCI:-/sys/bus/pci/devices}"/*; do
    [[ "$(cat "$d/device" 2>/dev/null)" == "0x1586" && -r "$d/$1" ]] || continue
    cat "$d/$1"; return 0
  done
}

# "24GB" -> 24576, "128GB" -> 131072. Returns 0 for anything unparseable so a
# malformed segment never silently qualifies. Accepts a whole machine segment
# too: "strix-halo-128GB" -> 131072, "nvidia4090" -> 24576.
_memory_segment_mib() {
  _machine_segment "$1" | cut -d'|' -f2
}

# Plain "<n><unit>" -> MiB, or 0.
_size_mib() {
  local seg="$1" num unit
  num="$(printf '%s' "$seg" | sed -nE 's/^([0-9]+)[A-Za-z]+$/\1/p')"
  unit="$(printf '%s' "$seg" | sed -nE 's/^[0-9]+([A-Za-z]+)$/\1/p' | tr 'a-z' 'A-Z')"
  [[ -n "$num" ]] || { printf '0'; return; }
  case "$unit" in
    GB|GIB) printf '%s' $(( num * 1024 )) ;;
    MB|MIB) printf '%s' "$num" ;;
    *)      printf '0' ;;
  esac
}

# Devices that come in exactly one memory size, so their name is the whole
# machine segment. Add a line here when a combination is measured on one.
_fixed_device_mib() {
  case "$1" in
    nvidia3090|nvidia3090ti|nvidia4090) printf '24576' ;;
    nvidia5090)                         printf '32768' ;;
    *)                                  printf '0' ;;
  esac
}

# The accelerator family a machine-segment prefix belongs to: what the host
# probe reports as HOST_ACCEL. A combination measured on one device is offered
# to every device of its family; qualification says which one was measured.
_accel_family() {
  case "$1" in
    nvidia*)        printf 'cuda' ;;
    strix-halo)     printf 'strix-halo' ;;
    m[0-9]*)        printf 'metal' ;;
    *)              printf '%s' "$1" ;;
  esac
}

# machine segment -> "<accel family>|<memory MiB>"
#   64GB               -> any|65536          (legacy: memory only)
#   strix-halo-128GB   -> strix-halo|131072
#   nvidia4090         -> cuda|24576
# Memory 0 means unparseable, and never qualifies.
_machine_segment() {
  local seg="$1" mib prefix
  mib="$(_size_mib "$seg")"
  if (( mib > 0 )); then printf 'any|%s' "$mib"; return; fi

  # <accel>-<memory>
  if [[ "$seg" =~ ^(.+)-([0-9]+[A-Za-z]+)$ ]]; then
    prefix="${BASH_REMATCH[1]}"
    mib="$(_size_mib "${BASH_REMATCH[2]}")"
    if (( mib > 0 )); then printf '%s|%s' "$(_accel_family "$prefix")" "$mib"; return; fi
  fi

  mib="$(_fixed_device_mib "$seg")"
  if (( mib > 0 )); then printf '%s|%s' "$(_accel_family "$seg")" "$mib"; return; fi

  printf 'unknown|0'
}

# Does the host hold a combination measured at <tier> MiB? A machine sold as
# 128GB reports a little less (firmware and the GPU carve-out take some), so
# allow 5%. Selection and the no-match explanation must agree on this.
MEM_TIER_SLACK=0.95
_mem_fits() {
  awk -v h="$HOST_MEM_MIB" -v t="$1" -v s="$MEM_TIER_SLACK" 'BEGIN{exit !(h >= t*s)}'
}

# A combination's accelerator family against the detected one. The legacy
# memory-only segment matches any accelerator, as it always has.
_accel_matches() {
  local want="$1"
  [[ "$want" == "any" || "$want" == "$HOST_ACCEL" ]]
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
  local combo family version size os machine stack tier accel
  while IFS= read -r combo; do
    [[ -n "$combo" ]] || continue
    IFS='/' read -r family version size os machine stack <<< "$combo"
    [[ -n "$stack" ]] || continue
    [[ -z "$family_filter" || "$family" == "$family_filter" ]] || continue
    _os_matches "$os" || continue

    IFS='|' read -r accel tier <<< "$(_machine_segment "$machine")"
    (( tier > 0 )) || continue
    _accel_matches "$accel" || continue
    _mem_fits "$tier" || continue

    # Score is the memory tier: the largest combination this machine can hold
    # is the one tuned for the most capable machine of its class, and is what
    # someone running the default installer wants. Within a tier, a
    # combination that opts out of automatic selection (AUTO_SELECT=0 in its
    # config -- e.g. one this repo has not measured) ranks below every one
    # that has not, so it is listed as compatible but never the silent pick.
    local rank=1
    if grep -qE '^AUTO_SELECT=0([^0-9]|$)' "${REPO_ROOT}/combinations/${combo}/config.sh" 2>/dev/null; then
      rank=0
    fi
    printf '%s|%s\n' "$(( tier * 2 + rank ))" "$combo"
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
    echo "  an NVIDIA GPU, an AMD Strix Halo APU or Apple silicon." >&2
    echo >&2
  fi
  echo "  What this repo has:" >&2
  local combo family version size os machine stack tier accel
  while IFS= read -r combo; do
    IFS='/' read -r family version size os machine stack <<< "$combo"
    IFS='|' read -r accel tier <<< "$(_machine_segment "$machine")"
    local why="needs ${machine} on ${os}"
    if ! _os_matches "$os"; then
      why="targets ${os}; this machine is ${HOST_OS}"
    elif ! _accel_matches "$accel"; then
      why="needs a ${accel} accelerator; this machine has ${HOST_ACCEL}"
    elif (( HOST_MEM_MIB > 0 )) && ! _mem_fits "$tier"; then
      why="needs ${tier} MiB; this machine has ${HOST_MEM_MIB} MiB"
    elif [[ -n "$family_filter" && "$family" != "$family_filter" ]]; then
      why="fits this machine; family is ${family}, not '${family_filter}'"
    else
      why="fits this machine"
    fi
    printf '    %-52s %s\n' "$combo" "$why" >&2
  done < <(list_combinations)
  echo >&2
  echo "  To add one for this machine: docs/adding-a-combination.md" >&2
}

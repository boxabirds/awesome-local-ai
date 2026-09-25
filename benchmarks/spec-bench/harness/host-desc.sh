# host-desc.sh -- sourced by run.sh: host_desc prints one line naming this machine for run.json
# ("<cpu> <ram>GB, <gpu>"). It must never stop a run: run.sh is under `set -euo pipefail`, where a
# missing tool inside a pipeline (nvidia-smi on a machine without an NVIDIA card) would exit 127.
# MEMINFO: tests only.
KIB_PER_GIB=1048576
BYTES_PER_GIB=1073741824

host_gpu() {
  local g=""
  if command -v nvidia-smi >/dev/null 2>&1; then
    g="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1 | tr -d ',')" || g=""
  fi
  if [[ -z "$g" ]] && command -v lspci >/dev/null 2>&1; then
    # "0000:bd:00.0 VGA compatible controller: <vendor> <device>" -> "<vendor> <device>"
    g="$(lspci 2>/dev/null | grep -m1 -iE 'VGA|Display|3D controller' | sed 's/^[^:]*:[^:]*:[^:]*: //')" || g=""
  fi
  printf '%s' "$g"
}

host_desc() {
  local cpu mem gpu
  if [[ "$(uname)" == Darwin ]]; then
    cpu="$(sysctl -n machdep.cpu.brand_string 2>/dev/null)" || cpu=""
    mem="$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / BYTES_PER_GIB ))"
    printf '%s %sGB' "$cpu" "$mem"
    return
  fi
  cpu="$(lscpu 2>/dev/null | sed -n 's/^Model name: *//p')" || cpu=""
  mem="$(( $(awk '/MemTotal/ {print $2}' "${MEMINFO:-/proc/meminfo}" 2>/dev/null || echo 0) / KIB_PER_GIB ))"
  gpu="$(host_gpu)"
  printf '%s %sGB%s' "$cpu" "$mem" "${gpu:+, $gpu}"
}

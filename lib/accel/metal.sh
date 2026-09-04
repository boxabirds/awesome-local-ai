#!/usr/bin/env bash
# lib/accel/metal.sh -- Apple silicon (Metal) qualification and build flags.
#
# Selected by ACCEL=metal in a combination's config.sh. Exports:
#   ACCEL_DESC        human-readable device description for the summary
#   ACCEL_ARCH        chip generation, e.g. m5 -- used as a build cache key
#   ACCEL_MEM_MIB     the memory budget that constrains the model
#   accel_cmake_args  cmake flags for a compiled backend
#   accel_report_mem  "<used_mib> <free_mib>" for the smoke report
#
# ACCEL_MEM_MIB means the same thing here as it does in lib/accel/cuda.sh: the
# budget that constrains the model. On Apple silicon that is NOT the machine's
# RAM. Memory is unified, but the GPU may only wire down part of it, and the
# real ceiling is Metal's recommendedMaxWorkingSetSize -- on a 128 GB M5 Max
# that is 107.5 GiB, not 128. Reporting hw.memsize here would let a combination
# qualify and then die part-way through loading, which is exactly the failure
# this contract exists to prevent.

ACCEL_DESC=""; ACCEL_ARCH=""; ACCEL_MEM_MIB=0
ACCEL_MEM_SOURCE=""; ACCEL_RAM_MIB=0

qualify_accel() {
  info "Checking Apple silicon GPU..."

  [[ "$(uname -m)" == "arm64" ]] || err \
    "This combination needs Apple silicon; this machine reports $(uname -m).
       Intel Macs have no Metal GPU worth serving a model from."

  local chip
  chip="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo 'Apple silicon')"
  # "Apple M5 Max" -> m5. The generation is what changes kernel selection and
  # therefore what a build must be keyed on; the tier (Pro/Max/Ultra) only
  # changes how much of it there is.
  ACCEL_ARCH="$(printf '%s' "$chip" | sed -nE 's/.*Apple (M[0-9]+).*/\1/p' | tr 'A-Z' 'a-z')"
  ACCEL_ARCH="${ACCEL_ARCH:-unknown}"

  ACCEL_RAM_MIB=$(( $(sysctl -n hw.memsize) / 1048576 ))
  _metal_working_set_mib

  ACCEL_DESC="${chip} (${ACCEL_ARCH}, ${ACCEL_RAM_MIB} MiB unified memory, ${ACCEL_MEM_MIB} MiB usable by the GPU)"
  ok "GPU: ${ACCEL_DESC}"
  info "  GPU budget from ${ACCEL_MEM_SOURCE}."

  _qualify_unified_memory "$chip"
}

# Three sources, best first. Metal's own recommendedMaxWorkingSetSize is
# authoritative and is what MLX and llama.cpp both allocate against; the sysctl
# is only meaningful once someone has set it; the fraction is a last-resort
# estimate and says so, because a wrong number here is worse than an unknown.
_metal_working_set_mib() {
  local mib=""

  mib="$(_metal_mlx_working_set_mib || true)"
  if [[ -n "$mib" ]]; then
    ACCEL_MEM_MIB="$mib"
    ACCEL_MEM_SOURCE="Metal recommendedMaxWorkingSetSize (authoritative)"
    return
  fi

  local wired; wired="$(sysctl -n iogpu.wired_limit_mb 2>/dev/null || echo 0)"
  if [[ "${wired:-0}" -gt 0 ]]; then
    ACCEL_MEM_MIB="$wired"
    ACCEL_MEM_SOURCE="iogpu.wired_limit_mb (set explicitly on this machine)"
    return
  fi

  # macOS does not document the default wired limit and it varies with RAM.
  # 75% is the conservative end of the observed range (a 128 GB M5 Max
  # actually reports 84%), so this under-promises rather than over-promises.
  ACCEL_MEM_MIB=$(( ACCEL_RAM_MIB * 3 / 4 ))
  ACCEL_MEM_SOURCE="ESTIMATE: 75% of RAM -- Metal could not be queried"
  warn "Could not query Metal for the GPU's working-set limit; estimating 75% of RAM."
  warn "  Install MLX, or set iogpu.wired_limit_mb, for an exact figure."
}

# Ask Metal directly. Prefer an interpreter that already has MLX: the mtplx
# backend brings its own, and a plain python3 may not.
_metal_mlx_working_set_mib() {
  local py
  for py in python3 "${HOME}/.local/share/uv/tools/mtplx/bin/python"; do
    command -v "$py" >/dev/null 2>&1 || [[ -x "$py" ]] || continue
    "$py" - <<'PY' 2>/dev/null && return 0
import sys
try:
    import mlx.core as mx
except Exception:
    sys.exit(1)
try:
    info = mx.device_info()
except AttributeError:
    info = mx.metal.device_info()
n = info.get("max_recommended_working_set_size")
if not n:
    sys.exit(1)
print(n // (1024 * 1024))
PY
  done
  return 1
}

# Every profile and every context figure in a combination was measured against
# a specific memory budget. Refuse rather than half-install, with numbers.
_qualify_unified_memory() {
  local chip="$1"
  (( ACCEL_MEM_MIB >= MIN_DEVICE_MEM_MIB )) && return 0

  warn "=============================================================="
  warn " ${chip} gives the GPU ${ACCEL_MEM_MIB} MiB; this combination needs >=${MIN_DEVICE_MEM_MIB} MiB."
  warn "=============================================================="
  warn ""
  if declare -F low_memory_advice >/dev/null; then
    low_memory_advice "$ACCEL_MEM_MIB"
  fi
  warn ""
  warn " On Apple silicon you can raise the GPU's share of unified memory:"
  warn "   sudo sysctl iogpu.wired_limit_mb=<mib>     (resets at reboot)"
  warn " Leave the OS at least 8-16 GB or the machine will swap itself to death."
  warn ""
  if [[ "${ALLOW_LOW_VRAM:-0}" != "1" ]]; then
    err "Refusing to continue on ${ACCEL_MEM_MIB} MiB of GPU-usable memory.
       Override with ALLOW_LOW_VRAM=1 if you know the model fits."
  fi
  warn "ALLOW_LOW_VRAM=1 set -- continuing. Profiles will NOT fit; expect to tune CTX by hand."
}

# For a compiled backend (llama.cpp on Metal). MTPLX ships prebuilt and never
# calls these, but they are correct so the next Metal combination gets them.
accel_cmake_args() {
  printf '%s\n' -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_NATIVE=ON
}

# Rebuild when the chip generation changes; Metal kernels are selected per
# generation, and a binary built for one is not necessarily optimal on another.
accel_build_key() { printf 'metal=%s' "$ACCEL_ARCH"; }

# A binary built without Metal runs on the CPU and is far slower, so probe
# rather than trust the build log.
accel_probe_binary() { "$1" --list-devices 2>&1 | grep -qi 'metal'; }

# "<used_mib> <free_mib>" against the GPU budget, not against system RAM.
# vm_stat is the only cross-version way to ask macOS what is resident.
accel_report_mem() {
  local free_mib
  free_mib="$(vm_stat 2>/dev/null | awk '
    /page size of/ { for (i=1;i<=NF;i++) if ($i+0 > 0 && $i ~ /^[0-9]+$/) ps=$i }
    /Pages free/      { gsub(/\./,"",$3); f=$3 }
    /Pages inactive/  { gsub(/\./,"",$3); v=$3 }
    END { if (ps=="") ps=16384; printf "%d", (f+v)*ps/1048576 }')"
  [[ -n "$free_mib" && "$free_mib" -gt 0 ]] || return 1
  local used_mib=$(( ACCEL_MEM_MIB > free_mib ? ACCEL_MEM_MIB - free_mib : 0 ))
  printf '%s %s' "$used_mib" "$free_mib"
}

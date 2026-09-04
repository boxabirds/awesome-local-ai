#!/usr/bin/env bash
# lib/accel/cuda.sh -- NVIDIA CUDA qualification and build flags.
#
# Selected by ACCEL=cuda in a combination's config.sh. Exports:
#   ACCEL_DESC        human-readable device description for the summary
#   ACCEL_ARCH        compute capability, e.g. 89 -- used as a build cache key
#   ACCEL_MEM_MIB     total device memory
#   accel_cmake_args  cmake flags for the llama.cpp build

ACCEL_DESC=""; ACCEL_ARCH=""; ACCEL_MEM_MIB=0

qualify_accel() {
  info "Checking NVIDIA GPU & driver..."
  if ! need_cmd nvidia-smi; then
    warn "nvidia-smi not found. Install an NVIDIA driver >=${MIN_DRIVER_VERSION}, then re-run."
    can_sudo && run_as_root ubuntu-drivers autoinstall || true
    err "No NVIDIA driver detected; cannot continue."
  fi

  local driver_ver
  driver_ver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1 | cut -d. -f1)
  if [[ "${driver_ver:-0}" -lt "${MIN_DRIVER_VERSION}" ]]; then
    warn "Driver ${driver_ver} is old. Recommend >=${MIN_DRIVER_VERSION} for CUDA 12.x."
  else
    ok "NVIDIA driver v${driver_ver} OK."
  fi

  # Derive the CUDA arch from the actual GPU rather than hardcoding it.
  local cc
  cc=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1 | tr -d '.')
  ACCEL_ARCH="${cc:-89}"

  local gpu_name
  gpu_name=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
  ACCEL_MEM_MIB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1)
  ACCEL_DESC="${gpu_name} (sm_${ACCEL_ARCH}, ${ACCEL_MEM_MIB} MiB VRAM)"
  ok "GPU: ${ACCEL_DESC}"

  _qualify_vram "$gpu_name"
  _ensure_nvcc
}

# Every profile and every context figure in a combination was measured against
# a specific memory budget. Smaller cards need a smaller quant, so fail loudly
# with actionable numbers instead of letting the user discover it via a CUDA
# OOM 20 GB into a download.
_qualify_vram() {
  local gpu_name="$1"
  (( ACCEL_MEM_MIB >= MIN_DEVICE_MEM_MIB )) && return 0

  warn "=============================================================="
  warn " ${gpu_name} has ${ACCEL_MEM_MIB} MiB VRAM; this combination needs >=${MIN_DEVICE_MEM_MIB} MiB."
  warn "=============================================================="
  warn ""
  # Combination-supplied prose: which smaller quants exist and what they buy.
  if declare -F low_memory_advice >/dev/null; then
    low_memory_advice "$ACCEL_MEM_MIB"
  fi
  warn ""
  if [[ "${ALLOW_LOW_VRAM:-0}" != "1" ]]; then
    err "Refusing to continue on ${ACCEL_MEM_MIB} MiB VRAM. Override with ALLOW_LOW_VRAM=1 (and set QUANT)."
  fi
  warn "ALLOW_LOW_VRAM=1 set -- continuing with QUANT=${QUANT}. Profiles will NOT fit; use manual CTX/KV_TYPE."
}

# Reuse whatever CUDA toolkit is installed. 12.x is sufficient for Ada/Ampere;
# only Blackwell (sm_120) needs >=12.8.
_ensure_nvcc() {
  if ! need_cmd nvcc && [[ -x /usr/local/cuda/bin/nvcc ]]; then
    export PATH="/usr/local/cuda/bin:${PATH}"
  fi
  if need_cmd nvcc; then
    local cuda_ver
    cuda_ver=$(nvcc --version | grep -oP 'release \K[0-9]+\.[0-9]+')
    ok "nvcc ${cuda_ver} at $(command -v nvcc)"
    if [[ "$ACCEL_ARCH" -ge 120 ]] && [[ "${cuda_ver%%.*}" -eq 12 ]] \
       && [[ "${cuda_ver#*.}" -lt 8 ]]; then
      warn "sm_${ACCEL_ARCH} needs CUDA >=12.8 but nvcc is ${cuda_ver}; build may fail."
    fi
  else
    warn "nvcc not found. Install cuda-toolkit-12-6 (or newer) to build the CUDA backend."
    can_sudo && run_as_root apt-get install -y cuda-toolkit-12-6 || \
      err "CUDA toolkit required to build with GGML_CUDA=ON."
  fi
}

# "<used_mib> <free_mib>" for the smoke report. Optional part of the
# accelerator contract: a device that cannot report this simply omits it.
accel_report_mem() {
  need_cmd nvidia-smi || return 1
  local used free
  used=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1)
  free=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | head -1)
  printf '%s %s' "$used" "$free"
}

accel_cmake_args() {
  printf '%s\n' -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES="${ACCEL_ARCH}"
}

# Build cache key: rebuild when the target architecture changes.
accel_build_key() { printf 'cuda=%s' "$ACCEL_ARCH"; }

# Does the built binary actually see the device? A binary built without CUDA
# runs fine and is 50x slower, so probe rather than trust the build log.
accel_probe_binary() { "$1" --list-devices 2>&1 | grep -qi 'CUDA'; }

#!/usr/bin/env bash
# lib/accel/strix-halo.sh -- AMD Strix Halo (Ryzen AI Max, Radeon 8060S,
# gfx1151) qualification and build flags.
#
# Selected by ACCEL=strix-halo in a combination's config.sh. Exports:
#   ACCEL_DESC        human-readable device description for the summary
#   ACCEL_ARCH        gfx1151 -- the build cache key alongside the GPU API
#   ACCEL_MEM_MIB     the memory budget that constrains the model
#   accel_cmake_args  cmake flags for the llama.cpp build
#   accel_report_mem  "<used_mib> <free_mib>" for the smoke report
#
# ACCEL_MEM_MIB means what it means in lib/accel/cuda.sh and metal.sh: the
# budget that constrains the model. On Strix Halo that is neither the RAM nor
# the BIOS "VRAM" figure. Memory is unified, and the GPU reaches almost all of
# it through GTT, whose ceiling is the kernel's TTM page limit -- by default
# about half of RAM. A 128GB machine that has not raised it offers the GPU
# ~62 GB, which a 94 GB model will not fit in. So the limit is read, not
# assumed, and an install that would not fit is refused with the exact fix.
#
# Changing that limit needs a kernel parameter and a reboot, so this adapter
# reports and refuses; it never edits the boot configuration itself.
#
# Two GPU APIs build for this device, and neither is measured here yet; the
# combination's benchmarks run both. Set GPU_API at install time; the build
# key changes, so switching rebuilds rather than mixing.
#   GPU_API=vulkan  (default) RADV. Needs nothing beyond Mesa, and is where
#                   the published Strix Halo decode figures come from.
#   GPU_API=rocm    HIP. Needs a host ROCm install (hipconfig). llama.cpp
#                   before 2026-09-08 (#28604) returns wrong logits on gfx1151
#                   for prompts longer than the ubatch; the combination's
#                   MIN_LLAMA_COMMIT_DATE must be later than that.

ACCEL_DESC=""; ACCEL_ARCH="gfx1151"; ACCEL_MEM_MIB=0
ACCEL_RAM_MIB=0; ACCEL_VRAM_MIB=0; ACCEL_MEM_SOURCE=""
GPU_API="${GPU_API:-vulkan}"

# Strix Halo's integrated GPU is PCI 1002:1586. SYSFS_PCI (and PROC_MEMINFO,
# PROC_CMDLINE) are overridable so tests can fake a machine.
_sh_gpu_dir() {
  local d
  for d in "${SYSFS_PCI:-/sys/bus/pci/devices}"/*; do
    [[ -r "$d/vendor" && -r "$d/device" ]] || continue
    if [[ "$(cat "$d/vendor")" == "0x1002" && "$(cat "$d/device")" == "0x1586" ]]; then
      printf '%s' "$d"; return 0
    fi
  done
  return 1
}

# One amdgpu counter in MiB, or empty.
_sh_mib() {
  local dir="$1" f="$2"
  [[ -r "$dir/$f" ]] || return 0
  printf '%s' $(( $(cat "$dir/$f") / 1048576 ))
}

qualify_accel() {
  info "Checking AMD Strix Halo GPU (${GPU_API})..."
  case "$GPU_API" in
    vulkan|rocm) ;;
    *) err "GPU_API='${GPU_API}' is not one this adapter builds. Use vulkan (default) or rocm." ;;
  esac

  local gpu
  gpu="$(_sh_gpu_dir)" || err \
    "No AMD Strix Halo GPU (PCI 1002:1586) found.
       This combination was measured on a Ryzen AI Max+ 395 (Radeon 8060S, gfx1151).
       Other AMD GPUs need a combination of their own; see docs/adding-a-combination.md."

  _sh_qualify_kernel
  _sh_qualify_firmware
  _sh_qualify_render_node "$gpu"
  _sh_gtt_budget "$gpu"

  ACCEL_DESC="Radeon 8060S (gfx1151, ${GPU_API}), ${ACCEL_RAM_MIB} MiB RAM + ${ACCEL_VRAM_MIB} MiB BIOS carve-out, ${ACCEL_MEM_MIB} MiB addressable by the GPU"
  ok "GPU: ${ACCEL_DESC}"
  info "  GPU budget from ${ACCEL_MEM_SOURCE}."

  _sh_qualify_carveout
  _sh_qualify_lockup_timeout
  _sh_qualify_budget
  _sh_report_perf_level "$gpu"
  _sh_report_machine
  if [[ "$GPU_API" == "rocm" ]]; then _sh_ensure_hip; fi
}

# Kernels before 6.18.4 have a gfx1151 stability bug (the KFD fixes AMD lists
# as required). Ubuntu 26.04 ships 7.0; 24.04 needs its HWE or OEM kernel.
_sh_qualify_kernel() {
  local min="${MIN_KERNEL_VERSION:-6.18.4}" have
  have="$(uname -r | sed -E 's/^([0-9]+(\.[0-9]+){1,2}).*/\1/')"
  if version_ge "$have" "$min"; then
    ok "Kernel $(uname -r) (>= ${min})."
    return
  fi
  [[ "${ALLOW_OLD_KERNEL:-0}" == "1" ]] && {
    warn "Kernel $(uname -r) is older than ${min}; ALLOW_OLD_KERNEL=1 set, continuing."; return; }
  err "Kernel $(uname -r) is older than ${min}.
       Kernels before 6.18.4 have a gfx1151 stability bug. Ubuntu 26.04 ships 7.0;
       on 24.04 install the HWE kernel (>= 6.17.0-19.19~24.04.2) or OEM (>= 6.14.0-1018).
       Override at your own risk: ALLOW_OLD_KERNEL=1 \$0"
}

# linux-firmware 20251125 breaks ROCm on Strix Halo (reported by the kyuz0
# toolbox maintainers). Vulkan is not known to be affected, so this warns.
_sh_qualify_firmware() {
  need_cmd dpkg-query || return 0
  local v
  v="$(dpkg-query -W -f='${Version}' linux-firmware 2>/dev/null || true)"
  [[ -n "$v" ]] || return 0
  if [[ "$v" == *20251125* ]]; then
    warn "linux-firmware ${v} is the release reported to break ROCm on Strix Halo."
    warn "  Upgrade it (sudo apt install --only-upgrade linux-firmware) before trying GPU_API=rocm."
  else
    ok "linux-firmware ${v}."
  fi
}

# The build probes the binary for the device; without access to the render
# node that probe fails and every run would rebuild. Refuse up front instead.
_sh_qualify_render_node() {
  local gpu="$1" node=""
  node="$(ls -d "$gpu"/drm/renderD* 2>/dev/null | head -1)"
  [[ -n "$node" ]] || err "The Strix Halo GPU has no render node; is the amdgpu driver loaded? (lsmod | grep amdgpu)"
  node="/dev/dri/${node##*/}"
  if [[ -r "$node" && -w "$node" ]]; then
    ok "Render node ${node} is accessible."
    return
  fi
  err "Cannot open ${node:-the GPU render node} as $(id -un).
       Add yourself to the render and video groups, then log out and back in:
         sudo usermod -aG render,video $(id -un)"
}

# The budget is GTT, capped by TTM. amdgpu's own gtt total is authoritative
# when present; the TTM page limit is the fallback and, when set explicitly,
# the setting people change -- so report both.
_sh_gtt_budget() {
  local gpu="$1" pages ttm_mib gtt_mib
  ACCEL_RAM_MIB=$(( $(awk '/^MemTotal:/ {print $2}' "${PROC_MEMINFO:-/proc/meminfo}") / 1024 ))
  ACCEL_VRAM_MIB="$(_sh_mib "$gpu" mem_info_vram_total)"; ACCEL_VRAM_MIB="${ACCEL_VRAM_MIB:-0}"
  gtt_mib="$(_sh_mib "$gpu" mem_info_gtt_total)"
  pages="$(cat "${SYSFS_TTM:-/sys/module/ttm/parameters}/pages_limit" 2>/dev/null || echo 0)"
  ttm_mib=$(( ${pages:-0} * 4 / 1024 ))

  if [[ -n "$gtt_mib" && "$gtt_mib" -gt 0 ]]; then
    ACCEL_MEM_MIB="$gtt_mib"
    ACCEL_MEM_SOURCE="amdgpu mem_info_gtt_total (ttm.pages_limit=${pages} -> ${ttm_mib} MiB)"
  elif (( ttm_mib > 0 )); then
    ACCEL_MEM_MIB="$ttm_mib"
    ACCEL_MEM_SOURCE="ttm.pages_limit=${pages}"
  else
    ACCEL_MEM_MIB=$(( ACCEL_RAM_MIB / 2 ))
    ACCEL_MEM_SOURCE="ESTIMATE: half of RAM, the kernel default (neither counter was readable)"
  fi
}

# A BIOS carve-out is taken from Linux permanently and buys nothing on a
# unified-memory APU: the GPU reads the same DRAM through GTT at the same
# speed. AMD's ROCm guidance for Strix Halo is to keep it small (0.5 GB).
_sh_qualify_carveout() {
  (( ACCEL_VRAM_MIB > 4096 )) || return 0
  warn "The BIOS reserves ${ACCEL_VRAM_MIB} MiB as dedicated VRAM; Linux cannot use it for anything else."
  warn "  On Strix Halo it gives the GPU no speed advantage. Set it to the smallest offered"
  warn "  (512M where the BIOS has it; 1G is the floor on the MS-S1 MAX):"
  warn "  BIOS -> Advanced -> AMD CBS -> NBIO Common Options -> GFX Configuration"
  warn "    iGPU Configuration = UMA_Specified, UMA Frame Buffer Size = 512M (or 1G)"
  warn "  then raise the GTT limit instead (see below if it is short)."
}

# Refuse with the fix, not with an OOM 90 GB into a load.
_sh_qualify_budget() {
  # The GTT limit is a ceiling, not an allocation; what protects Linux if the
  # GPU ever nears it is RAM outside the ceiling plus swap. The recommended
  # 120 GiB on a 128 GB box leaves ~2 GiB of RAM, so swap is the cushion, and
  # Ubuntu's installer creates 8 GiB of it: that setup should not warn.
  local reserve="${MIN_OS_RESERVE_MIB:-6144}" swap_kib swap_mib outside
  swap_kib="$(awk '/^SwapTotal:/ {print $2}' "${PROC_MEMINFO:-/proc/meminfo}" 2>/dev/null)"
  swap_mib=$(( ${swap_kib:-0} / 1024 ))
  outside=$(( ACCEL_RAM_MIB - ACCEL_MEM_MIB ))
  if (( outside + swap_mib < reserve )); then
    warn "The GPU may address ${ACCEL_MEM_MIB} of ${ACCEL_RAM_MIB} MiB, leaving under ${reserve} MiB for Linux."
    warn "  A full context can then push sshd and friends into the OOM killer. Add swap, or lower the limit."
  elif (( outside < reserve )); then
    info "  The GPU may address ${ACCEL_MEM_MIB} of ${ACCEL_RAM_MIB} MiB; ${swap_mib} MiB of swap covers Linux if it nears that."
  fi
  (( ACCEL_MEM_MIB >= MIN_DEVICE_MEM_MIB )) && return 0

  local want_gib=$(( (MIN_DEVICE_MEM_MIB + 1023) / 1024 ))
  local target_gib="${STRIX_HALO_GTT_TARGET_GIB:-120}"
  (( target_gib < want_gib )) && target_gib="$want_gib"
  warn "=============================================================="
  warn " The GPU may address ${ACCEL_MEM_MIB} MiB; this combination needs >=${MIN_DEVICE_MEM_MIB} MiB."
  warn "=============================================================="
  warn " On Strix Halo that limit is a kernel setting, not the hardware. Raise it"
  warn " to ${target_gib} GiB with AMD's tool, then reboot:"
  warn "   pipx install amd-debug-tools && amd-ttm --set ${target_gib} && sudo reboot"
  warn " or by hand on the kernel command line (/etc/default/grub, then"
  warn " sudo update-grub && sudo reboot):"
  warn "   ttm.pages_limit=$(( target_gib * 262144 ))"
  warn " Do NOT also set ttm.page_pool_size: a large page pool has been reported"
  warn " to deadlock gfx1151 under load."
  if declare -F low_memory_advice >/dev/null; then low_memory_advice "$ACCEL_MEM_MIB"; fi
  if [[ "${ALLOW_LOW_VRAM:-0}" != "1" ]]; then
    err "Refusing to continue with ${ACCEL_MEM_MIB} MiB addressable. Fix the limit above, or ALLOW_LOW_VRAM=1 with a smaller QUANT."
  fi
  warn "ALLOW_LOW_VRAM=1 set -- continuing. Profiles will NOT fit as measured."
}

# 'auto' lets the GPU clock float well under its peak during decode. Pinning
# it needs root, so report it rather than change it.
_sh_report_perf_level() {
  local gpu="$1" f level
  f="$gpu/power_dpm_force_performance_level"
  [[ -r "$f" ]] || return 0
  level="$(cat "$f")"
  if [[ "$level" == "auto" ]]; then
    info "  GPU performance level is 'auto'. For benchmarks, pin it (resets at reboot):"
    info "    echo high | sudo tee ${f}"
  else
    ok "GPU performance level: ${level}."
  fi
}

# Which box this is. Combinations list the machines they were measured on in
# TESTED_ON; anything else with the same chip and memory is offered the
# combination, and told plainly that its numbers were not measured there.
_sh_report_machine() {
  local vendor product slug entry
  vendor="$(cat "${SYSFS_DMI:-/sys/class/dmi/id}/sys_vendor" 2>/dev/null || true)"
  product="$(cat "${SYSFS_DMI:-/sys/class/dmi/id}/product_name" 2>/dev/null || true)"
  [[ -n "$product" ]] || return 0
  ACCEL_DESC="${ACCEL_DESC}; ${vendor} ${product}"
  [[ -n "${TESTED_ON:-}" ]] || return 0
  # Vendor strings are legal names ("Micro Computer (HK) Tech Limited" for
  # Minisforum), so match on the product: TESTED_ON's "minisforum-ms-s1-max"
  # ends with the DMI product "MS-S1 MAX" slugged.
  slug="$(_sh_slug "$product")"
  for entry in $TESTED_ON; do
    if [[ "$entry" == "$slug" || "$entry" == *"-${slug}" ]]; then
      ok "Machine: ${vendor} ${product} -- one this combination was measured on."
      return 0
    fi
  done
  {
    warn "Machine: ${vendor} ${product}."
    warn "  This combination was measured on: ${TESTED_ON}."
    warn "  Same chip, different box: expect different numbers, especially if its"
    warn "  power limit is lower. If it works, please report back."
  }
}

# Since Linux 7.0 amdgpu kills a compute job after 2 s (it was 60 s), and a
# long Vulkan dispatch on a big model can take that long: the server dies
# with vk::DeviceLostError a few turns in (llama.cpp #25664, #27076). The fix
# is a kernel parameter, so report it; never edit the boot configuration.
_sh_qualify_lockup_timeout() {
  local cmdline
  cmdline="$(cat "${PROC_CMDLINE:-/proc/cmdline}" 2>/dev/null || true)"
  if [[ "$cmdline" == *amdgpu.lockup_timeout=* ]]; then
    ok "amdgpu.lockup_timeout is set on the kernel command line."
    return 0
  fi
  warn "amdgpu.lockup_timeout is not set. Since Linux 7.0 a GPU job is killed after 2 s,"
  warn "  which crashes long runs with vk::DeviceLostError. Add to the kernel command line:"
  warn "    amdgpu.lockup_timeout=10000,60000,10000,10000"
  warn "  (/etc/default/grub.d/, then sudo update-grub && sudo reboot)"
}

_sh_slug() { printf '%s' "$1" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'; }

# ROCm needs a host HIP toolchain. The Ubuntu archive carries one; AMD's own
# repository carries newer. Neither is installed for you: which ROCm is a
# decision.
_sh_ensure_hip() {
  if ! need_cmd hipconfig && [[ -x /opt/rocm/bin/hipconfig ]]; then
    export PATH="/opt/rocm/bin:${PATH}"
  fi
  need_cmd hipconfig || err \
    "GPU_API=rocm needs a ROCm install (hipconfig not found).
       Ubuntu 26.04: sudo apt install rocm   -- or use the default GPU_API=vulkan."
  HIPCXX="$(hipconfig -l)/clang"; HIP_PATH="$(hipconfig -R)"
  export HIPCXX HIP_PATH
  ok "ROCm: $(hipconfig --version 2>/dev/null | head -1) at ${HIP_PATH}"
}

# "<used_mib> <free_mib>". Free is the smaller of GTT headroom and what Linux
# says it can hand out: on unified memory, 'GTT free' alone overstates it.
accel_report_mem() {
  local gpu used_gtt used_vram total_gtt avail
  gpu="$(_sh_gpu_dir)" || return 1
  used_gtt="$(_sh_mib "$gpu" mem_info_gtt_used)"
  used_vram="$(_sh_mib "$gpu" mem_info_vram_used)"
  total_gtt="$(_sh_mib "$gpu" mem_info_gtt_total)"
  avail=$(( $(awk '/^MemAvailable:/ {print $2}' "${PROC_MEMINFO:-/proc/meminfo}") / 1024 ))
  [[ -n "$used_gtt" && -n "$total_gtt" ]] || return 1
  local free=$(( total_gtt - used_gtt ))
  (( avail < free )) && free="$avail"
  printf '%s %s' "$(( used_gtt + ${used_vram:-0} ))" "$free"
}

accel_cmake_args() {
  case "$GPU_API" in
    rocm)   printf '%s\n' -DGGML_HIP=ON -DGPU_TARGETS=gfx1151 -DAMDGPU_TARGETS=gfx1151 ;;
    *)      printf '%s\n' -DGGML_VULKAN=ON ;;
  esac
}

# Rebuild when the GPU API changes: a Vulkan and a HIP binary are not
# interchangeable, and the probe below would catch a mismatch only after the fact.
accel_build_key() { printf 'strix-halo=%s;%s' "$GPU_API" "$ACCEL_ARCH"; }

# A binary built without the GPU backend runs on the CPU, many times slower.
accel_probe_binary() {
  case "$GPU_API" in
    rocm) "$1" --list-devices 2>&1 | grep -qiE 'ROCm|HIP' ;;
    *)    "$1" --list-devices 2>&1 | grep -qiE 'Vulkan|RADV' ;;
  esac
}

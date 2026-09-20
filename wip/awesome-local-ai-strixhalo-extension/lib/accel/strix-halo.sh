#!/usr/bin/env bash
# File: lib/accel/strix-halo.sh

function qualify_accelerator() {
    echo "Checking hardware UMA tracks for Strix Halo APU..."
    
    local total_mem=$(free -g | awk '/^Mem:/{print $2}')
    if [ "$total_mem" -lt 120 ]; then
        echo "Error: This combination requires a 128GB physical RAM pool. Found: ${total_mem}GB" >&2
        return 1
    fi

    if [ -f /sys/module/amdgpu/parameters/gttsize ]; then
        local current_gtt=$(cat /sys/module/amdgpu/parameters/gttsize)
        if [ "$current_gtt" -lt 90000 ]; then
            echo "Warning: Current amdgpu.gttsize ($current_gtt) is too low for a 110GB model footprint." >&2
            echo "Please ensure your /etc/default/grub contains: amdgpu.gttsize=114688" >&2
            echo "Run 'sudo grub-mkconfig -o /boot/grub/grub.cfg' and reboot before installing." >&2
            return 1
        fi
    fi
    return 0
}

function get_backend_build_flags() {
    echo "-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1150 -DGGML_MOE_EXPERT_TABLE=ON -DGGML_MOE_HOST_EXPERTS=ON -DGGML_MOE_PAGE_IN=ON"
}

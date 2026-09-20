#!/usr/bin/env bash
# File: lib/model-additions.sh

function preprocess_turboquant_model() {
    local base_dir="$1"
    local output_file="$2"
    local quant_target="$3"
    
    local raw_hf_dir="${base_dir}/raw-download"
    local baseline_master="${base_dir}/baseline-master.gguf"
    local tmp_output="${output_file}.tmp"
    local progress_log="${base_dir}/quantize_progress.log"

    echo "========================================================================"
    echo "🚨 ARCHITECTURAL NOTICE: OFFLINE WEIGHT RESTRUCTURING"
    echo "========================================================================"
    echo "This step physically shatters the model's contiguous MoE matrix layout"
    echo "into byte-aligned targets. Because this is a massive 176B parameter footprint:"
    echo " • Phase 1 (Python F16 Conversion) takes ~60-75 minutes (Disk/Single-Thread)."
    echo " • Phase 2 (C++ TQ Quantization) takes ~20-30 minutes (All 16 Cores at 100%)."
    echo "Total Expected Duration: 1.5 to 2 Hours."
    echo "This script is fully IDEMPOTENT and RESUMABLE if interrupted."
    echo "========================================================================"
    echo ""

    # Check if a custom Hugging Face repo source is already configured to download directly
    if [ -n "$CUSTOM_HF_REPO" ]; then
        echo "🌐 Custom remote Hugging Face repository source detected: $CUSTOM_HF_REPO"
        if [ -f "$output_file" ] && [ -s "$output_file" ]; then
            echo "✅ Validated existing customized file. Skipping download pipeline."
            return 0
        fi
        echo "📥 Downloading pre-compiled target file from your remote store..."
        huggingface-cli download "$CUSTOM_HF_REPO" "$CUSTOM_HF_FILE" --local-dir "$base_dir"
        mv "${base_dir}/${CUSTOM_HF_FILE}" "$output_file"
        return 0
    fi

    if [ -f "$output_file" ] && [ -s "$output_file" ]; then
        echo "✅ Validated existing custom TQ file structure. Skipping entire pipeline."
        return 0
    fi

    if [ -f "$baseline_master" ] && [ -s "$baseline_master" ]; then
        echo "🔄 Found valid baseline-master.gguf from a previous run. Skipping Phase 1."
    else
        echo "🚀 Starting Phase 1/2: Compiling Safetensors to High-Precision GGUF..."
        rm -f "$progress_log"

        python3 llama-cpp-turboquant/convert_hf_to_gguf.py "$raw_hf_dir" --outtype f16 --outfile "$baseline_master" > "$progress_log" 2>&1 &
        local pid=$!

        while kill -0 $pid 2>/dev/null; do
            sleep 30
            if [ -f "$progress_log" ]; then
                local current_tensor=$(grep -c "Wrote tensor" "$progress_log" || echo "0")
                local est_percent=$(( current_tensor * 100 / 3400 ))
                if [ "$est_percent" -gt 100 ]; then est_percent=100; fi
                echo "⏳ [Phase 1 Progress] $(date +%H:%M:%S) | Tensors Written: $current_tensor/~3400 | Est: ${est_percent}% complete."
            else
                echo "⏳ [Phase 1 Progress] Initializing environment pipelines..."
            fi
        done

        wait $pid
        if [ $? -ne 0 ]; then
            echo "❌ Error: Phase 1 conversion failed. See logs at: $progress_log" >&2
            return 1
        fi
        echo "✅ Phase 1 Complete! Baseline master built successfully."
    fi

    echo "🚀 Starting Phase 2/2: Structurally isolating MoE blocks to ${quant_target}..."
    rm -f "$tmp_output"
    rm -f "$progress_log"

    local build_quantize_bin="./build/bin/llama-quantize"
    if [ ! -f "$build_quantize_bin" ]; then
        echo "❌ Error: Quantization binary missing at $build_quantize_bin" >&2
        return 1
    fi

    "$build_quantize_bin" "$baseline_master" "$tmp_output" "$quant_target" > "$progress_log" 2>&1 &
    local pid_q=$!

    while kill -0 $pid_q 2>/dev/null; do
        sleep 30
        if [ -f "$progress_log" ]; then
            local current_q=$(grep "quantizing" "$progress_log" | tail -n 1 | awk -F'[' '{print $2}' | awk -F'/' '{print $1}' | tr -d ' ' || echo "0")
            if [[ "$current_q" =~ ^[0-9]+$ ]] && [ "$current_q" -gt 0 ]; then
                local est_q_percent=$(( current_q * 100 / 3400 ))
                echo "⚡ [Phase 2 Progress] $(date +%H:%M:%S) | Quantizing Layers: $current_q/3400 | Est: ${est_q_percent}% complete."
            else
                echo "⚡ [Phase 2 Progress] All 16 CPU Cores engaged. Saturating memory bus..."
            fi
        fi
    done

    wait $pid_q
    if [ $? -ne 0 ]; then
        echo "❌ Error: Phase 2 weight alignment failed. See logs at: $progress_log" >&2
        rm -f "$tmp_output"
        return 1
    fi

    mv "$tmp_output" "$output_file"
    echo "✅ Phase 2 Complete! Model structures are atomically locked."
    
    echo "🧹 Cleaning up intermediate setup file structures to reclaim disk space..."
    rm -f "$baseline_master"
    rm -f "$progress_log"
    rm -rf "$raw_hf_dir" 

    echo "🎉 SUCCESS: Your Minisforum AI Box is optimized and ready."
    
    # Present option to run the Hugging Face preservation tool
    echo "========================================================================"
    echo "📤 OPTIONAL DISTRIBUTION TASK"
    echo "========================================================================"
    echo "You can preserve this compiled asset in your personal Hugging Face Hub."
    echo "This eliminates local compilation overhead on future machine nodes."
    echo "Run the preservation workflow now? [y/N]"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        if [ -f "./upload-to-hf.sh" ]; then
            ./upload-to-hf.sh "$output_file"
        else
            echo "Error: ./upload-to-hf.sh script utility not found." >&2
        fi
    fi
    return 0
}

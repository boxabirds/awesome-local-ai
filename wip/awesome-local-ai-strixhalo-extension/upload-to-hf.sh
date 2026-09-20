#!/usr/bin/env bash
# File: upload-to-hf.sh
# ---------------------------------------------------------------------
# Awesome-Local-AI: Automated Hugging Face Preservation Utility
# ---------------------------------------------------------------------

set -eo pipefail

TARGET_FILE="${1:-}"
if [ -z "$TARGET_FILE" ] || [ ! -f "$TARGET_FILE" ]; then
    echo "Error: Please specify a valid physical file path to upload." >&2
    echo "Usage: $0 /path/to/model.gguf" >&2
    exit 1
fi

echo "========================================================================"
    echo "📤 HUGGING FACE PRESERVATION RUNTIME PIPELINE"
echo "========================================================================"

# Validate Hugging Face authentication status
if ! huggingface-cli whoami >/dev/null 2>&1; then
    echo "🔓 Hugging Face CLI login authorization token missing."
    echo "Please configure your write token sequence below."
    huggingface-cli login
fi

echo "Please declare the targeted destination repository workspace profile (e.g., 'username/repo-name'):"
read -r target_repo

if [ -z "$target_repo" ]; then
    echo "Error: Target repository declaration path target cannot be empty." >&2
    exit 1
fi

# Ensure repository infrastructure is allocated on the remote server
echo "Validating remote space bounds for: $target_repo..."
huggingface-cli repo create "$target_repo" --type model || echo "Repository target workspace already initialized."

# Execute high-throughput block upload loop
filename=$(basename "$TARGET_FILE")
echo "Streaming bits to the cloud network layer: $filename ──► $target_repo"
huggingface-cli upload "$target_repo" "$TARGET_FILE" "$filename"

echo "✅ File transfer step successfully closed out!"

# Automatically rewrite the combination configuration to make this the default source
CONFIG_FILE="combinations/qwen/3.8/flash-next/ubuntu/128GB/turboquant/config.sh"
if [ -f "$CONFIG_FILE" ]; then
    echo "🔧 Adapting internal environment variables to point to your new remote target..."
    sed -i "s|export CUSTOM_HF_REPO=.*|export CUSTOM_HF_REPO=\"$target_repo\"|g" "$CONFIG_FILE"
    echo "✅ Configuration updated locally. Future provisions will bypass compilation."
    
    echo ""
    echo "💡 Would you like to commit and push this change to your repository branch? [y/N]"
    read -r git_response
    if [[ "$git_response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        git add "$CONFIG_FILE"
        git commit -m "feat(qwen): lock in pre-compiled custom user HF repository target"
        if git push; then
            echo "🚀 Configuration change pushed upstream. Your awesome-local-ai repo is locked in."
        else
            echo "Warning: Git push failed. Please push your configuration modifications manually." >&2
        fi
    fi
fi

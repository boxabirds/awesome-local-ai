#!/usr/bin/env bash
# lib/model.sh -- obtain the model weights.
#
# Two shapes of backend exist, so this file dispatches rather than assuming:
#
#   * Single files from the Hub (llama.cpp): a combination declares
#     MODEL_ASSETS, one "repo|filename|role|approx-size" record per line. Roles
#     are free-form except for `model`, which is required; `mmproj` and `mtp`
#     are recognised by the runtime. A missing optional asset degrades (no
#     vision / no speculative decoding) rather than failing the install.
#
#   * Whole model repos fetched by the backend's own tool (mtplx). The backend
#     defines backend_fetch_model and owns everything, including where the
#     files live -- its cache may sensibly sit outside the install root.
#
# Both paths must be idempotent: re-running an installer is the supported way
# to regenerate the runtime after a config change, and it must never re-fetch
# weights that are already on disk.

# MODEL_ARTIFACT is what the backend will be pointed at -- a file for
# llama.cpp, a directory for mtplx. MODEL_GGUF is the llama.cpp-specific alias.
MODEL_ARTIFACT=""; MODEL_GGUF=""; MMPROJ=""; MTP_HEAD=""

ensure_model() {
  if declare -F backend_fetch_model >/dev/null; then
    backend_fetch_model
    return
  fi
  _model_fetch_hf_files
}

# `hf download` is itself resumable and idempotent -- it keeps partial data in
# <dir>/.cache/huggingface/download/*.incomplete and only publishes the final
# path on completion, so a file present at the final path is a complete file.
# The one case that check misses is a file truncated after the fact (a full
# disk, a killed `cp`), so sanity-check the size against what the combination
# declared before trusting it.
_model_fetch_hf_files() {
  info "Ensuring ${MODEL_DISPLAY_NAME} assets..."
  local repo file role size

  while IFS='|' read -r repo file role size; do
    [[ -z "${repo// }" || "$repo" == \#* ]] && continue
    if _asset_is_complete "${MODEL_DIR}/${file}" "$size"; then
      ok "${role}: ${file} already present ($(human_size "${MODEL_DIR}/${file}"))."
    else
      if [[ -f "${MODEL_DIR}/${file}" ]]; then
        warn "${role}: ${file} is present but smaller than the declared ${size}; re-fetching."
        rm -f "${MODEL_DIR}/${file}"
      fi
      info "Downloading ${file} from ${repo} (${size})..."
      # Resumes automatically from any .incomplete blob left by an earlier run.
      if ! hf download "$repo" --include "$file" --local-dir "$MODEL_DIR"; then
        if [[ "$role" == "model" ]]; then
          err "Failed to download the model weights (${file} from ${repo}).
       Re-run this installer to resume; partial data is kept."
        fi
        warn "${role} download failed; the feature it enables will be disabled."
        warn "Re-run the installer to retry -- the partial download is kept."
        continue
      fi
    fi
    case "$role" in
      model)  MODEL_GGUF="${MODEL_DIR}/${file}" ;;
      mmproj) MMPROJ="${MODEL_DIR}/${file}" ;;
      mtp)    MTP_HEAD="${MODEL_DIR}/${file}" ;;
    esac
  done <<< "$MODEL_ASSETS"

  [[ -n "$MODEL_GGUF" && -f "$MODEL_GGUF" ]] || err "Could not locate the model weights after download."
  MODEL_ARTIFACT="$MODEL_GGUF"

  ok "Model  : $MODEL_GGUF ($(human_size "$MODEL_GGUF"))"
  if [[ -n "$MMPROJ"   && -f "$MMPROJ"   ]]; then ok "Vision : $MMPROJ";   else MMPROJ="";   warn "mmproj missing (vision disabled)."; fi
  if [[ -n "$MTP_HEAD" && -f "$MTP_HEAD" ]]; then ok "MTP    : $MTP_HEAD"; else MTP_HEAD=""; warn "MTP head missing (speculative decoding disabled)."; fi
}

# Present, non-empty, and within 10% of the size the combination declared.
# The declared size is prose ("16.7 GiB"), so parse it loosely and skip the
# comparison entirely if it does not look like a size -- a missing check is
# better than a false alarm that deletes a good 17 GB file.
_asset_is_complete() {
  local path="$1" declared="$2"
  [[ -s "$path" ]] || return 1

  local num unit want_bytes have_bytes
  num="$(printf '%s' "$declared" | sed -nE 's/^[[:space:]]*([0-9]+(\.[0-9]+)?).*/\1/p')"
  unit="$(printf '%s' "$declared" | sed -nE 's/^[[:space:]]*[0-9.]+[[:space:]]*([KMGT]i?B).*/\1/p')"
  [[ -n "$num" && -n "$unit" ]] || return 0

  case "$unit" in
    GiB) want_bytes=$(awk -v n="$num" 'BEGIN{printf "%d", n*1024*1024*1024}') ;;
    MiB) want_bytes=$(awk -v n="$num" 'BEGIN{printf "%d", n*1024*1024}') ;;
    GB)  want_bytes=$(awk -v n="$num" 'BEGIN{printf "%d", n*1000*1000*1000}') ;;
    MB)  want_bytes=$(awk -v n="$num" 'BEGIN{printf "%d", n*1000*1000}') ;;
    *)   return 0 ;;
  esac

  have_bytes=$(wc -c < "$path" | tr -d ' ')
  awk -v h="$have_bytes" -v w="$want_bytes" 'BEGIN{exit !(h >= w*0.9)}'
}

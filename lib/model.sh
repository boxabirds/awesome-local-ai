#!/usr/bin/env bash
# lib/model.sh -- fetch GGUF weights and sidecars from the Hub.
#
# A combination declares which files it needs as MODEL_ASSETS: one
# "repo|filename|role|approx-size" record per line. Roles are free-form except
# for `model`, which is required; `mmproj` and `mtp` are recognised by the
# runtime. A missing optional asset degrades (no vision / no speculative
# decoding) rather than failing the install.

MODEL_GGUF=""; MMPROJ=""; MTP_HEAD=""

ensure_model() {
  info "Ensuring ${MODEL_DISPLAY_NAME} assets..."
  local line repo file role size

  while IFS='|' read -r repo file role size; do
    [[ -z "${repo// }" || "$repo" == \#* ]] && continue
    if [[ -f "${MODEL_DIR}/${file}" ]]; then
      ok "${role}: ${file} already present."
    else
      info "Downloading ${file} from ${repo} (${size})..."
      if ! hf download "$repo" --include "$file" --local-dir "$MODEL_DIR"; then
        if [[ "$role" == "model" ]]; then
          err "Failed to download the model weights (${file} from ${repo})."
        fi
        warn "${role} download failed; the feature it enables will be disabled."
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

  ok "Model  : $MODEL_GGUF ($(human_size "$MODEL_GGUF"))"
  if [[ -n "$MMPROJ"   && -f "$MMPROJ"   ]]; then ok "Vision : $MMPROJ";   else MMPROJ="";   warn "mmproj missing (vision disabled)."; fi
  if [[ -n "$MTP_HEAD" && -f "$MTP_HEAD" ]]; then ok "MTP    : $MTP_HEAD"; else MTP_HEAD=""; warn "MTP head missing (speculative decoding disabled)."; fi
}

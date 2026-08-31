#!/usr/bin/env bash
# lib/hf.sh -- Hugging Face CLI, shared by every combination that pulls
# weights from the Hub.

ensure_hf() {
  info "Ensuring huggingface_hub (hf CLI) + hf_transfer..."
  if need_cmd hf; then
    ok "hf CLI present: $(hf version 2>/dev/null | head -1)"
  else
    python3 -m pip install --user -q -U "huggingface_hub[cli]"
    hash -r
    need_cmd hf || err "hf CLI install failed."
  fi
  # hf_transfer gives a large speedup on multi-GB pulls, but only if it is
  # actually switched on -- installing it alone does nothing.
  python3 -c 'import hf_transfer' 2>/dev/null || python3 -m pip install --user -q -U hf_transfer
  if python3 -c 'import hf_transfer' 2>/dev/null; then
    export HF_HUB_ENABLE_HF_TRANSFER=1
    ok "hf_transfer enabled."
  else
    warn "hf_transfer unavailable; downloads will use the slower default backend."
  fi
}

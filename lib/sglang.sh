#!/usr/bin/env bash
# lib/sglang.sh -- SGLang backend adapter, served from a container image.
#
# Backend contract (docs/adding-a-combination.md):
#   ensure_backend          Docker + NVIDIA Container Toolkit + the image, by digest
#   backend_fetch_model     the weights, at a pinned revision, hash-verified
#   backend_profile_table   render profiles.tsv
#   backend_smoke_context   report the served context window
#   backend_smoke_assert    prove speculative decoding is actually live
#   sglang_sha              version string for the summary
#
# How this differs from the other two backends:
#
#   1. Nothing is built or pip-installed on the host. The engine, its CUDA
#      kernels and any plugin ship inside one image, pulled BY DIGEST so the
#      thing that runs is byte-for-byte the thing a recipe was measured with.
#      A tag can move; a digest cannot.
#   2. The weights live on the host and are bind-mounted read-only into the
#      container, at the path the recipe's argv names. They are fetched at a
#      pinned Hugging Face revision (a commit, not a branch) and verified
#      against published sha256 hashes when the combination supplies them.
#
# Everything model-specific is DATA in the combination's config.sh: the image
# digest, the repo and revision, the hashes, the container-side model path,
# the environment and the SGLang argv. This file knows none of it.

BACKEND_NEEDS_BUILD_TOOLS=0
# The hf CLI is needed, but only to fill this backend's own cache -- which lives
# outside the install root -- so this adapter ensures it itself rather than
# letting bootstrap create an empty models/ directory under the install root.
BACKEND_NEEDS_HF=0

# The weights directory name and its cache location are derived at fetch time
# (like mtplx), so MODEL_SUBDIR is not required of the combination.
BACKEND_REQUIRED_VARS="SGLANG_IMAGE MODEL_REPO MODEL_REVISION MODEL_WEIGHTS_DIR SGLANG_CONTAINER_MODEL_DIR SGLANG_CONTAINER_PORT SGLANG_BASE_ARGS MIN_DRIVER_VERSION"

# profiles.tsv columns for this backend. A profile varies only what the recipes
# themselves vary between runs; everything else is the combination's base argv.
#   ctx            --context-length
#   mem_frac       --mem-fraction-static
#   prefill_graph  1 = prefill CUDA graphs on, 0 = --disable-prefill-cuda-graph
#   need_mib       free VRAM the profile needs at launch (see each file's header)
#   basis          where the profile came from: RECIPE-<date> or EXTRAPOLATED
PROFILE_SCHEMA="name|ctx|mem_frac|prefill_graph|need_mib|basis|summary"

# No KV-type switch: the KV dtype is part of the recipe's argv.
SAFE_KV_TYPES="${SAFE_KV_TYPES:-n/a}"

# Where the weights go. Shared by every SGLang combination, relative to $HOME
# so no absolute path is baked into the manifest, and overridable.
SGLANG_MODEL_CACHE_REL="${SGLANG_MODEL_CACHE_REL:-.cache/awesome-local-ai/sglang-models}"

# Minimum host CUDA version the image's userspace needs (the image's own
# NVIDIA_REQUIRE_CUDA). The host driver must support at least this.
SGLANG_MIN_HOST_CUDA="${SGLANG_MIN_HOST_CUDA:-}"

# The model is loaded from a read-only mount; a first boot also captures CUDA
# graphs. The recipes report ~80 s to ready on a warm page cache; a cold disk
# is slower. The smoke test's default of 180 s is too tight for that.
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-900}"

# The MTP head ships inside the checkpoint; there is no separate sidecar asset.
BACKEND_MTP_INTERNAL=1

SGLANG_IMAGE_VERSION=""

# Turn thinking off for the generic smoke test's "Reply with exactly: OK": the
# point there is that the server generates, and Qwen3.6's template has no
# effort control, so a default-thinking reply can exhaust 256 tokens before
# any content appears. Speculative decoding is proven separately below.
if [[ -z "${SMOKE_REQUEST_EXTRA:-}" ]]; then
  SMOKE_REQUEST_EXTRA='"chat_template_kwargs":{"enable_thinking":false}'
fi

# Everything the launcher needs that the generic manifest does not carry.
# %q keeps multi-line argv and JSON intact when install.env is sourced.
backend_manifest_extra() {
  local v
  echo
  echo "# sglang backend (lib/sglang.sh)"
  for v in SGLANG_IMAGE SGLANG_CONTAINER_MODEL_DIR SGLANG_CONTAINER_PORT SGLANG_SHM_SIZE \
           SGLANG_BASE_ARGS SGLANG_ENV ACCEL_ARCHS_VERIFIED; do
    printf '%s=%q\n' "$v" "${!v:-}"
  done
}

# ---- install --------------------------------------------------------------

ensure_backend() {
  info "Ensuring Docker, the NVIDIA Container Toolkit and the SGLang image..."
  _sglang_require_docker
  _sglang_require_nvidia_runtime
  _sglang_require_host_cuda
  _sglang_pull_image
  _sglang_probe_gpu_in_container
}

_sglang_require_docker() {
  need_cmd docker || err "Docker is not installed.
       This combination runs SGLang from a container image. Install Docker Engine:
         https://docs.docker.com/engine/install/ubuntu/
       then re-run this installer."

  local out
  if ! out="$(docker info --format '{{.ServerVersion}}' 2>&1)"; then
    if printf '%s' "$out" | grep -qi 'permission denied'; then
      err "Docker is installed but this user cannot talk to the daemon.
       Add yourself to the docker group, then log out and back in:
         sudo usermod -aG docker \$USER
       (or run the installer from a shell that already has the group)."
    fi
    err "Docker is installed but the daemon is not answering:
         ${out}
       Start it with:  sudo systemctl enable --now docker"
  fi
  ok "Docker ${out}"
}

# Two ways a GPU reaches a container: the legacy 'nvidia' runtime registered in
# the daemon, or CDI specs generated by nvidia-ctk. Either is fine for
# `docker run --gpus`; neither is a refusal with the exact fix.
_sglang_require_nvidia_runtime() {
  local runtimes
  runtimes="$(docker info --format '{{json .Runtimes}}' 2>/dev/null || true)"
  if printf '%s' "$runtimes" | grep -q '"nvidia"'; then
    ok "NVIDIA container runtime registered with Docker."
    return 0
  fi
  if need_cmd nvidia-ctk && nvidia-ctk cdi list 2>/dev/null | grep -q 'nvidia.com/gpu'; then
    ok "NVIDIA CDI devices available (nvidia-ctk)."
    return 0
  fi
  err "Docker cannot see the GPU: the NVIDIA Container Toolkit is not set up.
       Install and register it (Ubuntu):
         curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \\
           | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
         curl -sL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \\
           | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \\
           | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
         sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
         sudo nvidia-ctk runtime configure --runtime=docker
         sudo systemctl restart docker
       Guide: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html
       Then re-run this installer."
}

# The image's CUDA userspace needs a host driver new enough to support it.
# nvidia-smi prints the highest CUDA version the driver supports in its header.
_sglang_require_host_cuda() {
  [[ -n "$SGLANG_MIN_HOST_CUDA" ]] || return 0
  local have
  have="$(nvidia-smi 2>/dev/null | sed -nE 's/.*CUDA Version: *([0-9]+\.[0-9]+).*/\1/p' | head -1)"
  if [[ -z "$have" ]]; then
    warn "Could not read the driver's CUDA version from nvidia-smi; the image needs CUDA >= ${SGLANG_MIN_HOST_CUDA}."
    return 0
  fi
  if ! _sglang_version_ge "$have" "$SGLANG_MIN_HOST_CUDA"; then
    err "The NVIDIA driver supports CUDA ${have}; this image needs CUDA >= ${SGLANG_MIN_HOST_CUDA}.
       The container would start and then fail to initialise CUDA.
       Upgrade the driver (e.g.  sudo ubuntu-drivers install), reboot, re-run."
  fi
  ok "Driver supports CUDA ${have} (image needs >= ${SGLANG_MIN_HOST_CUDA})."
}

# Pull by digest, and only when it is not already local. `docker image inspect`
# on a digest reference is exact: a present image IS the pinned image.
_sglang_pull_image() {
  [[ "$SGLANG_IMAGE" == *@sha256:* ]] || err \
    "SGLANG_IMAGE must be pinned by digest (repo@sha256:...), got: ${SGLANG_IMAGE}"
  if docker image inspect "$SGLANG_IMAGE" >/dev/null 2>&1; then
    ok "Image already present: ${SGLANG_IMAGE}"
  else
    info "Pulling ${SGLANG_IMAGE} (${SGLANG_IMAGE_APPROX_SIZE:-several GB})..."
    info "  Interrupted pulls resume layer by layer -- re-run the installer to continue."
    docker pull "$SGLANG_IMAGE" || err "docker pull failed for ${SGLANG_IMAGE}. Re-run to resume."
    ok "Pulled ${SGLANG_IMAGE}"
  fi
  SGLANG_IMAGE_VERSION="$(docker image inspect --format \
    '{{index .Config.Labels "ai.omarchy.engine.version"}}' "$SGLANG_IMAGE" 2>/dev/null || true)"
  if [[ -n "${SGLANG_ATTESTATION_OWNER:-}" ]]; then
    info "Provenance (optional, needs gh):  gh attestation verify oci://${SGLANG_IMAGE} -o ${SGLANG_ATTESTATION_OWNER}"
  fi
}

# Toolkit registered is not the same as toolkit working. Ask the container to
# list the GPU before spending an hour on weights.
_sglang_probe_gpu_in_container() {
  local out
  if ! out="$(docker run --rm --gpus "device=${GPU_DEVICE:-0}" --entrypoint nvidia-smi \
               "$SGLANG_IMAGE" -L 2>&1)"; then
    err "The image could not see the GPU (docker run --gpus device=${GPU_DEVICE:-0} ... nvidia-smi -L):
         $(printf '%s' "$out" | tail -3)
       Check the NVIDIA Container Toolkit setup above, and GPU_DEVICE if you have several GPUs."
  fi
  ok "GPU visible inside the container: $(printf '%s' "$out" | head -1)"
}

backend_install_summary() {
  local size="-"
  [[ -d "${MODEL_ARTIFACT:-}" ]] && size="$(du -sh "$MODEL_ARTIFACT" 2>/dev/null | cut -f1)"
  printf '  %-11s %s @ %s  (%s)\n' "Weights" "$MODEL_REPO" "${MODEL_REVISION:0:8}" "$size"
  printf '  %-11s %s\n' "Verified" "${SGLANG_WEIGHTS_VERIFIED:-not hash-verified (no published hashes in config)}"
  printf '  %-11s %s\n' "MTP head" "inside the checkpoint (NEXTN speculative decoding)"
  printf '  %-11s %s\n' "Image" "$SGLANG_IMAGE"
  printf '  %-11s %s\n' "Cache" "\$HOME/${MODEL_SUBDIR}"
}

sglang_sha() {
  local d="${SGLANG_IMAGE##*@sha256:}"
  printf 'image sha256:%s, sglang %s' "${d:0:12}" "${SGLANG_IMAGE_VERSION:-?}"
}

# "13.0" >= "12.8", without sort -V.
_sglang_version_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    n = split(a, x, "."); m = split(b, y, ".")
    k = (n > m ? n : m)
    for (i = 1; i <= k; i++) { if ((x[i]+0) > (y[i]+0)) exit 0; if ((x[i]+0) < (y[i]+0)) exit 1 }
    exit 0 }'
}

# ---- weights --------------------------------------------------------------
#
# Idempotent, in this order:
#   1. a .verified marker for THIS revision exists and every file it lists is
#      still present at its recorded size -> nothing happens, no network, no
#      re-hashing 14-16 GB
#   2. otherwise `hf download --revision <commit>`, which skips complete files
#      and resumes partial ones, then the index's shards are checked and the
#      published sha256 hashes verified; only then is the marker written
#
# The marker is keyed by the revision, so changing MODEL_REVISION in config.sh
# re-validates rather than trusting weights from a different commit.

backend_fetch_model() {
  info "Ensuring ${MODEL_DISPLAY_NAME} (${MODEL_REPO} @ ${MODEL_REVISION:0:8})..."

  local cache="${SGLANG_MODEL_CACHE:-${HOME}/${SGLANG_MODEL_CACHE_REL}}"
  local dir="${cache}/${MODEL_WEIGHTS_DIR}"
  mkdir -p "$dir"

  if _sglang_weights_state "$dir" | grep -qx valid; then
    ok "Already present and verified at this revision -- not re-downloading."
  else
    ensure_hf
    info "Downloading ${MODEL_REPO} at ${MODEL_REVISION} (${MODEL_APPROX_SIZE:-large})..."
    info "  This resumes if interrupted -- re-run the installer to continue."
    hf download "$MODEL_REPO" --revision "$MODEL_REVISION" --local-dir "$dir" \
      || err "Download failed for ${MODEL_REPO}@${MODEL_REVISION}. Re-run to resume."

    local gap
    if ! gap="$(_sglang_shards_present "$dir")"; then
      err "${MODEL_REPO} downloaded but is incomplete: ${gap}. Re-run to resume."
    fi
    _sglang_verify_hashes "$dir"
    _sglang_write_marker "$dir"
    ok "Downloaded and verified: ${dir##*/}"
  fi

  SGLANG_WEIGHTS_VERIFIED="$(_sglang_marker_summary "$dir")"
  MODEL_ARTIFACT="$dir"
  # The runtime resolves $HOME/<MODEL_SUBDIR>/<MODEL_FILE>; nothing absolute
  # is baked. SGLANG_MODEL_CACHE overrides it at run time as well.
  MODEL_SUBDIR="${cache#"${HOME}/"}"
  MODEL_CACHE_ENV_VAR="SGLANG_MODEL_CACHE"
  MMPROJ=""; MTP_HEAD=""
}

# The weight-cache helpers are shared with every pinned-revision backend and
# live in lib/hf.sh; these names are kept so existing callers and tests read
# the same. hf.sh is sourced here too so this file works when loaded alone.
declare -F hf_pinned_state >/dev/null || . "$(dirname "${BASH_SOURCE[0]}")/hf.sh"
_sglang_marker()         { hf_pinned_marker "$@"; }
_sglang_weights_state()  { hf_pinned_state "$@"; }
_sglang_shards_present() { hf_shards_present "$@"; }
_sglang_verify_hashes()  { hf_verify_sha256 "$@"; }
_sglang_write_marker()   { hf_write_marker "$@"; }
_sglang_marker_summary() { hf_marker_summary "$@"; }

# ---- serving --------------------------------------------------------------

backend_profile_table() {
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-9s %7s ctx  mem %-4s  prefill-graphs %-3s  %-14s %s\n", $1, $2, $3, ($4=="1"?"on":"off"), $6, $7
  }' "$1"
}

# SGLang advertises the context it is actually serving as max_model_len.
backend_smoke_context() {
  curl -s --max-time 10 "http://127.0.0.1:${1}/v1/models" \
    | python3 -c 'import sys,json;print((json.load(sys.stdin).get("data") or [{}])[0].get("max_model_len","?"))' 2>/dev/null
}

# Proof that NEXTN/MTP drafting is live, from SGLang's own per-request
# accounting: the native /generate endpoint reports spec_verify_ct (verify
# passes) and spec_accept_length (completion tokens per verify pass, bonus
# token included) whenever a speculative algorithm is running. Without
# drafting there is one token per forward pass and neither field exists, so
# an accept length above 1 is direct evidence, not an inference from speed.
# (Field names read from SGLang's tokenizer_manager.py at the commit the image
# is labelled with; not yet observed on hardware by this repo.)
backend_smoke_assert() {
  local port="$2" resp
  resp="$(curl -sf --max-time 120 "http://127.0.0.1:${port}/generate" \
    -H 'Content-Type: application/json' \
    -d '{"text":"Count from 1 to 40, separated by commas:","sampling_params":{"max_new_tokens":96,"temperature":0}}' \
    2>/dev/null)" || { warn "POST /generate failed; unable to confirm speculative decoding."; return 0; }

  local verdict
  verdict="$(printf '%s' "$resp" | python3 -c '
import sys, json
m = (json.load(sys.stdin).get("meta_info") or {})
ct, al, ar = m.get("spec_verify_ct"), m.get("spec_accept_length"), m.get("spec_accept_rate")
if ct and al:
    print("ok %.2f %s %s" % (al, ct, ("%.2f" % ar) if ar is not None else "?"))
else:
    print("none")
' 2>/dev/null || echo none)"

  case "$verdict" in
    ok\ *)
      local _ al ct ar
      read -r _ al ct ar <<< "$verdict"
      if awk -v a="$al" 'BEGIN{exit !(a > 1.0)}'; then
        SMOKE_ACC="NEXTN/MTP, ${al} tokens per verify pass over ${ct} passes, draft accept rate ${ar}"
        ok "Speculative decoding live: accept length ${al} (${ct} verify passes, accept rate ${ar})."
      else
        warn "Speculative decoding ran but accepted nothing (accept length ${al}); expect well below the recipe's speed."
      fi
      ;;
    *)
      warn "SGLang reported no speculative-decoding counters (spec_verify_ct) for a /generate request."
      warn "  Either drafting is off or this SGLang build names them differently -- check ${INSTALL_ROOT}/smoke.log"
      warn "  for 'accept len' in the decode-batch lines."
      ;;
  esac

  # The launcher's own RSS is a docker CLI's; the real footprint is on the GPU.
  if need_cmd nvidia-smi; then
    local used
    used="$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits -i "${GPU_DEVICE:-0}" 2>/dev/null | head -1)"
    [[ -n "$used" ]] && info "GPU ${GPU_DEVICE:-0} memory in use with the server up: ${used} MiB (whole device)."
  fi
}

#!/usr/bin/env bash
# lib/gufo.sh -- gufo backend adapter: gufo's own engine, served from its
# runtime container image with Podman, on AMD's ROCm inside the image.
#
# Backend contract (docs/adding-a-combination.md):
#   ensure_backend          Podman + the AMD device nodes + the image, by digest
#   backend_fetch_model     the GGUF shards and the MTP head, at a pinned revision
#   backend_profile_table   render profiles.tsv
#   backend_smoke_context   report the served context window
#   backend_smoke_assert    prove the MTP head is actually drafting
#   gufo_sha                version string for the summary
#
# Modelled on lib/sglang.sh (the other container backend), with three
# differences:
#
#   1. Podman, not Docker, and no NVIDIA toolkit: the GPU reaches the container
#      as /dev/kfd and /dev/dri, with the caller's render/video groups kept
#      (--group-add keep-groups). The image carries its own ROCm, so the host
#      needs none (the combination sets GPU_API=none for lib/accel/strix-halo.sh).
#   2. The engine's version is the thing that matters (a fix to Qwen tool-call
#      arguments landed in gufo#284, merge b722a61). The image is pulled BY
#      DIGEST and its binary must report GUFO_VERSION, so a mis-pinned image
#      is refused rather than benchmarked.
#   3. The weights are single GGUF files, not a safetensors index: the
#      combination lists each file with its exact size (GUFO_MODEL_FILES), and a
#      directory holding all of them at those sizes is used as it is. That is
#      what makes a 111 GB directory that was downloaded before this adapter
#      existed count as installed instead of being fetched again.
#
# Everything model-specific is DATA in the combination's config.sh: the image
# digest and version, the repo and revision, the files and sizes, the argv.

BACKEND_NEEDS_BUILD_TOOLS=0
# The hf CLI is only needed when a file is missing, and then this adapter
# ensures it itself (it fills a cache outside the install root).
BACKEND_NEEDS_HF=0

BACKEND_REQUIRED_VARS="GUFO_IMAGE GUFO_VERSION MODEL_REPO MODEL_REVISION MODEL_WEIGHTS_DIR GUFO_MODEL_FILES GUFO_MODEL_REL GUFO_MTP_REL GUFO_CONTAINER_MODEL_DIR GUFO_CONTAINER_PORT"

# profiles.tsv columns for this backend.
#   ctx            --context (tokens per session)
#   sessions       --sessions (preallocated GPU request sessions)
#   draft_tokens   --draft-tokens (MTP draft tokens per step; gufo's default is 7)
#   prefill_chunk  --prefill-chunk (prompt tokens between decode rounds)
#   need_mib       GPU memory (GTT) the profile was measured at (see the file's header)
#   basis          where the row came from: MEASURED-<date> or EXTRAPOLATED
PROFILE_SCHEMA="name|ctx|sessions|draft_tokens|prefill_chunk|need_mib|basis|summary"

# No KV-type switch in gufo's CLI.
SAFE_KV_TYPES="${SAFE_KV_TYPES:-n/a}"

# Where the weights go, relative to $HOME so no absolute path is baked into the
# manifest: gufo's own documented location, which is also where a manual setup
# already put them. GUFO_MODEL_CACHE overrides it at install and run time.
GUFO_MODEL_CACHE_REL="${GUFO_MODEL_CACHE_REL:-gufo/models}"

# A cold load of ~111 GB reads the whole file; 900 s covers a cold page cache.
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-900}"

# The generic smoke request ("Reply with exactly: OK", 256 tokens) must name the
# model -- gufo answers a request without one with 400 missing_model -- and
# turns thinking off, so a reasoning default cannot spend every token thinking.
if [[ -z "${SMOKE_REQUEST_EXTRA:-}" ]]; then
  SMOKE_REQUEST_EXTRA='"model":"'"${MODEL_ALIAS_DEFAULT:-}"'","chat_template_kwargs":{"enable_thinking":false}'
fi

GUFO_IMAGE_VERSION=""

# Everything the launcher needs that the generic manifest does not carry.
# %q keeps multi-word values intact when install.env is sourced.
backend_manifest_extra() {
  local v
  echo
  echo "# gufo backend (lib/gufo.sh)"
  for v in GUFO_IMAGE GUFO_VERSION GUFO_MODEL_REL GUFO_MTP_REL GUFO_CONTAINER_MODEL_DIR \
           GUFO_CONTAINER_PORT GUFO_BASE_ARGS GUFO_SAMPLING_INSTRUCT; do
    printf '%s=%q\n' "$v" "${!v:-}"
  done
}

# ---- install --------------------------------------------------------------

ensure_backend() {
  info "Ensuring Podman, the GPU device nodes and the gufo image..."
  _gufo_require_podman
  _gufo_require_devices
  _gufo_pull_image
  _gufo_require_version
}

_gufo_require_podman() {
  need_cmd podman || err "Podman is not installed.
       This combination runs gufo from its runtime image. Ubuntu:
         sudo apt install podman
       then re-run this installer."
  local out
  if ! out="$(podman info --format '{{.Version.Version}}' 2>&1)"; then
    err "Podman is installed but not working for this user:
         ${out}"
  fi
  ok "Podman ${out}"
}

# The container sees the GPU through /dev/kfd (ROCm's compute interface) and
# the render node, with this user's groups. No access here means none in the
# container either -- and gufo would then fail after a minutes-long load.
_gufo_require_devices() {
  local d
  for d in /dev/kfd /dev/dri; do
    [[ -e "$d" ]] || err "${d} does not exist: the amdgpu driver is not loaded (or this is not an AMD GPU host)."
  done
  if [[ ! -r /dev/kfd || ! -w /dev/kfd ]]; then
    err "This user cannot open /dev/kfd, so the container cannot reach the GPU.
       Add yourself to the render and video groups, then log out and back in:
         sudo usermod -aG render,video \$USER"
  fi
  ok "GPU device nodes accessible: /dev/kfd, /dev/dri"
}

# Pull by digest, and only when it is not already local.
_gufo_pull_image() {
  [[ "$GUFO_IMAGE" == *@sha256:* ]] || err \
    "GUFO_IMAGE must be pinned by digest (repo@sha256:...), got: ${GUFO_IMAGE}"
  if podman image exists "$GUFO_IMAGE" 2>/dev/null; then
    ok "Image already present: ${GUFO_IMAGE}"
  else
    info "Pulling ${GUFO_IMAGE} (${GUFO_IMAGE_APPROX_SIZE:-several GB})..."
    podman pull "$GUFO_IMAGE" || err "podman pull failed for ${GUFO_IMAGE}. Re-run to resume."
    ok "Pulled ${GUFO_IMAGE}"
  fi
}

# The image is pinned by digest; its binary must also be the engine version the
# combination was set up for. A digest pinned to the wrong image would pass the
# pull and serve a gufo without the fix the combination depends on.
_gufo_require_version() {
  local out
  out="$(podman run --rm --entrypoint gufo "$GUFO_IMAGE" --version 2>&1 | head -1)" \
    || err "The gufo image would not run (podman run ... gufo --version): ${out}"
  GUFO_IMAGE_VERSION="${out##* }"
  [[ "$GUFO_IMAGE_VERSION" == "$GUFO_VERSION" ]] || err \
    "The pinned image reports '${out}', not gufo ${GUFO_VERSION}.
       GUFO_IMAGE and GUFO_VERSION in config.sh must name the same build."
  ok "gufo ${GUFO_IMAGE_VERSION} in the image"
}

backend_install_summary() {
  printf '  %-11s %s @ %s\n' "Weights" "$MODEL_REPO" "${MODEL_REVISION:0:8}"
  printf '  %-11s %s\n' "Files" "$(printf '%s\n' "$GUFO_MODEL_FILES" | awk -F'|' 'NF>=2 {n++} END {print n+0}') at their published sizes"
  printf '  %-11s %s\n' "MTP head" "$GUFO_MTP_REL"
  printf '  %-11s %s\n' "Image" "$GUFO_IMAGE"
  printf '  %-11s %s\n' "Cache" "\$HOME/${MODEL_SUBDIR}"
}

gufo_sha() {
  local d="${GUFO_IMAGE##*@sha256:}"
  printf 'image sha256:%s, gufo %s' "${d:0:12}" "${GUFO_IMAGE_VERSION:-$GUFO_VERSION}"
}

# ---- weights --------------------------------------------------------------
#
# GUFO_MODEL_FILES is one "path|bytes" line per file, path relative to the
# weights directory. "valid": every file present at exactly that size. Anything
# else: the missing or short files are fetched with `hf download --revision`,
# which resumes partial files, and the sizes are checked again.

_gufo_weights_state() { # dir -> valid | missing <first problem>
  local dir="$1" path bytes have
  while IFS='|' read -r path bytes; do
    [[ -z "${path// }" || "$path" == \#* ]] && continue
    have="$(wc -c < "$dir/$path" 2>/dev/null | tr -d ' ')" || have=""
    if [[ "$have" != "$bytes" ]]; then
      printf 'missing %s (%s of %s bytes)\n' "$path" "${have:-no file,}" "$bytes"
      return 0
    fi
  done <<< "$GUFO_MODEL_FILES"
  echo valid
}

backend_fetch_model() {
  info "Ensuring ${MODEL_DISPLAY_NAME} (${MODEL_REPO} @ ${MODEL_REVISION:0:8})..."
  local cache="${GUFO_MODEL_CACHE:-${HOME}/${GUFO_MODEL_CACHE_REL}}"
  local dir="${cache}/${MODEL_WEIGHTS_DIR}" state
  mkdir -p "$dir"

  state="$(_gufo_weights_state "$dir")"
  if [[ "$state" == valid ]]; then
    ok "All files present at their published sizes -- not re-downloading."
  else
    info "Weights incomplete: ${state#missing }"
    ensure_hf
    local includes=() path bytes
    while IFS='|' read -r path bytes; do
      [[ -z "${path// }" || "$path" == \#* ]] && continue
      includes+=(--include "$path")
    done <<< "$GUFO_MODEL_FILES"
    info "Downloading from ${MODEL_REPO} at ${MODEL_REVISION} (${MODEL_APPROX_SIZE:-large})..."
    info "  This resumes if interrupted -- re-run the installer to continue."
    hf download "$MODEL_REPO" --revision "$MODEL_REVISION" "${includes[@]}" --local-dir "$dir" \
      || err "Download failed for ${MODEL_REPO}@${MODEL_REVISION}. Re-run to resume."
    state="$(_gufo_weights_state "$dir")"
    [[ "$state" == valid ]] || err "Downloaded, but still incomplete: ${state#missing }. Re-run to resume."
    ok "Downloaded: every file at its published size."
  fi

  MODEL_ARTIFACT="$dir"
  # The runtime resolves $HOME/<MODEL_SUBDIR>/<MODEL_FILE> (the weights
  # directory); nothing absolute is baked. GUFO_MODEL_CACHE overrides it.
  MODEL_SUBDIR="${cache#"${HOME}/"}"
  MODEL_CACHE_ENV_VAR="GUFO_MODEL_CACHE"
  MMPROJ=""; MTP_HEAD=""
}

# ---- serving --------------------------------------------------------------

backend_profile_table() {
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-9s %7s ctx  sessions %-2s  draft %-2s  prefill-chunk %-5s  %-19s %s\n", $1, $2, $3, $4, $5, $7, $8
  }' "$1"
}

# The context gufo serves per session. Its API doesn't state it (b722a61: /v1/models lists only the
# model name, /props?model= returns an empty model_info), but its load line does:
#   [loader] event=load_completed ... sessions=1 context_tokens=131072 ...
# so read that from the launcher's container (named "<install id>-<port>"). '?' if neither says.
backend_smoke_context() {
  local port="$1" n
  n="$(curl -s --max-time 10 "http://127.0.0.1:${port}/v1/models" \
    | python3 -c 'import sys,json
m=(json.load(sys.stdin).get("data") or [{}])[0]
print(m.get("context_length") or m.get("max_model_len") or m.get("n_ctx") or "")' 2>/dev/null)"
  [[ -n "$n" ]] || n="$(podman logs "${INSTALL_ID}-${port}" 2>&1 \
    | sed -n 's/.*event=load_completed.* context_tokens=\([0-9][0-9]*\).*/\1/p' | tail -1)"
  echo "${n:-?}"
}

# "<accepted> <drafted>" from a chat completion's usage, or nothing. gufo
# reports usage.draft_tokens and usage.draft_tokens_accepted (seen on tritus,
# 27 Sep 2026, gufo b722a61); without drafting neither is there.
_gufo_draft_counts() {
  python3 -c '
import sys, json
u = (json.load(sys.stdin).get("usage") or {})
if u.get("draft_tokens"):
    print(u.get("draft_tokens_accepted", 0), u["draft_tokens"])
' 2>/dev/null
}

# Proof that the MTP head is drafting, from gufo's own per-request accounting,
# not an inference from speed.
backend_smoke_assert() {
  local port="$2" resp counts
  resp="$(curl -sf --max-time 180 "http://127.0.0.1:${port}/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"${MODEL_ALIAS_DEFAULT}\",\"messages\":[{\"role\":\"user\",\"content\":\"Count from 1 to 40, separated by commas.\"}],\"max_tokens\":128,\"temperature\":0,\"chat_template_kwargs\":{\"enable_thinking\":false}}" \
    2>/dev/null)" || { warn "The MTP check request failed; unable to confirm speculative decoding."; return 0; }
  counts="$(_gufo_draft_counts <<< "$resp")"
  if [[ -n "$counts" ]]; then
    local a d; read -r a d <<< "$counts"
    SMOKE_ACC="MTP, ${a} of ${d} drafted tokens accepted"
    ok "MTP drafting live: ${a} of ${d} drafted tokens accepted."
  else
    warn "gufo reported no draft counters (usage.draft_tokens) for the MTP check request; speculative"
    warn "  decoding is configured (--speculative mtp) but not proven here. Check ${INSTALL_ROOT}/smoke.log."
  fi
}

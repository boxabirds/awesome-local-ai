#!/usr/bin/env bash
# lib/mtplx.sh -- MTPLX backend adapter (Mac-only, native MTP on Apple silicon).
#
# Backend contract (docs/adding-a-combination.md):
#   ensure_backend          install/verify the serving binary
#   backend_fetch_model     obtain the weights (this backend owns its cache)
#   backend_profile_table   render profiles.tsv
#   backend_smoke_context   report the served context window
#   backend_smoke_assert    prove speculative decoding is actually live
#   mtplx_sha               version string for the summary
#
# MTPLX differs from llama.cpp in two ways that matter to the installer:
#
#   1. It ships prebuilt and installs from PyPI via `uv tool`, so there is
#      nothing to compile -- no build tools, no cmake flags, no accelerator
#      probe of a binary we produced.
#   2. It owns a model cache (~/.mtplx/models) holding whole model repos, not
#      single files. Weights are sharded safetensors plus an MTP sidecar and,
#      for Flash-Next, a 30 GB n-gram table. Its own CLI already knows how to
#      validate, resume and delta-update that cache, so this adapter asks
#      MTPLX rather than reimplementing the checks.

BACKEND_NEEDS_BUILD_TOOLS=0
BACKEND_NEEDS_HF=0
# MODEL_SUBDIR is not declared by the combination: it is discovered from the
# MTPLX cache at fetch time and written into the manifest then.
BACKEND_REQUIRED_VARS="MODEL_REPO"

# The column layout of this backend's profiles.tsv. Recorded in the manifest so
# a reader can tell the shapes apart without guessing from the header comment.
PROFILE_SCHEMA="name|ctx|mtp_depth|effort|max_tokens|need_mib|summary"

# No KV-type switch to guard: MTPLX quantises its own KV cache per profile.
SAFE_KV_TYPES="${SAFE_KV_TYPES:-n/a}"

# Combinations may pin a floor; `mtplx models --json` is what this adapter
# relies on for its idempotency checks and has to exist.
MIN_MTPLX_VERSION="${MIN_MTPLX_VERSION:-2.10.0}"

MTPLX_BIN=""
MTPLX_CACHE_DIR=""

# ---- install --------------------------------------------------------------

ensure_backend() { ensure_mtplx; }

ensure_mtplx() {
  info "Ensuring MTPLX..."

  # Respect an existing install wherever it is; only fall back to installing.
  MTPLX_BIN="$(command -v mtplx || true)"
  [[ -z "$MTPLX_BIN" && -x "${HOME}/.local/bin/mtplx" ]] && MTPLX_BIN="${HOME}/.local/bin/mtplx"

  if [[ -z "$MTPLX_BIN" ]]; then
    need_cmd uv || err \
      "MTPLX installs via uv, which is not on PATH.
       Install it with:  curl -LsSf https://astral.sh/uv/install.sh | sh
       then re-run this installer."
    info "Installing MTPLX (uv tool install mtplx)..."
    uv tool install mtplx || err "uv tool install mtplx failed."
    hash -r
    MTPLX_BIN="$(command -v mtplx || echo "${HOME}/.local/bin/mtplx")"
  fi

  [[ -x "$MTPLX_BIN" ]] || err "mtplx is not executable at ${MTPLX_BIN}."

  local ver
  ver="$("$MTPLX_BIN" --version 2>/dev/null | tr -d '\r' | awk '{print $NF}')"
  [[ -n "$ver" ]] || err "Could not read a version from '${MTPLX_BIN} --version'."

  if ! _version_ge "$ver" "$MIN_MTPLX_VERSION"; then
    # Upgrading is safe and idempotent, so try before giving up.
    warn "MTPLX ${ver} is older than the required ${MIN_MTPLX_VERSION}; upgrading..."
    if need_cmd uv; then uv tool upgrade mtplx || true; hash -r; fi
    ver="$("$MTPLX_BIN" --version 2>/dev/null | awk '{print $NF}')"
    _version_ge "$ver" "$MIN_MTPLX_VERSION" || err \
      "MTPLX ${ver} is too old; this combination needs >=${MIN_MTPLX_VERSION}.
       Upgrade with:  uv tool upgrade mtplx"
  fi
  ok "MTPLX ${ver} at ${MTPLX_BIN}"

  # MTPLX refuses to run on hardware it cannot accelerate; ask it before we
  # spend an hour downloading weights.
  if ! "$MTPLX_BIN" hardware >/dev/null 2>&1; then
    err "'mtplx hardware' reports this machine is not eligible for MLX acceleration.
       Run it directly to see why."
  fi
  ok "MLX acceleration eligible."

  MTPLX_CACHE_DIR="$(_mtplx_cache_dir)"
  ok "Model cache: ${MTPLX_CACHE_DIR}"
}

# The MTP head ships inside the model pack rather than as a separate asset, so
# the generic "MTP head: not installed" line would be actively wrong here.
BACKEND_MTP_INTERNAL=1

backend_install_summary() {
  local size="-"
  [[ -d "${MODEL_ARTIFACT:-}" ]] && size="$(du -sh "$MODEL_ARTIFACT" 2>/dev/null | cut -f1)"
  printf '  %-11s %s  (%s)\n' "Model pack" "$(basename "${MODEL_ARTIFACT:-?}")" "$size"
  printf '  %-11s %s\n' "MTP head" "inside the pack, verified by 'mtplx inspect --require-mtp'"
  printf '  %-11s %s\n' "Vision" "not available in this pack -- text only"
  printf '  %-11s %s\n' "Cache" "\$HOME/${MODEL_SUBDIR:-.mtplx/models}"
}

mtplx_sha() { "${MTPLX_BIN:-mtplx}" --version 2>/dev/null | awk '{print $NF}' || echo "?"; }

# ---- weights --------------------------------------------------------------
#
# Idempotent by construction, in this order:
#   1. already cached and valid   -> nothing happens, no network
#   2. cached but incomplete      -> `mtplx models --update`, a delta download
#                                    that resumes rather than restarting
#   3. absent                     -> `mtplx pull`, itself resumable
# Re-running the installer is the supported way to regenerate the runtime after
# a config change; it must never re-fetch 107 GB to do that.

backend_fetch_model() {
  info "Ensuring ${MODEL_DISPLAY_NAME} in the MTPLX cache..."
  : "${MODEL_REPO:?combination must set MODEL_REPO (the Hugging Face repo id)}"

  MTPLX_CACHE_DIR="${MTPLX_CACHE_DIR:-$(_mtplx_cache_dir)}"

  local state
  state="$(_mtplx_model_state "$MODEL_REPO")"

  case "$state" in
    valid)
      local path size
      path="$(_mtplx_model_field "$MODEL_REPO" path)"
      size="$(_mtplx_model_field "$MODEL_REPO" size_gb)"
      ok "Already cached and valid: ${path} (${size} GB) -- not re-downloading."
      ;;
    incomplete)
      warn "Cached but incomplete: $(_mtplx_model_field "$MODEL_REPO" missing)"
      local shard_gap
      shard_gap="$(_mtplx_shards_present "$(_mtplx_model_field "$MODEL_REPO" path)" || true)"
      if [[ -n "$shard_gap" ]]; then warn "  ${shard_gap}"; fi
      info "Resuming with a delta update (no full re-download)..."
      "$MTPLX_BIN" models --update "$MODEL_REPO" --cache-dir "$MTPLX_CACHE_DIR" \
        || err "Delta update failed for ${MODEL_REPO}. Re-run to resume."
      [[ "$(_mtplx_model_state "$MODEL_REPO")" == "valid" ]] || err \
        "${MODEL_REPO} is still incomplete after an update.
       Inspect with:  mtplx models --json
       Or remove and re-fetch:  mtplx remove ${MODEL_REPO}"
      ok "Completed: ${MODEL_REPO}"
      ;;
    absent)
      info "Not cached. Downloading ${MODEL_REPO} (${MODEL_APPROX_SIZE:-large})..."
      info "  This resumes if interrupted -- re-run the installer to continue."
      "$MTPLX_BIN" pull "$MODEL_REPO" --cache-dir "$MTPLX_CACHE_DIR" \
        || err "Download failed for ${MODEL_REPO}. Re-run this installer to resume."
      [[ "$(_mtplx_model_state "$MODEL_REPO")" == "valid" ]] || err \
        "${MODEL_REPO} downloaded but did not validate. Re-run to resume."
      ok "Downloaded: ${MODEL_REPO}"
      ;;
  esac

  MODEL_ARTIFACT="$(_mtplx_model_field "$MODEL_REPO" path)"
  [[ -d "$MODEL_ARTIFACT" ]] || err "MTPLX reports no directory for ${MODEL_REPO}."

  # The runtime resolves the cache from $HOME plus this relative subdir, so no
  # absolute path is baked into the install.
  MODEL_SUBDIR="$(_relative_to_home "$(dirname "$MODEL_ARTIFACT")")"
  MODEL_CACHE_ENV_VAR="MTPLX_CACHE_DIR"

  # MTP is the entire point of this backend; a model without a usable head
  # would serve at a third of the speed the profiles promise.
  if ! "$MTPLX_BIN" inspect "$MODEL_ARTIFACT" --require-mtp >/dev/null 2>&1; then
    err "${MODEL_REPO} did not pass 'mtplx inspect --require-mtp'.
       This combination's numbers all assume native MTP speculative decoding.
       Inspect it with:  mtplx inspect ${MODEL_ARTIFACT} --require-mtp"
  fi
  ok "MTP contract verified: $(basename "$MODEL_ARTIFACT")"

  # Sidecars are inside the model directory for this backend, not separate
  # assets, so the manifest carries no mmproj/mtp filenames.
  MMPROJ=""; MTP_HEAD=""
}

_mtplx_cache_dir() {
  "${MTPLX_BIN:-mtplx}" models --json 2>/dev/null \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("cache_dir",""))' 2>/dev/null \
    || printf '%s' "${HOME}/.mtplx/models"
}

# valid | incomplete | absent.
#
# Two checks, because neither alone is sufficient. MTPLX's own validation knows
# about the runtime contract and the MTP sidecar, but it does NOT verify that
# the weight shards named in model.safetensors.index.json are actually present
# -- a pack holding only the index and the tokenizer is reported as missing
# nothing but the sidecar. An interrupted download is precisely the case that
# leaves an index without its shards, so walk the weight map as well.
_mtplx_model_state() {
  local repo="$1" verdict path
  verdict="$("${MTPLX_BIN}" models --json --cache-dir "$MTPLX_CACHE_DIR" 2>/dev/null | python3 -c '
import sys, json
want = sys.argv[1]
try:
    models = json.load(sys.stdin).get("models", [])
except Exception:
    print("absent"); raise SystemExit(0)
for m in models:
    if m.get("repo_id") == want:
        v = m.get("validation") or {}
        print("valid" if v.get("ok") else "incomplete")
        break
else:
    print("absent")
' "$repo" 2>/dev/null)" || verdict=absent

  [[ "$verdict" == "valid" ]] || { printf '%s' "${verdict:-absent}"; return; }

  path="$(_mtplx_model_field "$repo" path)"
  if [[ -n "$path" ]] && ! _mtplx_shards_present "$path" >/dev/null; then
    printf 'incomplete'; return
  fi
  printf 'valid'
}

# Every shard named in the index must exist and be non-empty. Prints a summary
# of what is missing and returns non-zero when any are.
_mtplx_shards_present() {
  python3 - "$1" <<'SHARDCHECK'
import json, pathlib, sys
d = pathlib.Path(sys.argv[1])
idx = d / "model.safetensors.index.json"
if not idx.exists():
    sys.exit(0)          # single-file packs are legitimate; nothing to cross-check
try:
    want = set(json.loads(idx.read_text())["weight_map"].values())
except Exception as e:
    print(f"unreadable index ({e})")
    sys.exit(1)
missing = [f for f in sorted(want) if not (d / f).exists() or (d / f).stat().st_size == 0]
if missing:
    shown = ", ".join(missing[:4])
    more = f" (+{len(missing) - 4} more)" if len(missing) > 4 else ""
    print(f"{len(missing)}/{len(want)} shards missing: {shown}{more}")
    sys.exit(1)
sys.exit(0)
SHARDCHECK
}

_mtplx_model_field() {
  "${MTPLX_BIN}" models --json --cache-dir "$MTPLX_CACHE_DIR" 2>/dev/null | python3 -c '
import sys, json
want, field = sys.argv[1], sys.argv[2]
for m in json.load(sys.stdin).get("models", []):
    if m.get("repo_id") == want:
        if field == "missing":
            print(", ".join((m.get("validation") or {}).get("missing_files") or ["unknown"]))
        else:
            print(m.get(field, ""))
        break
' "$1" "$2" 2>/dev/null
}

_relative_to_home() { printf '%s' "${1#"${HOME}/"}"; }

# "2.10.1" >= "2.10.0", without assuming sort -V exists.
_version_ge() {
  [[ "$1" == "$2" ]] && return 0
  printf '%s\n%s\n' "$2" "$1" | awk -F. '
    NR==1 { for (i=1;i<=NF;i++) a[i]=$i+0; n=NF }
    NR==2 { for (i=1;i<=NF;i++) b[i]=$i+0; m=NF }
    END {
      k = (n>m?n:m)
      for (i=1;i<=k;i++) { if (b[i]>a[i]) exit 0; if (b[i]<a[i]) exit 1 }
      exit 0
    }'
}

# ---- serving --------------------------------------------------------------

# profiles.tsv for this backend is
#   name|ctx|mtp_depth|effort|max_tokens|need_mib|summary
# There is no KV type and no vision flag to show: MTPLX quantises its own KV
# cache per profile, and neither of these model packs ships a projector.
backend_profile_table() {
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-11s %7s ctx  depth %-2s  effort %-7s  max %-6s  %s\n", $1, $2, $3, $4, $5, $7
  }' "$1"
}

backend_smoke_context() {
  curl -s "http://127.0.0.1:${1}/health" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("context_window","?"))' 2>/dev/null
}

# MTPLX serves happily with MTP disabled -- it falls back to autoregressive
# decoding and simply runs at a third of the speed, with nothing in the log to
# say so. /health reports what it actually resolved, so ask it.
backend_smoke_assert() {
  local port="$2" health
  health="$(curl -sf --max-time 10 "http://127.0.0.1:${port}/health" 2>/dev/null)" || {
    warn "Could not read /health; unable to confirm speculative decoding."; return 0; }

  local enabled depth
  enabled="$(printf '%s' "$health" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("mtp_enabled"))' 2>/dev/null)"
  depth="$(printf '%s' "$health" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("depth"))' 2>/dev/null)"

  if [[ "$enabled" == "True" || "$enabled" == "true" ]]; then
    SMOKE_ACC="native MTP, depth ${depth}"
    ok "Native MTP speculative decoding active (depth ${depth})."
  else
    warn "MTP is NOT active (mtp_enabled=${enabled:-unknown})."
    warn "  Every throughput figure for this combination assumes it is; expect ~1/3 the speed."
  fi
}

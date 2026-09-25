#!/usr/bin/env bash
# lib/hf.sh -- Hugging Face CLI, shared by every combination that pulls
# weights from the Hub.

# hf is installed as a uv tool (ensure_uv, lib/common.sh): its own venv, no
# sudo, nothing written into the system python.

# The python that runs hf: hf_transfer has to be importable there, which for a
# uv tool is its own venv, not the system python3.
_hf_python() { sed -n '1s/^#!//p' "$(command -v hf)" 2>/dev/null; }

ensure_hf() {
  info "Ensuring huggingface_hub (hf CLI) + hf_transfer..."
  export PATH="${HOME}/.local/bin:${PATH}"
  if need_cmd hf; then
    ok "hf CLI present: $(hf version 2>/dev/null | head -1)"
  else
    ensure_uv
    uv tool install huggingface_hub --with hf_transfer >/dev/null 2>&1 || true
    hash -r
    need_cmd hf || err "hf CLI install failed (uv tool install huggingface_hub)."
  fi
  # hf_transfer gives a large speedup on multi-GB pulls, but only if it is
  # actually switched on -- installing it alone does nothing.
  local py; py="$(_hf_python)"
  if [[ -n "$py" ]] && "$py" -c 'import hf_transfer' 2>/dev/null; then
    export HF_HUB_ENABLE_HF_TRANSFER=1
    ok "hf_transfer enabled."
  else
    warn "hf_transfer unavailable; downloads will use the slower default backend."
  fi
}

# ---- weights pinned to a revision ------------------------------------------
#
# Shared by every backend that fetches a whole Hugging Face repo at a pinned
# commit into its own cache (sglang, mlxserve). Idempotent, in this order:
#
#   1. a .verified marker for THIS revision exists and every file it lists is
#      still present at its recorded size -> nothing happens, no network, no
#      re-hashing tens of GB
#   2. otherwise `hf download --revision <commit>` (skips complete files,
#      resumes partial ones), then the index's shards are checked and the
#      published sha256 hashes verified; only then is the marker written
#
# The marker is keyed by the revision, so changing MODEL_REVISION in a config
# re-validates rather than trusting weights from a different commit. Reads
# MODEL_REPO, MODEL_REVISION and MODEL_SHA256 from the combination.

hf_pinned_marker() { printf '%s/.awesome-local-ai-verified' "$1"; }

# valid | stale | absent
hf_pinned_state() {
  local dir="$1" m
  m="$(hf_pinned_marker "$dir")"
  [[ -f "$m" ]] || { echo absent; return; }
  python3 - "$dir" "$m" "$MODEL_REVISION" <<'PY'
import json, os, sys
d, m, rev = sys.argv[1:4]
try:
    doc = json.load(open(m))
except Exception:
    print("stale"); sys.exit(0)
if doc.get("revision") != rev:
    print("stale"); sys.exit(0)
for name, size in (doc.get("sizes") or {}).items():
    p = os.path.join(d, name)
    if not os.path.isfile(p) or os.path.getsize(p) != size:
        print("stale"); sys.exit(0)
print("valid" if doc.get("sizes") else "stale")
PY
}

# Every shard named in the index exists and is non-empty.
hf_shards_present() {
  python3 - "$1" <<'PY'
import json, pathlib, sys
d = pathlib.Path(sys.argv[1])
idx = d / "model.safetensors.index.json"
if not idx.exists():
    print("no model.safetensors.index.json"); sys.exit(1)
try:
    want = set(json.loads(idx.read_text())["weight_map"].values())
except Exception as e:
    print(f"unreadable index ({e})"); sys.exit(1)
missing = [f for f in sorted(want) if not (d / f).exists() or (d / f).stat().st_size == 0]
if missing:
    print(f"{len(missing)}/{len(want)} shards missing: {', '.join(missing[:4])}"); sys.exit(1)
PY
}

# MODEL_SHA256 is one "<sha256>  <file>" line per file, as sha256sum prints.
# A mismatch deletes nothing -- it refuses, and says how to re-fetch.
hf_verify_sha256() {
  local dir="$1"
  if [[ -z "${MODEL_SHA256// }" ]]; then
    warn "No published hashes in this combination's config; weights not hash-verified."
    return 0
  fi
  info "Verifying sha256 of the weight files (reads every byte once)..."
  local sum want file have
  sum="$(command -v sha256sum || true)"
  while read -r want file; do
    [[ -n "$want" ]] || continue
    [[ -f "${dir}/${file}" ]] || err "Expected ${file} in ${dir}, not found."
    if [[ -n "$sum" ]]; then have="$(sha256sum "${dir}/${file}" | cut -d' ' -f1)"
    else have="$(shasum -a 256 "${dir}/${file}" | cut -d' ' -f1)"; fi
    [[ "$have" == "$want" ]] || err "sha256 mismatch for ${file}:
         expected ${want}
         got      ${have}
       Delete it and re-run to re-fetch:  rm '${dir}/${file}'"
    ok "sha256 OK: ${file}"
  done <<< "$MODEL_SHA256"
}

hf_write_marker() {
  local dir="$1"
  python3 - "$dir" "$(hf_pinned_marker "$dir")" "$MODEL_REPO" "$MODEL_REVISION" \
            "$([[ -n "${MODEL_SHA256// }" ]] && echo 1 || echo 0)" <<'PY'
import json, os, sys, time
d, m, repo, rev, hashed = sys.argv[1:6]
sizes = {}
for root, dirs, files in os.walk(d):
    dirs[:] = [x for x in dirs if not x.startswith(".")]
    for f in files:
        if f.startswith("."):
            continue
        p = os.path.join(root, f)
        sizes[os.path.relpath(p, d)] = os.path.getsize(p)
json.dump({"repo": repo, "revision": rev, "sha256_verified": hashed == "1",
           "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "sizes": sizes}, open(m, "w"), indent=1)
PY
}

hf_marker_summary() {
  python3 - "$(hf_pinned_marker "$1")" <<'PY' 2>/dev/null || echo "?"
import json, sys
d = json.load(open(sys.argv[1]))
print(("sha256 verified" if d.get("sha256_verified") else "present, not hash-verified")
      + f" at {d.get('revision','?')[:8]} ({d.get('checked_at','?')})")
PY
}

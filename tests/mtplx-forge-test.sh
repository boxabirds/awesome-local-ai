#!/usr/bin/env bash
# MTPLX backend: fetching a combination's model, without MTPLX, a model or the network.
# A combination whose model has no published MTPLX pack names the source repository and a Forge recipe
# (FORGE_SOURCE_REPO, FORGE_RECIPE); when the model is absent, the installer builds it with `mtplx forge build`
# under the name MODEL_REPO, where `mtplx models --json` then lists it. Any other combination pulls MODEL_REPO.
# `mtplx` is a stub on PATH: `models --json` lists the folders in the model root, `pull` and `forge build` make one.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$LOG_FILE"' EXIT

ROOT="$WORK/home/.mtplx/models"
SOURCE="ukisai/Swift-1.5-Qwen3.8-27b"
RECIPE='{"body_bits":8,"body_group_size":64,"body_mode":"affine","mtp_policy":"keep_bf16"}'
BRANDED="Swift-1.5-Qwen3.8-27B-MTPLX-Q8"
PACK="Youssofal/Qwen3.8-27B-MTPLX-Optimized-Quality"

mkdir -p "$WORK/bin"
cat > "$WORK/bin/mtplx" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$WORK/mtplx.log"
arg() { local want="\$1"; shift; while (( \$# )); do [[ "\$1" == "\$want" ]] && { echo "\$2"; return; }; shift; done; }
case "\$1 \${2:-}" in
  "models --json")
    python3 - "$ROOT" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
rows = [{"repo_id": d.name.replace("--", "/"), "path": str(d), "size_gb": 1,
         "validation": {"ok": True, "missing_files": []}}
        for d in sorted(root.iterdir()) if d.is_dir()] if root.is_dir() else []
print(json.dumps({"cache_dir": str(root), "models": rows}))
PY
    ;;
  "pull "*) mkdir -p "$ROOT/\${2//\//--}" ;;
  "forge build") mkdir -p "\$(arg --model-root "\$@")/\$(arg --branded-name "\$@")" ;;
esac
exit 0
STUB
chmod +x "$WORK/bin/mtplx"

fetch() { # [VAR=value ...] -> the model directory the installer settled on, or "failed"
  ( HOME="$WORK/home"; PATH="$WORK/bin:/usr/bin:/bin"
    . "$REPO_ROOT/lib/common.sh"
    MODEL_DISPLAY_NAME="test model"
    for kv in "$@"; do printf -v "${kv%%=*}" '%s' "${kv#*=}"; done
    . "$REPO_ROOT/lib/mtplx.sh"
    MTPLX_BIN="$WORK/bin/mtplx"
    ( backend_fetch_model; printf '%s' "$MODEL_ARTIFACT" > "$WORK/artifact" ) >"$WORK/fetch.out" 2>&1 \
      || { echo failed; exit 0; }          # err exits: keep it in its own shell
    cat "$WORK/artifact" )
}
reset() { rm -rf "$WORK/home" "$WORK/artifact"; mkdir -p "$ROOT"; : > "$WORK/mtplx.log"; }

echo "a Forge combination whose model is not built yet"
reset
assert_eq "the installer settles on the built model" "$ROOT/$BRANDED" \
  "$(fetch MODEL_REPO="$BRANDED" FORGE_SOURCE_REPO="$SOURCE" FORGE_RECIPE="$RECIPE")"
assert_ok "it built the model with Forge from the source repository" \
  grep -qF -- "forge build --repo $SOURCE" "$WORK/mtplx.log"
assert_ok "with the combination's recipe" grep -qF -- "--recipe $RECIPE" "$WORK/mtplx.log"
assert_ok "under the combination's name, in MTPLX's model root" \
  grep -qF -- "--branded-name $BRANDED --model-root $ROOT" "$WORK/mtplx.log"
assert_fails "and did not try to pull a pack that is not published" grep -q "^pull " "$WORK/mtplx.log"

echo "a Forge combination whose model is already built"
reset; mkdir -p "$ROOT/$BRANDED"
assert_eq "the installer uses it" "$ROOT/$BRANDED" \
  "$(fetch MODEL_REPO="$BRANDED" FORGE_SOURCE_REPO="$SOURCE" FORGE_RECIPE="$RECIPE")"
assert_fails "and builds nothing" grep -qE "^(forge|pull) " "$WORK/mtplx.log"

echo "a combination with a published MTPLX pack that is not cached"
reset
assert_eq "the installer pulls the pack" "$ROOT/${PACK//\//--}" "$(fetch MODEL_REPO="$PACK")"
assert_fails "and does not run Forge" grep -q "^forge " "$WORK/mtplx.log"

finish

#!/usr/bin/env bash
# MTPLX backend: bringing an installed MTPLX up to the combination's floor, without MTPLX, a model or the network.
# `mtplx` and `uv` are stubs on PATH. The `uv` stub behaves as uv does for a tool installed with an exact version pin
# (`uv tool install mtplx==2.12.2`): `uv tool upgrade mtplx` keeps the pin and changes nothing, while
# `uv tool install` with a new requirement replaces it.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$LOG_FILE"' EXIT

PINNED_VERSION="2.12.2"      # what the M5 Max had on 8 Nov 2026, installed pinned
LATEST_VERSION="2.12.3"      # the release that fixed MTPLX issue 605
FLOOR="2.12.3"

# bin/mtplx answers --version from $WORK/version; bin/uv logs its arguments and, like uv, leaves a pinned tool
# alone on `tool upgrade` and installs the newest version on `tool install` with any requirement but an exact pin.
mkdir -p "$WORK/bin" "$WORK/home/.local/bin"
cat > "$WORK/bin/mtplx" <<STUB
#!/usr/bin/env bash
case "\${1:-}" in
  --version) echo "mtplx \$(cat "$WORK/version")" ;;
  hardware) exit 0 ;;
esac
exit 0
STUB
cat > "$WORK/bin/uv" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$WORK/uv.log"
if [[ "\$1 \$2" == "tool upgrade" ]]; then
  echo "hint: \\\`mtplx\\\` is pinned to \\\`\$(cat "$WORK/version")\\\` (installed with an exact version pin)" >&2
  exit 0
fi
if [[ "\$1 \$2" == "tool install" ]]; then
  spec="\${@: -1}"
  case "\$spec" in
    mtplx==*) echo "\${spec#mtplx==}" > "$WORK/version" ;;
    mtplx*)   echo "$LATEST_VERSION" > "$WORK/version" ;;
  esac
  exit 0
fi
exit 0
STUB
chmod +x "$WORK/bin/mtplx" "$WORK/bin/uv"

ensure() { # floor -> the version ensure_mtplx left installed, or "failed"
  ( HOME="$WORK/home"; PATH="$WORK/bin:/usr/bin:/bin"
    . "$REPO_ROOT/lib/common.sh"
    MIN_MTPLX_VERSION="$1"
    . "$REPO_ROOT/lib/mtplx.sh"
    ( ensure_mtplx ) >"$WORK/ensure.out" 2>&1 || { echo failed; exit 0; }   # err exits: keep it in its own shell
    cat "$WORK/version" )
}

echo "an MTPLX installed with an exact pin, older than the combination's floor"
echo "$PINNED_VERSION" > "$WORK/version"; : > "$WORK/uv.log"
assert_eq "the install is brought up to the floor" "$LATEST_VERSION" "$(ensure "$FLOOR")"
assert_ok "and uv was asked for at least the floor, not a bare upgrade" grep -q -- "tool install mtplx>=$FLOOR" "$WORK/uv.log"

echo "an MTPLX already at the floor"
echo "$LATEST_VERSION" > "$WORK/version"; : > "$WORK/uv.log"
assert_eq "it is left as it is" "$LATEST_VERSION" "$(ensure "$FLOOR")"
assert_eq "and uv is not run" "" "$(cat "$WORK/uv.log")"

finish

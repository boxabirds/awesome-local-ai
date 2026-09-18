#!/usr/bin/env bash
# Install dependencies for the planning-poker app.
# Idempotent: a repeat run with unchanged package.json/lockfile is a fast no-op.
# Portable to bash 3.2 (macOS default). Bun is preferred; npm is the fallback.
#   ./scripts/install.sh            # install only
#   ./scripts/install.sh --build    # install + production build
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() { echo "usage: install.sh [--build] [--help]"; }

BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install.sh: unknown arg '$arg' (see --help)" >&2; exit 2 ;;
  esac
done

# --- choose toolchain (bun preferred, npm fallback) ---
if command -v bun >/dev/null 2>&1; then
  PKGMAN=bun; RUNX=bunx
elif command -v npm >/dev/null 2>&1; then
  PKGMAN=npm; RUNX=npx
else
  echo "install.sh: need 'bun' or 'npm' on PATH. None found." >&2
  exit 1
fi
echo "[install] toolchain: $PKGMAN"

# --- dependency fingerprint for idempotency ---
STAMP="node_modules/.pp-install-stamp"
fingerprint() {
  # Hash the files that determine the dependency set. Missing lock is fine.
  # The trailing `true` keeps the pipeline's exit status clean under `set -o pipefail`.
  { cksum package.json 2>/dev/null
    [ -f bun.lock ] && cksum bun.lock 2>/dev/null
    [ -f package-lock.json ] && cksum package-lock.json 2>/dev/null
    true
  } | cksum | awk '{print $1}'
}
CURRENT="$(fingerprint)"

need_install=0
if [ ! -x node_modules/.bin/vite ]; then
  need_install=1
elif [ ! -f "$STAMP" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$CURRENT" ]; then
  need_install=1
fi

if [ "$need_install" -eq 1 ]; then
  echo "[install] installing dependencies via $PKGMAN ..."
  if [ "$PKGMAN" = bun ]; then bun install
  else npm install
  fi
else
  echo "[install] dependencies unchanged (stamp matches) — skipping install."
fi

# --- verify ---
if [ ! -x node_modules/.bin/vite ]; then
  echo "[install] ERROR: vite missing after install" >&2
  exit 1
fi
printf '%s\n' "$CURRENT" > "$STAMP"
echo "[install] dependencies ready."

if [ "$BUILD" -eq 1 ]; then
  echo "[install] --build: production build ..."
  "$RUNX" vite build
  echo "[install] build complete -> dist/"
fi

echo "[install] done."

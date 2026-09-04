#!/usr/bin/env bash
# Bash wrapper for dependency install (mirrors scripts/install.mjs).
# Idempotent: safe to run repeatedly; fast when the npm cache is warm.
#   ./scripts/install.sh            # install only
#   ./scripts/install.sh --build    # install + production build
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    -h|--help)
      echo "usage: install.sh [--build]"; exit 0 ;;
    *) echo "install.sh: unknown arg '$arg'" >&2; exit 2 ;;
  esac
done

echo "[install] running npm install (idempotent, fast when cached)..."
npm install

if [ ! -x node_modules/.bin/vite ]; then
  echo "[install] ERROR: vite missing after install" >&2
  exit 1
fi
echo "[install] dependencies ready."

if [ "$BUILD" -eq 1 ]; then
  echo "[install] --build: running production build..."
  npx vite build
  echo "[install] build complete -> dist/"
fi

echo "[install] done."

#!/usr/bin/env bash
# Install dependencies and build the frontend bundle.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Installing npm dependencies"
npm install

echo "==> Building frontend"
npm run build

echo "==> Done. Start the app with: ./scripts/run.sh"

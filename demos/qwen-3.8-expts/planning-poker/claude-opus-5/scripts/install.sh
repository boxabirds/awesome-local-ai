#!/usr/bin/env bash
# One-time local setup: dependencies, local D1 schema, first build.
#
#   ./scripts/install.sh              set up, reusing anything already valid
#   ./scripts/install.sh --force      discard node_modules and reinstall
#
# Safe to re-run and safe to interrupt: a half-finished install is detected and
# redone rather than limping on. Touches nothing outside this directory and
# never contacts staging or production.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/lib.sh
source "${REPO_ROOT}/scripts/lib.sh"

MIN_NODE_MAJOR=20
D1_BINDING="DB"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "Unknown option '$arg'. Use --force or --help." ;;
  esac
done

# --------------------------------------------------------------------------
# 1. Toolchain
# --------------------------------------------------------------------------
require_node "$MIN_NODE_MAJOR"
log "Node $(node -v), npm $(npm -v)"

[[ -f package.json ]] || die "No package.json in ${REPO_ROOT}. Wrong directory?"

# --------------------------------------------------------------------------
# 2. Dependencies
# --------------------------------------------------------------------------
if (( FORCE )); then
  log "--force: removing node_modules"
  rm -rf node_modules
fi

install_from_lockfile() { npm ci --no-audit --no-fund; }
install_resolving()     { npm install --no-audit --no-fund; }

if dependencies_look_installed && (( ! FORCE )); then
  log "Dependencies already present; skipping install (use --force to redo)"
elif [[ -f package-lock.json ]]; then
  log "Installing from package-lock.json"
  # `npm ci` is reproducible but refuses to run when the lockfile has drifted
  # from package.json, so fall back rather than dead-ending the setup.
  if ! retry "$RETRY_ATTEMPTS" "$RETRY_BASE_SECONDS" install_from_lockfile; then
    warn "npm ci failed. Falling back to npm install, which will update the lockfile."
    retry "$RETRY_ATTEMPTS" "$RETRY_BASE_SECONDS" install_resolving \
      || die "Could not install dependencies. Check your network and npm registry access."
  fi
else
  log "No lockfile yet; resolving dependencies"
  retry "$RETRY_ATTEMPTS" "$RETRY_BASE_SECONDS" install_resolving \
    || die "Could not install dependencies. Check your network and npm registry access."
fi

dependencies_look_installed \
  || die "node_modules is incomplete after installing. Re-run with --force."

# --------------------------------------------------------------------------
# 3. Local secrets file
# --------------------------------------------------------------------------
# Never overwrite: whatever is already in .dev.vars is the developer's, not ours.
if [[ ! -f .dev.vars && -f .dev.vars.example ]]; then
  cp .dev.vars.example .dev.vars
  log "Created .dev.vars from the example (git-ignored, nothing required in it today)"
fi

# --------------------------------------------------------------------------
# 4. Local D1 schema
# --------------------------------------------------------------------------
# Local migrations run against a SQLite file under .wrangler/, never the remote
# database — there is no --remote flag anywhere in this script.
apply_local_migrations() { npx wrangler d1 migrations apply "$D1_BINDING" --local; }

log "Applying migrations to the local D1 database"
retry "$RETRY_ATTEMPTS" "$RETRY_BASE_SECONDS" apply_local_migrations \
  || die "Local migrations failed. If .wrangler/state is corrupt, delete it and re-run."

# --------------------------------------------------------------------------
# 5. First build
# --------------------------------------------------------------------------
# Workers Static Assets serves ./dist, so the worker needs it to exist before it
# can serve the app at all. A build failure is a code problem: fail fast, no retry.
log "Building the frontend"
npm run build || die "Frontend build failed. Fix the error above and re-run."

log "Verifying the worker bundles"
npx wrangler deploy --dry-run --outdir=.wrangler/dry-run >/dev/null 2>&1 \
  || die "The worker does not bundle. Run 'npx wrangler deploy --dry-run' to see why."

cat <<'DONE'

Setup complete.

  ./scripts/run.sh          serve the built app on one port (what your team will use)
  ./scripts/run.sh dev      Vite with hot reload, proxying the API to the worker
  ./scripts/run.sh test     start a server, run unit + e2e suites against it, shut down
  npm test                  unit tests only

DONE

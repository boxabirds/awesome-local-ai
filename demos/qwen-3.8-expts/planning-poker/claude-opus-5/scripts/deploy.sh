#!/usr/bin/env bash
# Deploy the Worker (API + Durable Object + SPA assets) to staging or production.
#
#   ./scripts/deploy.sh staging
#   ./scripts/deploy.sh production v1.2.0
#
# Safety: scans pending migrations for irreversible SQLite patterns, skips a
# redeploy of an identical SHA, retries transient wrangler failures, and
# verifies /health before declaring success.
set -euo pipefail

ENVIRONMENT="${1:-}"
VERSION="${2:-}"

if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
  echo "usage: $0 <staging|production> [version-tag]" >&2
  exit 64
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DEPLOY_LOG="$REPO_ROOT/.deploy-log.csv"
MIGRATIONS_DIR="$REPO_ROOT/migrations"
MAX_ATTEMPTS=3
RETRY_BASE_SECONDS=4
HEALTH_TIMEOUT_SECONDS=20

GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
OPERATOR="$(git config user.email 2>/dev/null || whoami)"

log()  { printf '\033[0;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m/!\\\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[0;31mxxx\033[0m %s\n' "$*" >&2; record "failed"; exit 1; }

record() {
  local status="$1"
  [[ -f "$DEPLOY_LOG" ]] || echo "deploy_id,operator,environment,git_sha,timestamp,status,version" > "$DEPLOY_LOG"
  echo "$(date -u +%Y%m%d-%H%M%S),$OPERATOR,$ENVIRONMENT,$GIT_SHA,$DEPLOYED_AT,$status,$VERSION" >> "$DEPLOY_LOG"
}

# --------------------------------------------------------------------------
# 1. Migration safety scan
# --------------------------------------------------------------------------
# CHECK constraints are immutable in SQLite: removing one means rebuilding the
# whole table. The same goes for the other patterns here — they are one-way
# doors on a live database, so production refuses them outright.
scan_migrations() {
  local dangerous='CHECK[[:space:]]*\(|DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|ADD[[:space:]]+CONSTRAINT|ALTER[[:space:]]+TABLE[^;]*MODIFY'
  local hits
  hits="$(grep -rEIn "$dangerous" "$MIGRATIONS_DIR" 2>/dev/null || true)"
  [[ -z "$hits" ]] && { log "Migration scan clean"; return 0; }

  warn "Irreversible patterns found in migrations:"
  echo "$hits" >&2
  if [[ "$ENVIRONMENT" == "production" ]]; then
    die "Refusing to deploy to production. Rewrite the migration as an additive change."
  fi
  warn "Continuing to staging anyway."
}

# --------------------------------------------------------------------------
# 2. Idempotency
# --------------------------------------------------------------------------
worker_url() {
  if [[ "$ENVIRONMENT" == "production" ]]; then
    echo "${PRODUCTION_URL:-https://pointing-poker.workers.dev}"
  else
    echo "${STAGING_URL:-https://pointing-poker-staging.workers.dev}"
  fi
}

already_deployed() {
  local deployed
  deployed="$(curl -fsS --max-time "$HEALTH_TIMEOUT_SECONDS" "$(worker_url)/health" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).git_sha||"")}catch{console.log("")}})' \
    || echo "")"
  [[ -n "$deployed" && "$deployed" == "$GIT_SHA" ]]
}

# --------------------------------------------------------------------------
# 3. Deploy with backoff
# --------------------------------------------------------------------------
retry() {
  local attempt=1
  until "$@"; do
    if (( attempt >= MAX_ATTEMPTS )); then
      return 1
    fi
    warn "Attempt $attempt failed; retrying in $(( RETRY_BASE_SECONDS * attempt ))s"
    sleep $(( RETRY_BASE_SECONDS * attempt ))
    (( attempt++ ))
  done
}

verify_health() {
  local body
  body="$(curl -fsS --max-time "$HEALTH_TIMEOUT_SECONDS" "$(worker_url)/health")" || return 1
  echo "$body" | grep -q '"status":"ok"' || return 1
  log "Health check passed: $body"
}

# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
log "Deploying $VERSION ($GIT_SHA) to $ENVIRONMENT"

scan_migrations

if already_deployed; then
  log "$GIT_SHA is already live on $ENVIRONMENT. Applying migrations only."
else
  log "Building frontend"
  npm run build

  log "Applying D1 migrations"
  retry npx wrangler d1 migrations apply DB --env "$ENVIRONMENT" --remote \
    || die "Migrations failed"

  log "Deploying worker"
  retry npx wrangler deploy \
    --env "$ENVIRONMENT" \
    --var "APP_VERSION:$VERSION" \
    --var "GIT_SHA:$GIT_SHA" \
    --var "DEPLOYED_AT:$DEPLOYED_AT" \
    || die "Deploy failed after $MAX_ATTEMPTS attempts"
fi

retry verify_health || die "Deployed, but /health did not come back healthy"

if [[ "$ENVIRONMENT" == "production" ]] && git rev-parse --git-dir >/dev/null 2>&1; then
  TAG="deploy/prod/$(date -u +%Y%m%d-%H%M%S)"
  git tag -a "$TAG" -m "Deploy $VERSION ($GIT_SHA)" && log "Tagged $TAG"
fi

record "succeeded"
log "Done."

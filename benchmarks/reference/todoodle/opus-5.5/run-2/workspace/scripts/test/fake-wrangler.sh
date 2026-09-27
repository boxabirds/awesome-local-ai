#!/usr/bin/env bash
# Stand-in for the `wrangler` CLI in release pipeline integration tests: the only faked boundary.
# Records every invocation's argv (one line per call) and replies with output shaped like real
# wrangler 4 output.
#
#   FAKE_WRANGLER_LOG            file receiving one line per call: "wrangler <args...>"
#   FAKE_WRANGLER_STATE          writable dir for call counters
#   FAKE_WRANGLER_PENDING        space-separated pending migration file names (default none)
#   FAKE_WRANGLER_DEPLOY         comma-separated outcomes per deploy call, e.g. "fail,fail,ok";
#                                the last one repeats (default "ok")
#   FAKE_WRANGLER_LIVE_SHA_FILE  on a successful deploy, the GIT_SHA var is written here (the fake
#                                health server serves it), unless FAKE_WRANGLER_NO_GO_LIVE=1
set -euo pipefail

echo "wrangler $*" >> "${FAKE_WRANGLER_LOG:?FAKE_WRANGLER_LOG not set}"

banner() {
  echo ""
  echo " ⛅️ wrangler 4.141.0"
  echo "───────────────────"
}

case "${1:-} ${2:-} ${3:-}" in
  "d1 migrations list")
    banner
    echo "Resource location: remote "
    echo ""
    if [ -z "${FAKE_WRANGLER_PENDING:-}" ]; then
      echo "✅ No migrations to apply!"
    else
      echo "Migrations to be applied:"
      echo "┌──────────────────────────────┐"
      echo "│ Name                         │"
      echo "├──────────────────────────────┤"
      for name in $FAKE_WRANGLER_PENDING; do
        printf '│ %-28s │\n' "$name"
      done
      echo "└──────────────────────────────┘"
    fi
    exit 0
    ;;
  "d1 migrations apply")
    banner
    echo "Resource location: remote "
    for name in ${FAKE_WRANGLER_PENDING:-}; do
      echo "🌀 Executing on remote database DB (00000000-0000-0000-0000-000000000000):"
      echo "🚣 Executed 1 command in 0.51ms ($name)"
    done
    echo "✅ Applied migrations"
    exit 0
    ;;
esac

if [ "${1:-}" = "deploy" ]; then
  counter="${FAKE_WRANGLER_STATE:?FAKE_WRANGLER_STATE not set}/deploy-count"
  count=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
  echo "$count" > "$counter"
  IFS=',' read -r -a outcomes <<< "${FAKE_WRANGLER_DEPLOY:-ok}"
  index=$(( count - 1 ))
  if [ "$index" -ge "${#outcomes[@]}" ]; then index=$(( ${#outcomes[@]} - 1 )); fi
  outcome="${outcomes[$index]}"

  banner
  if [ "$outcome" != "ok" ]; then
    echo "" >&2
    echo "✘ [ERROR] A request to the Cloudflare API (/accounts/0123456789abcdef/workers/scripts/todoodle-staging/versions) failed." >&2
    echo "" >&2
    echo "  Service unavailable [code: 10013]" >&2
    exit 1
  fi

  sha=""
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--var" ] && [[ "$arg" == GIT_SHA:* ]]; then sha="${arg#GIT_SHA:}"; fi
    prev="$arg"
  done
  echo "Total Upload: 243.51 KiB / gzip: 58.12 KiB"
  echo "Uploaded todoodle-staging (3.21 sec)"
  echo "Deployed todoodle-staging triggers (0.35 sec)"
  echo "  https://todoodle-staging.example.workers.dev"
  echo "Current Version ID: 1b2c3d4e-5f60-4718-293a-4b5c6d7e8f90"
  if [ -n "${FAKE_WRANGLER_LIVE_SHA_FILE:-}" ] && [ "${FAKE_WRANGLER_NO_GO_LIVE:-}" != "1" ]; then
    printf '%s' "$sha" > "$FAKE_WRANGLER_LIVE_SHA_FILE"
  fi
  exit 0
fi

echo "✘ [ERROR] fake wrangler: unsupported command: $*" >&2
exit 1

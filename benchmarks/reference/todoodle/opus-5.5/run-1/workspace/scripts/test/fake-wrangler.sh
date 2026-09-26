#!/bin/sh
# Fake `wrangler` for release pipeline integration tests: the only faked boundary (Cloudflare).
# Records every invocation's argv as one line in $FAKE_WRANGLER_STATE/calls.log and emits output shaped
# like real wrangler. Scripted by files in $FAKE_WRANGLER_STATE:
#   pending        pending migration names, one per line (empty or missing = none)
#   deploy-fails   number of upcoming `deploy` calls that fail (decremented per failure)
#   deployed-sha   written with the GIT_SHA var on a successful deploy (the fake health server reads it)
set -u
state="${FAKE_WRANGLER_STATE:?FAKE_WRANGLER_STATE must be set}"
echo "wrangler $*" >> "$state/calls.log"

echo " ⛅️ wrangler 4.141.0"
echo "-------------------"

case "$1 ${2:-} ${3:-}" in
  "d1 migrations list")
    echo "Resource location: remote"
    if [ -s "$state/pending" ]; then
      echo "Migrations to be applied:"
      echo "┌──────────────────────────┐"
      echo "│ Name                     │"
      echo "├──────────────────────────┤"
      while IFS= read -r name || [ -n "$name" ]; do
        [ -n "$name" ] && printf '│ %-24s │\n' "$name"
      done < "$state/pending"
      echo "└──────────────────────────┘"
    else
      echo "✅ No migrations to apply!"
    fi
    exit 0
    ;;
  "d1 migrations apply")
    echo "Resource location: remote"
    echo "🌀 Executing on remote database DB:"
    echo "✅ Migrations applied"
    : > "$state/pending"
    exit 0
    ;;
esac

if [ "$1" = "deploy" ]; then
  fails=0
  [ -f "$state/deploy-fails" ] && fails=$(cat "$state/deploy-fails")
  if [ "$fails" -gt 0 ]; then
    echo $((fails - 1)) > "$state/deploy-fails"
    echo "✘ [ERROR] A request to the Cloudflare API (/accounts/abc/workers/scripts/todoodle) failed." >&2
    echo "  Service unavailable [code: 10013]" >&2
    exit 1
  fi
  sha=""
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--var" ]; then
      case "$arg" in GIT_SHA:*) sha="${arg#GIT_SHA:}" ;; esac
    fi
    prev="$arg"
  done
  printf '%s' "$sha" > "$state/deployed-sha"
  echo "Total Upload: 42.00 KiB / gzip: 10.00 KiB"
  echo "Uploaded todoodle (1.20 sec)"
  echo "Deployed todoodle triggers (0.40 sec)"
  echo "  https://todoodle-staging.example.workers.dev"
  echo "Current Version ID: 00000000-0000-4000-8000-000000000000"
  exit 0
fi

echo "✘ [ERROR] fake wrangler: unsupported command: $*" >&2
exit 1

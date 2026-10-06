#!/usr/bin/env bash
# A Claude Code PreToolUse hook: refuse git commands that discard work.
#
# CLAUDE.md asks for this, but CLAUDE.md is guidance a model may or may not follow. This is the enforcement.
#
# What is at risk: a bench machine's repository is where the harness commits a run's records. Its raw data --
# logs, conditions, artifacts, the workspace -- is gitignored and the collector copies it to the lake. Its
# SCORES are tracked in git, so between the harness committing them and the push landing they exist in one
# place. A reset there deletes results that nothing else holds.
#
# The command string is matched wherever it appears, including inside `ssh <node> '...'`, because that is how
# a bench checkout is usually reached and the hook cannot tell which repository a remote command will land in.
# Refusing everywhere costs a retry; allowing it once cost A-044's fourteen records their only copy.
set -euo pipefail

INPUT=$(cat)
COMMAND=$(jq -r '.tool_input.command // empty' <<< "$INPUT")

deny() {
  jq -n --arg reason "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $reason
    }
  }'
  exit 0
}

ALT="To move a checkout forward use 'git pull --ff-only' and let it fail: a refusal costs a retry, a reset costs results. To put a file back after a test, copy it aside first (cp f /tmp/f.bak) and copy it back."

# git reset --hard / --merge: discards commits and the working tree.
if grep -qE '(^|[[:space:];&|(]|'"'"')git([[:space:]]+-[^[:space:]]+)*[[:space:]]+reset([[:space:]]|$)' <<< "$COMMAND" \
   && grep -qE -- '--hard|--merge' <<< "$COMMAND"; then
  deny "git reset --hard/--merge is blocked in this project: on a bench checkout it deletes run records that exist nowhere else until their push lands. $ALT"
fi

# git clean -f: deletes untracked files, which on a bench machine is the raw data the lake has not pulled yet.
if grep -qE '(^|[[:space:];&|(]|'"'"')git([[:space:]]+-[^[:space:]]+)*[[:space:]]+clean([[:space:]]|$)' <<< "$COMMAND" \
   && grep -qE -- '-[a-zA-Z]*f' <<< "$COMMAND"; then
  deny "git clean -f is blocked in this project: it deletes a run's untracked raw data before the collector has pulled it. $ALT"
fi

# git checkout -- <path> / git checkout . : throws away uncommitted work.
if grep -qE '(^|[[:space:];&|(]|'"'"')git([[:space:]]+-[^[:space:]]+)*[[:space:]]+checkout[[:space:]]+(--[[:space:]]|\.([[:space:]]|$))' <<< "$COMMAND"; then
  deny "git checkout -- <path> is blocked in this project: it discards uncommitted work, which on a bench checkout is a run's records. $ALT"
fi

# git restore: the same discard under a newer name.
if grep -qE '(^|[[:space:];&|(]|'"'"')git([[:space:]]+-[^[:space:]]+)*[[:space:]]+restore([[:space:]]|$)' <<< "$COMMAND"; then
  deny "git restore is blocked in this project: it discards uncommitted work, which on a bench checkout is a run's records. $ALT"
fi

exit 0

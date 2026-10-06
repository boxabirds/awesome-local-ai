#!/usr/bin/env bash
# The PreToolUse hook that refuses git commands which discard work. CLAUDE.md asks for this in words; the hook
# is what makes it bind. Each case feeds the hook the JSON Claude Code sends and reads its decision.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
trap 'rm -f "$LOG_FILE"' EXIT

HOOK="$REPO_ROOT/tools/hooks/block-destructive-git.sh"

# The decision for a command: "deny" or "allow" (the hook stays silent to allow).
decide() {
  local out
  out="$(jq -n --arg c "$1" '{tool_input: {command: $c}}' | bash "$HOOK" 2>/dev/null)"
  if [[ -z "$out" ]]; then echo allow; else jq -r '.hookSpecificOutput.permissionDecision // "allow"' <<< "$out"; fi
}
reason() { jq -n --arg c "$1" '{tool_input: {command: $c}}' | bash "$HOOK" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecisionReason // ""'; }

echo "the hook exists and runs"
assert_ok "it is executable"  test -x "$HOOK"
assert_ok "it parses"         bash -n "$HOOK"

echo
echo "commands that discard work are refused"
for c in \
  "git reset --hard origin/main" \
  "git reset --hard" \
  "cd /x && git reset --hard HEAD~1" \
  "git clean -fd" \
  "git clean -fdx" \
  "git checkout -- lib/strata.sh" \
  "git checkout ." \
  "git restore lib/strata.sh" \
  ; do
  assert_eq "refused: $c" "deny" "$(decide "$c")"
done

echo
echo "...including inside an ssh command, which is how a bench checkout is reached"
assert_eq "ssh + reset --hard" "deny" \
  "$(decide "ssh node-a 'cd /srv/repo && git fetch -q origin && git reset --hard origin/main'")"
assert_eq "ssh + clean" "deny" "$(decide "ssh node-b 'cd ~/repo && git clean -fd'")"

echo
echo "the refusal says what to do instead"
assert_ok "it names --ff-only"   bash -c "reason() { jq -n --arg c \"\$1\" '{tool_input: {command: \$c}}' | bash '$HOOK' | jq -r '.hookSpecificOutput.permissionDecisionReason'; }; reason 'git reset --hard' | grep -q -- '--ff-only'"
assert_ok "it says why it matters on a bench checkout" bash -c "reason() { jq -n --arg c \"\$1\" '{tool_input: {command: \$c}}' | bash '$HOOK' | jq -r '.hookSpecificOutput.permissionDecisionReason'; }; reason 'git reset --hard' | grep -qi 'record'"

echo
echo "everything else is left alone"
for c in \
  "git pull --ff-only" \
  "git fetch -q origin" \
  "git status --short" \
  "git log --oneline -3" \
  "git add lib/strata.sh" \
  "git commit -q -m x" \
  "git push -q origin main" \
  "git rebase origin/main" \
  "git stash push -- lib/strata.sh" \
  "git reset --soft HEAD~1" \
  "git checkout -b nope" \
  "git show origin/main:metrics.json" \
  "grep -rn 'reset --hard' docs/" \
  ; do
  assert_eq "allowed: $c" "allow" "$(decide "$c")"
done

echo
# Knowingly over-broad. A quoted command is how a bench checkout is reached (ssh node 'git reset --hard') and
# also how the string is merely mentioned (grep 'git reset --hard'). The two are lexically identical, so the
# hook refuses both rather than parse a shell. Refusing a grep costs rephrasing it; letting one ssh through
# costs records. Both of these are expected to be denied.
echo "a mention of the command is refused too, which is the price of not parsing a shell"
assert_eq "grep for the literal string" "deny" "$(decide "grep -rn 'git reset --hard' docs/")"
assert_eq "echo of the rule" "deny" "$(decide "echo 'never git reset --hard a bench checkout'")"

finish

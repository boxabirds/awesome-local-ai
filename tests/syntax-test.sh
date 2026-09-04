#!/usr/bin/env bash
# Syntax, portability and shape.
#
# The bash 3.2 pass is the one that matters for macOS: /bin/bash there is
# 3.2.57, so anything a user might run with it must parse under it.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
cd "$REPO_ROOT"

echo "bash syntax"
for f in *.sh lib/*.sh lib/*/*.sh benchmarks/*.sh tests/*.sh combinations/*/*/*/*/*/*/config.sh; do
  [[ -e "$f" ]] || continue
  assert_ok "parses: $f" bash -n "$f"
done

echo
echo "bash 3.2 (stock macOS /bin/bash)"
if [[ -x /bin/bash ]]; then
  for f in install.sh start.sh run.sh lib/run.sh lib/select.sh lib/common.sh; do
    assert_ok "parses under bash 3.2: $f" /bin/bash -n "$f"
  done
else
  echo "  skipped (no /bin/bash)"
fi

echo
echo "GNU-only constructs that break on BSD userland"
# Comments explaining why a construct is absent must not count as uses, so
# every pattern here is anchored to code: no leading '#' on the line.
code_grep() { grep -rnE "^[^#]*$1" "${@:2}"; }

assert_fails "no find -printf (unsupported on macOS)" \
  code_grep '[-]printf' lib/ install.sh start.sh
assert_fails "no mapfile/readarray (bash 4+)" \
  code_grep '\b(mapfile|readarray)\b' lib/ install.sh start.sh
# setsid is absent on macOS. It may appear only inside the detached() guard in
# lib/runtime/session.sh -- i.e. as the `command -v` probe or as `setsid "$@"`.
# Any other use is a call site that would break on a Mac.
unguarded_setsid() {
  grep -rnE '^[^#]*setsid' lib/ install.sh start.sh 2>/dev/null \
    | grep -vE 'command -v setsid' \
    | grep -vE 'setsid "\$@"'
}
assert_fails "setsid appears only inside the detached() guard" unguarded_setsid

echo
echo "root pointers stay pointers"
for f in install-*.sh; do
  n="$(grep -cv -e '^\s*#' -e '^\s*$' "$f")"
  if (( n <= 5 )); then _pass "$f is $n lines of logic"
  else _fail "$f is a pointer, not a script" "<=5 lines" "$n lines"; fi
done

finish

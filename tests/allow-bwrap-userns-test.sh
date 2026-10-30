#!/usr/bin/env bash
# allow-bwrap-userns.sh: on Ubuntu 24.04 and newer, AppArmor's restriction on unprivileged user namespaces
# (kernel.apparmor_restrict_unprivileged_userns=1) leaves bwrap a user namespace in which it may not set up its network
# namespace: "bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted", and the agent sandbox cannot start (seen on a
# DGX Spark, 29 Oct 2026). The script installs an AppArmor profile that gives bwrap alone that right. This runs it against
# stand-ins for bwrap, apparmor_parser, id and sudo, with the profile directory and the sysctl in a temporary directory.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

SCRIPT="$REPO_ROOT/benchmarks/spec-bench/harness/allow-bwrap-userns.sh"
TMP="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$TMP"' EXIT
BIN="$TMP/bin"; mkdir -p "$BIN"
mk() { printf '#!/usr/bin/env bash\n%s\n' "$2" > "$BIN/$1"; chmod +x "$BIN/$1"; }
mk uname 'echo Linux'
# bwrap works once a profile is loaded (the parser leaves a marker), or when the restriction is off
mk bwrap 'echo "bwrap $* (as ${FAKE_AS:-me})" >> "$FAKE_LOG"
if [[ -n "${FAKE_BWRAP_OTHER_FAULT:-}" ]]; then echo "bwrap: some other fault" >&2; exit 1; fi
if [[ -f "$FAKE_STATE/loaded" || "$(cat "$USERNS_SYSCTL" 2>/dev/null)" != 1 ]]; then exit 0; fi
echo "bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted" >&2; exit 1'
mk apparmor_parser 'echo "apparmor_parser $*" >> "$FAKE_LOG"; [[ -n "${FAKE_PARSER_FAIL:-}" ]] && exit 1; touch "$FAKE_STATE/loaded"'
mk id 'if [[ "$1" == -u ]]; then [[ -n "${FAKE_ROOT:-}" ]] && echo 0 || echo 1000; else /usr/bin/id "$@"; fi'
# sudo: "-u <user> cmd" runs cmd as that user; otherwise it runs the command as root
mk sudo 'echo "sudo $*" >> "$FAKE_LOG"
if [[ "$1" == -u ]]; then u="$2"; shift 2; [[ "$1" == -- ]] && shift; FAKE_AS="$u" FAKE_ROOT= exec "$@"; fi
[[ "$1" == -- ]] && shift; FAKE_ROOT=1 SUDO_USER=tester exec "$@"'

fresh() { rm -rf "$TMP/w"; mkdir -p "$TMP/w/apparmor.d" "$TMP/w/state"; echo "${1:-1}" > "$TMP/w/userns"; : > "$TMP/w/log"; }
run() {  # run [env...]: sets RC, OUT, LOG
  env PATH="$BIN:$PATH" FAKE_LOG="$TMP/w/log" FAKE_STATE="$TMP/w/state" APPARMOR_D="$TMP/w/apparmor.d" \
    USERNS_SYSCTL="$TMP/w/userns" BWRAP="$BIN/bwrap" "$@" bash "$SCRIPT" > "$TMP/w/out" 2>&1
  RC=$?; OUT="$(cat "$TMP/w/out")"; LOG="$(cat "$TMP/w/log")"
}
contains() { [[ "$1" == *"$2"* ]]; }
PROFILE="$TMP/w/apparmor.d/bwrap"

echo "the restriction is on and bwrap fails (Ubuntu 24.04)"
fresh 1
run
assert_eq "exit 0 once fixed" "0" "$RC"
assert_ok "it asked for root through sudo" contains "$LOG" "sudo "
assert_ok "a profile for bwrap is written" test -f "$PROFILE"
assert_ok "it attaches to the bwrap binary" grep -q "^profile bwrap $BIN/bwrap flags=(unconfined) {" "$PROFILE"
assert_ok "it grants user namespaces" grep -qx "  userns," "$PROFILE"
assert_ok "it grants nothing more than that (unconfined, userns, local include)" \
  test "$(grep -cvE '^(abi <abi/4.0>,|include <tunables/global>|profile bwrap .*|  userns,|  include if exists <local/bwrap>|})$|^$' "$PROFILE")" = 0
assert_ok "the profile is loaded" contains "$LOG" "apparmor_parser -r $PROFILE"
assert_ok "and proved as the user who ran sudo, not as root" contains "$LOG" "(as tester)"
assert_ok "it says it works" contains "$OUT" "bwrap can now create its network namespace"

echo "already fixed, or never needed"
fresh 1; touch "$TMP/w/state/loaded"
run
assert_eq "bwrap already works: exit 0" "0" "$RC"
assert_ok "nothing is written" test ! -e "$PROFILE"
assert_ok "and no sudo is asked for" test -z "$(grep sudo "$TMP/w/log")"
assert_ok "it says nothing needs doing" contains "$OUT" "nothing to do"
fresh 0
run
assert_eq "restriction off (Ubuntu 22.04): exit 0" "0" "$RC"
assert_ok "nothing is written" test ! -e "$PROFILE"

echo "a different fault is not papered over"
fresh 0
run FAKE_BWRAP_OTHER_FAULT=1
assert_eq "bwrap fails with the restriction off: exit 1" "1" "$RC"
assert_ok "nothing is written" test ! -e "$PROFILE"
assert_ok "bwrap's own error is shown" contains "$OUT" "bwrap: some other fault"
assert_ok "and the restriction is ruled out" contains "$OUT" "not the cause"

echo "another profile already owns bwrap"
fresh 1
printf 'profile bwrap-userns-restrict %s flags=(attach_disconnected) {\n}\n' "$BIN/bwrap" > "$TMP/w/apparmor.d/bwrap-userns-restrict"
run
assert_eq "exit 1 rather than load a second profile for the same binary" "1" "$RC"
assert_ok "the existing profile is named" contains "$OUT" "bwrap-userns-restrict"
assert_ok "nothing is written" test ! -e "$PROFILE"

echo "a profile this script wrote before is replaced, not refused"
fresh 1
printf 'profile bwrap %s flags=(unconfined) {\n}\n' "$BIN/bwrap" > "$PROFILE"
run
assert_eq "exit 0" "0" "$RC"
assert_ok "now with userns" grep -qx "  userns," "$PROFILE"

echo "the parser fails"
fresh 1
run FAKE_PARSER_FAIL=1
assert_eq "exit 1" "1" "$RC"
assert_ok "and says so" contains "$OUT" "apparmor_parser could not load"

echo "resilience"
fresh 1
printf 'profile bwrap %s flags=(unconfined) {\n  # the old one\n}\n' "$BIN/bwrap" > "$PROFILE"
run FAKE_PARSER_FAIL=1
assert_eq "a profile that will not load: exit 1" "1" "$RC"
assert_ok "the previous profile is put back as it was" grep -q "# the old one" "$PROFILE"
fresh 1
run FAKE_PARSER_FAIL=1
assert_ok "with no previous profile, the one that would not load is removed" test ! -e "$PROFILE"
assert_ok "and no temporary file is left behind" test -z "$(ls -A "$TMP/w/apparmor.d")"
fresh 1
mkdir -p "$TMP/w/real"; cp "$BIN/bwrap" "$TMP/w/real/bwrap"; ln -sf "$TMP/w/real/bwrap" "$TMP/w/bwrap-link"
run BWRAP="$TMP/w/bwrap-link"
assert_ok "a symlinked bwrap: the profile attaches to the real binary" grep -q "^profile bwrap $TMP/w/real/bwrap " "$PROFILE"
fresh 1
run APPARMOR_PARSER=/nonexistent/apparmor_parser
assert_eq "no apparmor_parser: exit 1" "1" "$RC"
assert_ok "and says what is missing" contains "$OUT" "apparmor_parser"
assert_ok "nothing is written" test ! -e "$PROFILE"
fresh 1
rm "$TMP/w/userns"
run FAKE_BWRAP_OTHER_FAULT=1
assert_eq "a kernel without the sysctl, bwrap failing: exit 1" "1" "$RC"
assert_ok "the restriction is ruled out" contains "$OUT" "not the cause"
fresh 1
run SUDO=/nonexistent/sudo
assert_eq "not root and no sudo: exit 1" "1" "$RC"
assert_ok "and says to run it as root" contains "$OUT" "run it as root"
fresh 1
run
run
assert_eq "run twice: the second run is a no-op" "0" "$RC"
assert_ok "and says nothing needs doing" contains "$OUT" "nothing to do"

echo "only on Linux"
fresh 1
mk uname 'echo Darwin'
run
assert_eq "on macOS: exit 0, nothing to do" "0" "$RC"
assert_ok "nothing is written" test ! -e "$PROFILE"
mk uname 'echo Linux'

finish

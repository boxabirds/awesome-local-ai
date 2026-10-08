#!/usr/bin/env bash
# gufo-opencode runs the SAME engine, model and sampling as gufo-pi; only the client differs.
#
# The point of the combination is one variable at a time: pi 0.87.1 becomes OpenCode and nothing else moves.
# A value copied by hand into a second config.sh drifts (a re-pinned engine, a changed sampler), and the series would
# then compare two things at once. So this test sources both configs and fails on any setting that differs, other than
# the ones that are meant to.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

BASE="$REPO_ROOT/combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB"
PI="$BASE/gufo-pi"
OC="$BASE/gufo-opencode"
INSTALLER="$REPO_ROOT/install-qwen-3.8-flash-next-ubuntu-strix-halo-128GB-gufo-opencode.sh"

# The settings that are allowed to differ: the install's identity and location, and the client.
ALLOWED_TO_DIFFER=" INSTALL_ID INSTALL_REL DISPLAY_NAME CLIENT "

dump() { # <config.sh>: every variable the config sets, one per line, name=value
  env -i bash -c '
    before=$(compgen -v | sort)
    . "$1"
    after=$(compgen -v | sort)
    for v in $(comm -13 <(echo "$before") <(echo "$after")); do printf "%s=%s\n" "$v" "${!v}"; done' _ "$1" 2>/dev/null | sort
}
value() { grep "^$1=" <<<"$2" | head -1; }

assert_ok "config.sh present"     test -f "$OC/config.sh"
assert_ok "profiles.tsv present"  test -f "$OC/profiles.tsv"
assert_ok "help.txt present"      test -f "$OC/help.txt"
assert_ok "README.md present"     test -f "$OC/README.md"
assert_ok "installer pointer present and executable" test -x "$INSTALLER"
assert_ok "INSTALL_ID is a literal line (dbench reads it without sourcing)" grep -q '^INSTALL_ID="[^"]*"' "$OC/config.sh"
assert_ok "profiles.tsv identical to gufo-pi's" cmp -s "$PI/profiles.tsv" "$OC/profiles.tsv"

pi_vars="$(dump "$PI/config.sh")"; oc_vars="$(dump "$OC/config.sh")"
differing="$(diff <(echo "$pi_vars") <(echo "$oc_vars") | grep -E '^[<>] ' | sed -E 's/^[<>] ([A-Za-z_0-9]+)=.*/\1/' | sort -u)"
unexpected=""
for v in $differing; do
  [[ "$ALLOWED_TO_DIFFER" == *" $v "* ]] || unexpected+="$v "
done
assert_eq "no setting differs from gufo-pi except identity and client" "" "$unexpected"
assert_eq "client is opencode" "CLIENT=opencode" "$(value CLIENT "$oc_vars")"
assert_eq "same engine image digest as gufo-pi" "$(value GUFO_IMAGE "$pi_vars")" "$(value GUFO_IMAGE "$oc_vars")"
assert_eq "engine pinned at 0.5.0" "GUFO_VERSION=0.5.0" "$(value GUFO_VERSION "$oc_vars")"
assert_eq "same sampling as gufo-pi" "$(value SAMPLING_THINKING "$pi_vars")" "$(value SAMPLING_THINKING "$oc_vars")"
assert_eq "same context as gufo-pi" "$(value CONTEXT_LIMIT "$pi_vars")" "$(value CONTEXT_LIMIT "$oc_vars")"
oc_id="$(value INSTALL_ID "$oc_vars")"; pi_id="$(value INSTALL_ID "$pi_vars")"
assert_eq "own install id (the job queue maps an install id to one combination)" "different" \
  "$([[ -n "$oc_id" && "$oc_id" != "$pi_id" ]] && echo different || echo same)"
# The two share one install directory, so the 114 GB of weights are not downloaded twice.
assert_eq "shares gufo-pi's install directory" "INSTALL_REL=.local/share/qwen38-flash-next-strix-gufo" "$(value INSTALL_REL "$oc_vars")"

finish

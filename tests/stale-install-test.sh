#!/usr/bin/env bash
# A job refuses to start when the combination installed on the machine differs from the repository's.
#
# A combination's launcher (lib/runtime/server-<backend>.sh) and profile (combinations/**/profiles.tsv) reach a
# machine only by running that combination's installer. They are not part of a harness release. On 5 October
# 2026 (A-046) the A-045 fix was committed, released, and pulled by the node, and the run still failed with the
# old message naming the old figure, because the installed copies were the old ones. Two attempts burned, the
# run cancelled with one restart left, and nothing anywhere compared the two copies.
#
# The check has to be reachable in a second: the real failure costs hours and a run.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"

HELPER="$REPO_ROOT/benchmarks/spec-bench/harness/installed-config.sh"
HARNESS_RUN="$REPO_ROOT/benchmarks/spec-bench/harness/run.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A throwaway HOME holding one installed combination, and a throwaway repo holding its source.
FAKE_HOME="$WORK/home"; FAKE_REPO="$WORK/repo"
ID="test-id"; BACKEND="strata"; COMBO="qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi"
SHARE="$FAKE_HOME/.local/share/$ID"; BIN="$FAKE_HOME/.local/bin"
COMBO_DIR="$FAKE_REPO/combinations/$COMBO"

# The real shapes: A-046 was a profile that gained a column, and a launcher that gained a gate.
OLD_PROFILE=$'name\tctx\tneed_vram_mib\tneed_ram_mib\tbasis\tsummary\nagent\t131072\t23955\t16000\tmeasured\tagent work\n'
NEW_PROFILE=$'name\tctx\tmin_vram_mib\tneed_vram_mib\tneed_ram_mib\tbasis\tsummary\nagent\t131072\t16505\t23955\t16000\tmeasured\tagent work\n'
OLD_LAUNCHER=$'#!/usr/bin/env bash\n(( free_vram < NEED_VRAM )) && die "needs"\n'
NEW_LAUNCHER=$'#!/usr/bin/env bash\n(( free_vram < MIN_VRAM )) && die "needs at least"\n'

setup() { # <installed-profile> <repo-profile> <installed-launcher> <repo-launcher>
  rm -rf "$FAKE_HOME" "$FAKE_REPO"
  mkdir -p "$SHARE" "$BIN" "$COMBO_DIR" "$FAKE_REPO/lib/runtime"
  [[ "$1" == skip ]] || printf '%s' "$1" > "$SHARE/profiles.tsv"
  [[ "$2" == skip ]] || printf '%s' "$2" > "$COMBO_DIR/profiles.tsv"
  [[ "$3" == skip ]] || { printf '%s' "$3" > "$BIN/local-ai-$BACKEND-server"; chmod +x "$BIN/local-ai-$BACKEND-server"; }
  [[ "$4" == skip ]] || printf '%s' "$4" > "$FAKE_REPO/lib/runtime/server-$BACKEND.sh"
}

# The drift report for the current fixture, as the helper prints it.
drift() {
  ( set +u; HOME="$FAKE_HOME"; . "$HELPER"; installed_config_drift "$ID" "$BACKEND" "$COMBO_DIR" "$FAKE_REPO" ) 2>&1
}
drift_rc() {
  ( set +u; HOME="$FAKE_HOME"; . "$HELPER"; installed_config_drift "$ID" "$BACKEND" "$COMBO_DIR" "$FAKE_REPO" >/dev/null 2>&1 )
  echo $?
}

echo "the helper exists and parses"
assert_ok "it is there"  test -f "$HELPER"
assert_ok "it parses"    bash -n "$HELPER"

echo
echo "an install that matches the repository is not drift"
setup "$NEW_PROFILE" "$NEW_PROFILE" "$NEW_LAUNCHER" "$NEW_LAUNCHER"
assert_eq "it reports nothing" "" "$(drift)"
assert_eq "and succeeds"       "0" "$(drift_rc)"

echo
echo "A-046 itself: the repo has the fix, the machine has the old profile"
setup "$OLD_PROFILE" "$NEW_PROFILE" "$NEW_LAUNCHER" "$NEW_LAUNCHER"
assert_eq "it fails"              "1" "$(drift_rc)"
assert_ok "it names profiles.tsv" bash -c "[[ \$(HOME='$FAKE_HOME'; . '$HELPER'; installed_config_drift '$ID' '$BACKEND' '$COMBO_DIR' '$FAKE_REPO' 2>&1) == *profiles.tsv* ]]"

echo
echo "...and the other half of A-046: the old launcher, with the gate that was fixed"
setup "$NEW_PROFILE" "$NEW_PROFILE" "$OLD_LAUNCHER" "$NEW_LAUNCHER"
assert_eq "it fails"            "1" "$(drift_rc)"
assert_ok "it names the launcher" bash -c "[[ \$(HOME='$FAKE_HOME'; . '$HELPER'; installed_config_drift '$ID' '$BACKEND' '$COMBO_DIR' '$FAKE_REPO' 2>&1) == *server-$BACKEND* ]]"

echo
echo "both stale: both are named, so one re-install fixes everything at once"
setup "$OLD_PROFILE" "$NEW_PROFILE" "$OLD_LAUNCHER" "$NEW_LAUNCHER"
out="$(drift)"
assert_ok "names the profile"  bash -c "[[ \"\$1\" == *profiles.tsv* ]]" _ "$out"
assert_ok "names the launcher" bash -c "[[ \"\$1\" == *server-$BACKEND* ]]" _ "$out"

echo
echo "a file missing from the install is drift too -- it cannot be the repository's copy"
setup skip "$NEW_PROFILE" "$NEW_LAUNCHER" "$NEW_LAUNCHER"
assert_eq "no installed profile" "1" "$(drift_rc)"

echo
echo "nothing to compare is not drift: a backend with no launcher in the repo (a cloud stack)"
setup "$NEW_PROFILE" "$NEW_PROFILE" "$NEW_LAUNCHER" skip
assert_eq "skipped, not failed" "0" "$(drift_rc)"
setup "$NEW_PROFILE" skip "$NEW_LAUNCHER" "$NEW_LAUNCHER"
assert_eq "no repo profile either" "0" "$(drift_rc)"

echo
echo "the refusal tells the operator what to do"
setup "$OLD_PROFILE" "$NEW_PROFILE" "$NEW_LAUNCHER" "$NEW_LAUNCHER"
out="$(drift)"
assert_ok "it says to re-run the installer" bash -c "[[ \"\$1\" == *installer* ]]" _ "$out"
assert_ok "it gives the installer command" bash -c "[[ \"\$1\" == *install-qwen-3.8-flash-next-ubuntu-nvidia4090-strata-pi.sh* ]]" _ "$out"
assert_ok "it names the combination"        bash -c "[[ \"\$1\" == *$COMBO* || \"\$1\" == *$ID* ]]" _ "$out"

echo
echo "and the harness calls it, so a job cannot start on a stale install"
assert_ok "run.sh sources the helper"  grep -q 'installed-config.sh' "$HARNESS_RUN"
assert_ok "run.sh calls the check"     grep -q 'installed_config_drift' "$HARNESS_RUN"
assert_ok "run.sh parses"              bash -n "$HARNESS_RUN"

finish

#!/usr/bin/env bash
# System packages that need a sudo password: in a terminal the installer pauses, prints the exact
# command to run in another terminal, and carries on once the packages are there -- it never asks for
# the password itself. Unattended (dbench, CI, a pipe) it keeps warning and continuing.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# dpkg reports the two packages missing until the "user" has run the command elsewhere, which the
# test models as: they are installed after INSTALLED_AFTER dpkg checks.
run_deps() { # interactive(0|1) installed_after stdin
  printf '%s' "$3" | INSTALL_INTERACTIVE="$1" INSTALLED_AFTER="$2" COUNT="$SCRATCH/count-$RANDOM" bash -c '
    LOG_FILE=/dev/null; . "'"$REPO_ROOT"'/lib/common.sh"; . "'"$REPO_ROOT"'/lib/deps.sh"
    : > "$COUNT"
    dpkg() { echo x >> "$COUNT"; (( $(wc -l < "$COUNT") > INSTALLED_AFTER )); }
    can_sudo() { return 1; }
    sudo() { echo "SUDO-WAS-RUN $*"; }
    TARGET_OS=ubuntu; SYSTEM_PACKAGES=(rocm hipcc)
    ensure_system_deps
    echo "PKG_MISSING=${PKG_MISSING[*]:-none}"' 2>&1
}

echo "in a terminal, without passwordless sudo"
out="$(run_deps 1 2 $'\n')"
assert_ok "it prints the exact command to run elsewhere" grep -q 'sudo apt-get install -y --no-install-recommends rocm hipcc' <<< "$out"
assert_ok "...and waits for Enter"                        grep -q 'press Enter' <<< "$out"
assert_ok "once they are installed, it carries on"         grep -q 'System packages installed' <<< "$out"
assert_ok "...with nothing left missing"                   grep -q 'PKG_MISSING=none' <<< "$out"
assert_fails "it never runs sudo itself"                   grep -q 'SUDO-WAS-RUN' <<< "$out"

out="$(run_deps 1 4 $'\n\n')"
assert_ok "Enter too early: it says what is still missing and waits again" \
  grep -q 'Still missing: rocm hipcc' <<< "$out"
assert_ok "...then carries on"                             grep -q 'System packages installed' <<< "$out"

out="$(run_deps 1 99 $'s\n')"
assert_ok "'s' skips, as unattended runs do"               grep -q 'Continuing with userspace fallbacks' <<< "$out"
assert_ok "...recording what was skipped"                  grep -q 'PKG_MISSING=rocm hipcc' <<< "$out"

echo
echo "unattended (dbench, CI, a pipe)"
out="$(run_deps 0 99 '')"
assert_fails "it does not wait"                            grep -q 'press Enter' <<< "$out"
assert_ok "it warns with the command and continues"        grep -q 'sudo apt-get install -y --no-install-recommends rocm hipcc' <<< "$out"
assert_ok "...recording what was skipped"                  grep -q 'PKG_MISSING=rocm hipcc' <<< "$out"

finish

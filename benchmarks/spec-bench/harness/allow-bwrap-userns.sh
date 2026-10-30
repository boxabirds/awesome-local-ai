#!/usr/bin/env bash
# allow-bwrap-userns.sh -- let bubblewrap set up the agent sandbox's network namespace on Ubuntu 24.04 and newer.
#
#   sudo bash benchmarks/spec-bench/harness/allow-bwrap-userns.sh     (asks for sudo itself if run without)
#
# Ubuntu 24.04 turns on kernel.apparmor_restrict_unprivileged_userns: an unprivileged program gets a user namespace
# without the right to configure anything in it, so bwrap stops with "bwrap: loopback: Failed RTM_NEWADDR: Operation
# not permitted" and the sandbox (tools/agent-sandbox) cannot start. This installs an AppArmor profile that gives that
# right to the bwrap binary alone, which is narrower than turning the restriction off for every program.
#
# Safe to re-run: it does nothing where bwrap already works, never touches a profile another package wrote for
# bwrap, writes the profile atomically, puts the previous one back if the new one will not load, and proves the
# result as the user who ran it. The profile lives in /etc/apparmor.d, so AppArmor loads it again at every boot;
# setup-node.sh re-checks bwrap on each run, so an upgrade that undoes it is caught before a benchmark starts.
set -uo pipefail

APPARMOR_D="${APPARMOR_D:-/etc/apparmor.d}"
USERNS_SYSCTL="${USERNS_SYSCTL:-/proc/sys/kernel/apparmor_restrict_unprivileged_userns}"
APPARMOR_PARSER="${APPARMOR_PARSER:-$(command -v apparmor_parser || echo /sbin/apparmor_parser)}"
SUDO="${SUDO:-sudo}"
PROFILE_NAME="bwrap"
PROFILE="$APPARMOR_D/$PROFILE_NAME"

say() { echo "allow-bwrap-userns: $*"; }
die() { say "$*" >&2; exit 1; }

# The same namespaces the sandbox asks for; prints bwrap's error and fails if it cannot.
bwrap_net_ok() { "$BWRAP" --unshare-net --dev-bind / / true; }

[[ "$(uname)" == Linux ]] || { say "not Linux: nothing to do"; exit 0; }
BWRAP="${BWRAP:-$(command -v bwrap)}"
[[ -n "$BWRAP" && -x "$BWRAP" ]] || die "bwrap is not installed (sudo apt install -y bubblewrap)"
# A profile attaches to a path, and AppArmor sees the real one.
BWRAP_REAL="$(readlink -f "$BWRAP")"

if [[ "$(id -u)" != 0 ]]; then
  if err="$(bwrap_net_ok 2>&1)"; then say "bwrap can already create its network namespace: nothing to do"; exit 0; fi
  if [[ "$(cat "$USERNS_SYSCTL" 2>/dev/null)" != 1 ]]; then
    echo "$err" >&2
    die "AppArmor's user-namespace restriction is off here, so it is not the cause of bwrap's error above"
  fi
  command -v "$SUDO" >/dev/null || die "this needs root and there is no sudo: run it as root"
  say "bwrap failed ($err); installing an AppArmor profile for $BWRAP_REAL needs root"
  exec "$SUDO" -- env APPARMOR_D="$APPARMOR_D" USERNS_SYSCTL="$USERNS_SYSCTL" BWRAP="$BWRAP" bash "${BASH_SOURCE[0]}" "$@"
fi

# ---- as root ------------------------------------------------------------------------------------------------------
[[ -x "$APPARMOR_PARSER" ]] || die "apparmor_parser not found ($APPARMOR_PARSER): is AppArmor installed? (apt install apparmor)"
[[ -d "$APPARMOR_D" ]] || die "no $APPARMOR_D: is AppArmor installed?"

# Proved as the person who ran sudo: root is not restricted, so a check as root proves nothing.
as_user() { if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]]; then "$SUDO" -u "$SUDO_USER" -- "$@"; else "$SUDO" -u nobody -- "$@"; fi; }

if err="$(as_user "$BWRAP" --unshare-net --dev-bind / / true 2>&1)"; then
  say "bwrap can already create its network namespace: nothing to do"; exit 0
fi
[[ "$(cat "$USERNS_SYSCTL" 2>/dev/null)" == 1 ]] || {
  echo "$err" >&2; die "AppArmor's user-namespace restriction is off here, so it is not the cause of bwrap's error above"; }

# Another package's profile for the same binary (Ubuntu ships some for bwrap) would conflict with this one.
other="$(grep -lE "^[[:space:]]*profile[[:space:]]+[^[:space:]]+[[:space:]]+$BWRAP_REAL([[:space:]]|$)" "$APPARMOR_D"/* 2>/dev/null \
  | grep -vxF "$PROFILE" || true)"
[[ -z "$other" ]] || die "another AppArmor profile already attaches to $BWRAP_REAL ($other); not adding a second. Check why it denies user namespaces."

tmp="$(mktemp "$APPARMOR_D/.$PROFILE_NAME.XXXXXX")" || die "cannot write in $APPARMOR_D"
backup=""
cleanup() { rm -f "$tmp"; [[ -z "$backup" ]] || rm -f "$backup"; }
trap cleanup EXIT
cat > "$tmp" <<EOF
abi <abi/4.0>,
include <tunables/global>

profile $PROFILE_NAME $BWRAP_REAL flags=(unconfined) {
  userns,
  include if exists <local/$PROFILE_NAME>
}
EOF
chmod 644 "$tmp"
if [[ -e "$PROFILE" ]]; then backup="$(mktemp "$APPARMOR_D/.$PROFILE_NAME.prev.XXXXXX")"; cp -p "$PROFILE" "$backup"; fi
mv -f "$tmp" "$PROFILE"

if ! "$APPARMOR_PARSER" -r "$PROFILE"; then
  if [[ -n "$backup" ]]; then mv -f "$backup" "$PROFILE"; backup=""; "$APPARMOR_PARSER" -r "$PROFILE" 2>/dev/null
  else rm -f "$PROFILE"; fi
  die "apparmor_parser could not load the profile; the previous state is restored"
fi

if err="$(as_user "$BWRAP" --unshare-net --dev-bind / / true 2>&1)"; then
  say "installed $PROFILE: bwrap can now create its network namespace (AppArmor reloads it at boot)"
else
  echo "$err" >&2
  die "the profile loaded but bwrap still fails; $PROFILE is left in place for inspection"
fi

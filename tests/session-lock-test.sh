#!/usr/bin/env bash
# local-ai-session serialises startup with a lock so two simultaneous launches
# cannot both start a server. It used flock(1), which is util-linux: macOS has
# none, so on a Mac every `./start.sh pi` / `--opencode` / `--server-only` died
# with "flock: command not found" before reaching the server or the client.
#
# Drives the real session.sh with a stub client whose install step runs while
# the startup lock is held: it logs start/end and exits. Two concurrent launches
# must get through, and must not overlap.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

HOLD_S=2   # how long each launch holds the lock; long enough that an unlocked pair overlaps

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAKE_HOME="$WORK/home"
ID="lock-test"
REL=".local/share/$ID"
mkdir -p "$FAKE_HOME/$REL"
cat > "$FAKE_HOME/$REL/install.env" <<ENV
INSTALL_ID="$ID"
COMBINATION="test/lock"
CLIENT="probe"
DEFAULT_PORT="18999"
DEFAULT_PROFILE="coding"
MODEL_ALIAS_DEFAULT="m"
DEFAULT_PROVIDER="p"
SERVER_CMD="$ID-server"
ENV
cat > "$FAKE_HOME/$REL/client-probe.sh" <<'CLIENT'
CLIENT_DISPLAY_NAME="Probe"
client_ensure_installed() {       # runs with the startup lock held
  echo "$PROBE_TAG start" >> "$PROBE_LOG"
  sleep "$PROBE_HOLD_S"
  echo "$PROBE_TAG end" >> "$PROBE_LOG"
  exit 0
}
client_write_config() { :; }
client_matches_pid() { return 1; }
client_exec() { exit 0; }
CLIENT

# A PATH with everything in /usr/bin and /bin except flock, so the fallback is
# exercised even where flock is installed.
NOFLOCK="$WORK/noflock-bin"
mkdir -p "$NOFLOCK"
for f in /usr/bin/* /bin/*; do
  n="$(basename "$f")"
  # -L too: on usrmerge systems /bin is /usr/bin, and -e is false for a dangling link.
  [[ "$n" == flock || -e "$NOFLOCK/$n" || -L "$NOFLOCK/$n" ]] || ln -s "$f" "$NOFLOCK/$n"
done

launch() { # path tag log
  env -i HOME="$FAKE_HOME" PATH="$1" LOCAL_AI_INSTALL_REL="$REL" \
    PROBE_TAG="$2" PROBE_LOG="$3" PROBE_HOLD_S="$HOLD_S" \
    bash "$REPO_ROOT/lib/runtime/session.sh" >"$3.$2.out" 2>&1
}

check_mode() { # label path
  local label="$1" path="$2" log="$WORK/$1.log" ra rb
  : > "$log"
  launch "$path" A "$log" & local pa=$!
  launch "$path" B "$log" & local pb=$!
  wait "$pa"; ra=$?; wait "$pb"; rb=$?
  assert_eq "$label: both launches get past the lock" "0 0" "$ra $rb"
  local out; out="$(cat "$log".*.out)"
  assert_eq "$label: no missing-command error" "" "$(grep -o 'command not found.*' <<<"$out")"
  # Serialised means each start is followed by its own end: A A B B or B B A A.
  local order; order="$(awk '{printf "%s%s ", $1, substr($2,1,1)}' "$log")"
  case "$order" in
    "As Ae Bs Be "|"Bs Be As Ae ") _pass "$label: launches do not overlap ($order)" ;;
    *) _fail "$label: launches do not overlap" "As Ae Bs Be (or B first)" "$order" ;;
  esac
}

check_mode "without flock" "$NOFLOCK"
if command -v flock >/dev/null 2>&1; then
  check_mode "with flock" "/usr/bin:/bin:$(dirname "$(command -v flock)")"
else
  echo "  --   with flock: not installed here, skipped"
fi

finish

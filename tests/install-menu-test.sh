#!/usr/bin/env bash
# The install menu says, for every combination, whether it can be launched on this machine now:
#   launchable | installed, <what is missing> | not installed
# A person reads it to decide between installing and just starting something.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
cd "$REPO_ROOT"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAKE_HOME="$WORK/home"
COMBO="qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi"
OTHER="qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi"
ID="fake-gufo"
mkdir -p "$FAKE_HOME/.local/share/$ID/model" "$FAKE_HOME/.local/bin"
echo x > "$FAKE_HOME/.local/share/$ID/model/test.gguf"
for c in "${ID}-server" "${ID}-pi" local-ai-gufo-server; do : > "$FAKE_HOME/.local/bin/$c"; chmod +x "$FAKE_HOME/.local/bin/$c"; done
cat > "$FAKE_HOME/.local/share/$ID/install.env" <<EOF
INSTALL_ID="$ID"
COMBINATION="$COMBO"
DISPLAY_NAME="Fake gufo"
BACKEND="gufo"
MODEL_SUBDIR="model"
MODEL_FILE="test.gguf"
MODEL_CACHE_ENV_VAR=""
SERVER_CMD="${ID}-server"
SESSION_CMD="${ID}-pi"
CLIENT="pi"
EOF

# shellcheck source=../lib/select.sh
. "$REPO_ROOT/lib/select.sh"
status() { HOME="$FAKE_HOME" REPO_ROOT="$REPO_ROOT" combo_launch_status "$1"; }

echo "combo_launch_status"
assert_eq "an installed, complete combination is launchable" "launchable"       "$(status "$COMBO")"
assert_eq "a combination nothing was installed for"          "not installed"    "$(status "$OTHER")"
rm -f "$FAKE_HOME/.local/share/$ID/model/test.gguf"
assert_eq "installed but the weights are gone"               "installed, weights missing" "$(status "$COMBO")"
echo x > "$FAKE_HOME/.local/share/$ID/model/test.gguf"
rm -f "$FAKE_HOME/.local/bin/${ID}-pi"
assert_eq "installed but a command is gone"                  "installed, command ${ID}-pi missing" "$(status "$COMBO")"
: > "$FAKE_HOME/.local/bin/${ID}-pi"; chmod +x "$FAKE_HOME/.local/bin/${ID}-pi"

echo
echo "the menu shows it on every row"
# The menu only appears on a terminal, so run install.sh under a pty and type the answers given in $1 (one per line).
menu_session() {
  HOME="$FAKE_HOME" ANSWERS="$1" python3 -I - "$REPO_ROOT/install.sh" <<'PY'
import os, pty, sys
chunks, answers = [], os.environ["ANSWERS"].encode().replace(b"\\n", b"\n")
def master_read(fd):
    data = os.read(fd, 4096)
    chunks.append(data)
    return data
def stdin_read(fd):
    return answers
pty.spawn(["bash", sys.argv[1]], master_read, stdin_read)
sys.stdout.write(b"".join(chunks).decode("utf-8", "replace"))
PY
}
out="$(menu_session 'q\n')"
row() { printf '%s\n' "$out" | tr -d '\r' | grep -F "$1" | head -1; }
assert_ok "the installed combination's row says launchable"  grep -q "launchable" <<< "$(row "$COMBO")"
assert_ok "an uninstalled combination's row says not installed" grep -q "not installed" <<< "$(row "$OTHER")"
assert_ok "the fit note is still there (best fit / compatible / why not)" grep -qE "best fit|compatible|needs|won't fit" <<< "$(row "$OTHER")"


echo
echo "picking something already launchable leads to starting it"
number="$(printf '%s\n' "$out" | tr -d '\r' | grep -F "$COMBO" | head -1 | sed -E 's/^ *([0-9]+)\).*/\1/')"
started="$(menu_session "${number}\\ny\\n")"
assert_ok    "it says the pick is installed and launchable"  grep -q "is installed and launchable" <<< "$started"
assert_ok    "...and shows the command, with the context sizes" grep -q -- "--context 192k --server" <<< "$started"
assert_fails "...and does not run the installer"            grep -q "Installer ./install-" <<< "$started"

finish

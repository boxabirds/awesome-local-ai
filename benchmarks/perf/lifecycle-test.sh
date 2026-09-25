#!/usr/bin/env bash
# Regression test for the on-demand server lifecycle (local-ai-session).
#
# Asserts the two properties that matter and are easy to break:
#   * a live client HOLDS the server up past the idle timeout
#   * the server shuts down promptly once the last client exits
#
# Uses a fake client process named so client_matches_pid() recognises it, which
# keeps the test to one model load instead of driving a real TUI.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

export IDLE_TIMEOUT=${IDLE_TIMEOUT:-45} POLL_INTERVAL=${POLL_INTERVAL:-5}
PORT=${PORT:-8080}
CL="${XDG_STATE_HOME:-$HOME/.local/state}/$INSTALL_ID/clients"
HEALTH="http://127.0.0.1:${PORT}/health"
up() { curl -sf --max-time 2 "$HEALTH" >/dev/null 2>&1; }

echo "1) start server-only"
"$SESSION_CMD" --server-only >/dev/null 2>&1
echo "   up: $(up && echo yes || echo no)"

echo "2) register a fake ${CLIENT} client (lives 100s)"
setsid bash -c "exec -a ${CLIENT}-fakeclient sleep 100" &
FAKE=$!
sleep 1
touch "$CL/$FAKE"
echo "   client pid $FAKE, cmdline: $(tr '\0' ' ' < "/proc/$FAKE/cmdline")"
echo "   status clients: $("$SESSION_CMD" --status | grep clients)"

echo "3) wait 70s (> ${IDLE_TIMEOUT}s idle timeout) -- server must STAY UP because client is alive"
sleep 70
if up; then
  echo "   PASS: server still up at 70s with a live client"
else
  echo "   FAIL: server died despite live client"; exit 1
fi

echo "4) kill the client, expect shutdown ~${IDLE_TIMEOUT}s later"
kill $FAKE 2>/dev/null
T0=$(date +%s)
while up; do
  (( $(date +%s) - T0 > 150 )) && { echo "   FAIL: no shutdown after 150s"; exit 1; }
  sleep 3
done
echo "   PASS: server shut down $(( $(date +%s) - T0 ))s after client exit"
echo "ALLDONE"

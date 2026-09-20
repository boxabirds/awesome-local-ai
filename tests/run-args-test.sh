#!/usr/bin/env bash
# run.sh argument handling: do --host/--port/--max (and the HOST/PORT/
# SPEC_DRAFT_N_MAX env vars) actually reach the server launcher? Guards the
# "broadcast over the local network" path -- the thing people try --host for
# and find does nothing.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
cd "$REPO_ROOT"

# A throwaway HOME with one fake install. The "server command" is a stub that
# prints the HOST/PORT/MAX it was given, so we can assert on what run.sh handed
# it.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAKE_HOME="$WORK/home"
ID="test-id"
mkdir -p "$FAKE_HOME/.local/share/$ID/model" "$FAKE_HOME/.local/bin"
echo x > "$FAKE_HOME/.local/share/$ID/model/test.gguf"
cat > "$FAKE_HOME/.local/bin/${ID}-server" <<'EOF'
#!/usr/bin/env bash
echo "HOST=${HOST:-<unset>} PORT=${PORT:-<unset>} MAX=${SPEC_DRAFT_N_MAX:-<unset>}"
EOF
chmod +x "$FAKE_HOME/.local/bin/${ID}-server"
: > "$FAKE_HOME/.local/bin/${ID}-opencode"; chmod +x "$FAKE_HOME/.local/bin/${ID}-opencode"
: > "$FAKE_HOME/.local/bin/local-ai-llamacpp-server"; chmod +x "$FAKE_HOME/.local/bin/local-ai-llamacpp-server"
cat > "$FAKE_HOME/.local/share/$ID/install.env" <<EOF
INSTALL_ID="$ID"
COMBINATION="test/combo"
DISPLAY_NAME="Test Combo"
BACKEND="llamacpp"
ACCEL="cuda"
ROOT_ENV_VAR=""
MODEL_SUBDIR="model"
MODEL_FILE="test.gguf"
MODEL_CACHE_ENV_VAR=""
SERVER_CMD="${ID}-server"
SESSION_CMD="${ID}-opencode"
CLIENT="opencode"
DEFAULT_PORT="8080"
EOF

# Run run.sh in a clean environment (env -i) so nothing leaks in from the
# test process. host/port args may be empty to mean "not set". Everything after
# the two is passed to run.sh. Only the server stub's stdout is returned.
run_clean() {
  local h="${1:-}" p="${2:-}" e=()
  [[ -n "$h" ]] && e+=(HOST="$h")
  [[ -n "$p" ]] && e+=(PORT="$p")
  shift 2
  env -i HOME="$FAKE_HOME" PATH="$FAKE_HOME/.local/bin:/usr/bin:/bin" \
    "${e[@]+"${e[@]}"}" bash "$REPO_ROOT/run.sh" "$@" 2>/dev/null
}

echo "flags and env reach the server launcher"
assert_eq "--host and --port flags are forwarded"   "HOST=0.0.0.0 PORT=9999 MAX=<unset>"    "$(run_clean "" "" --host 0.0.0.0 --port 9999)"
assert_eq "HOST env var is forwarded"               "HOST=1.2.3.4 PORT=<unset> MAX=<unset>" "$(run_clean 1.2.3.4 "")"
assert_eq "PORT env var is forwarded"               "HOST=<unset> PORT=9100 MAX=<unset>"    "$(run_clean "" 9100)"
assert_eq "a flag wins over an inherited env var"   "HOST=0.0.0.0 PORT=<unset> MAX=<unset>" "$(run_clean 1.2.3.4 "" --host 0.0.0.0)"
assert_eq "--max flag is forwarded to the launcher" "HOST=<unset> PORT=<unset> MAX=3"       "$(run_clean "" "" --max 3)"

echo
echo "malformed / unknown options are rejected"
assert_fails "--host with no address exits non-zero"    run_clean "" "" --host
assert_fails "--port with no number exits non-zero"     run_clean "" "" --port
assert_fails "--max with no number exits non-zero"      run_clean "" "" --max
assert_fails "--max with a non-integer exits non-zero"  run_clean "" "" --max abc
assert_fails "--max with zero exits non-zero"           run_clean "" "" --max 0
assert_fails "an unknown option still exits non-zero"   run_clean "" "" --bogus

finish

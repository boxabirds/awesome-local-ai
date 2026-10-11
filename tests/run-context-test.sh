#!/usr/bin/env bash
# run.sh --context, selecting an install by its model name, and --health.
#
#   ./run.sh qwen3.8-flash-next-gufo --context 192k --server
#
# must reach the server launcher as CTX=196608 on the port that size is served on, and tell the launcher
# which ports are interactive so it may replace a server there (and only there: a benchmark's server is never
# on one of them). The launcher here is a stub that prints what it was given.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
cd "$REPO_ROOT"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAKE_HOME="$WORK/home"
ALIAS="test-model-alias"
mkdir -p "$FAKE_HOME/.local/bin"

# A fake install. $1 id, $2 client, $3 model alias. The server stub prints what the launcher would read.
make_install() {
  local id="$1" client="$2" alias="$3"
  mkdir -p "$FAKE_HOME/.local/share/$id/model"
  echo x > "$FAKE_HOME/.local/share/$id/model/test.gguf"
  cat > "$FAKE_HOME/.local/bin/${id}-server" <<EOF
#!/usr/bin/env bash
echo "ID=$id CTX=\${CTX:-<unset>} PORT=\${PORT:-<unset>} REPLACE=\${LOCAL_AI_REPLACE_PORTS:-<unset>}"
EOF
  chmod +x "$FAKE_HOME/.local/bin/${id}-server"
  printf '#!/usr/bin/env bash\necho "SESSION=%s"\n' "$id" > "$FAKE_HOME/.local/bin/${id}-${client}"; chmod +x "$FAKE_HOME/.local/bin/${id}-${client}"
  : > "$FAKE_HOME/.local/bin/local-ai-gufo-server"; chmod +x "$FAKE_HOME/.local/bin/local-ai-gufo-server"
  cat > "$FAKE_HOME/.local/share/$id/install.env" <<EOF
INSTALL_ID="$id"
COMBINATION="test/combo-$id"
DISPLAY_NAME="Test $id"
BACKEND="gufo"
MODEL_SUBDIR="model"
MODEL_FILE="test.gguf"
MODEL_CACHE_ENV_VAR=""
MODEL_ALIAS_DEFAULT="$alias"
SERVER_CMD="${id}-server"
SESSION_CMD="${id}-${client}"
CLIENT="$client"
DEFAULT_PORT="8080"
EOF
}
make_install "test-gufo" pi "$ALIAS"
make_install "test-gufo-oc" opencode "$ALIAS"

run_clean() { # env -i so nothing leaks in; extra env as NAME=value words before a literal --
  local e=()
  while [[ "${1:-}" != "--" ]]; do e+=("$1"); shift; done; shift
  env -i HOME="$FAKE_HOME" PATH="$FAKE_HOME/.local/bin:/usr/bin:/bin" "${e[@]+"${e[@]}"}" \
    bash "$REPO_ROOT/run.sh" "$@" 2>"$WORK/err"
}
SERVER_PORTS="8080 8192 8256"

echo "--context sets the window, the port that size is served on, and the ports a launcher may replace on"
assert_eq "128k"                    "ID=test-gufo CTX=131072 PORT=8080 REPLACE=$SERVER_PORTS" "$(run_clean -- "$ALIAS" --context 128k --server)"
assert_eq "192k"                    "ID=test-gufo CTX=196608 PORT=8192 REPLACE=$SERVER_PORTS" "$(run_clean -- "$ALIAS" --context 192k --server)"
assert_eq "256k"                    "ID=test-gufo CTX=262144 PORT=8256 REPLACE=$SERVER_PORTS" "$(run_clean -- "$ALIAS" --context 256k --server)"
assert_eq "--server is the default" "ID=test-gufo CTX=196608 PORT=8192 REPLACE=$SERVER_PORTS" "$(run_clean -- "$ALIAS" --context 192k)"
assert_eq "--port wins over the size's port" "ID=test-gufo CTX=196608 PORT=9000 REPLACE=$SERVER_PORTS" "$(run_clean -- "$ALIAS" --context 192k --port 9000)"
assert_eq "PORT in the environment wins too" "ID=test-gufo CTX=196608 PORT=9100 REPLACE=$SERVER_PORTS" "$(run_clean PORT=9100 -- "$ALIAS" --context 192k)"
assert_eq "--context wins over an inherited CTX" "ID=test-gufo CTX=196608 PORT=8192 REPLACE=$SERVER_PORTS" "$(run_clean CTX=65536 -- "$ALIAS" --context 192k)"
assert_eq "without --context nothing is set and nothing may be replaced" \
  "ID=test-gufo CTX=<unset> PORT=<unset> REPLACE=<unset>" "$(run_clean -- "$ALIAS" --server)"

echo
echo "--context accepts only 128k, 192k and 256k"
for bad in 160k 192 192K 0k 1m ""; do
  assert_fails "'$bad' is refused" run_clean -- "$ALIAS" --context "$bad"
done
assert_fails "--context with no size is refused" run_clean -- "$ALIAS" --context
run_clean -- "$ALIAS" --context 160k >/dev/null
assert_ok "...and the message names the three sizes" grep -q "128k, 192k or 256k" "$WORK/err"

echo
echo "an install is found by its model name"
assert_eq "the model name selects the install" "ID=test-gufo CTX=<unset> PORT=<unset> REPLACE=<unset>" "$(run_clean -- "$ALIAS" --server)"
assert_eq "installs that differ only by client: the server is the same, the first is used" \
  "test-gufo" "$(run_clean -- "$ALIAS" --server | sed -n 's/^ID=\([^ ]*\) .*/\1/p')"
assert_eq "an exact install id still wins over the model name" \
  "ID=test-gufo-oc CTX=<unset> PORT=<unset> REPLACE=<unset>" "$(run_clean -- test-gufo-oc --server)"
assert_fails "a model name nothing has is refused" run_clean -- no-such-model --server
assert_eq "with a client named, the install that has that client (opencode)" "SESSION=test-gufo-oc" "$(run_clean -- "$ALIAS" --opencode)"
assert_eq "...and the other client picks the other install (pi)"             "SESSION=test-gufo"    "$(run_clean -- "$ALIAS" pi)"

echo
echo "--health says whether an install can be launched"
assert_eq "complete install"      "ok"             "$(run_clean -- test-gufo --health)"
rm -f "$FAKE_HOME/.local/share/test-gufo/model/test.gguf"
assert_eq "weights gone"          "weights missing" "$(run_clean -- test-gufo --health)"
assert_eq "...and it still exits 0" "0"            "$(run_clean -- test-gufo --health >/dev/null; echo $?)"

finish

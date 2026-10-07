#!/usr/bin/env bash
# The gufo-fork launcher's reasoning-effort handling.
#
# The harness sets REASONING_EFFORT=low for every run (benchmarks/spec-bench/harness/run.sh: it defaults to
# "low" and exports it to the server). Qwen3.6-35B-A3B's template has NO reasoning-effort control, so the
# combination declares REASONING_EFFORTS="default" -- and the launcher refused to start, which on 7 Oct 2026
# killed all five runs of v2-q36fork before any story began: "REASONING_EFFORT='low' -- this model's template
# has no reasoning-effort control", twice per run, five runs, machine idle.
#
# A combination that cannot vary effort must IGNORE the harness's value and say so, not refuse. Refusing costs
# runs; ignoring costs a line in the log. The distinction matters: a model that DOES support efforts must still
# refuse one it does not know, because there the value changes the run.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"

LAUNCHER="$REPO_ROOT/lib/runtime/server-gufo-fork-ninjapear.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$LOG_FILE"' EXIT

# A throwaway install: a manifest, a profile table, a stub engine that prints its argv and exits.
FAKE_HOME="$WORK/home"
ID="test-q36"
ROOT="$FAKE_HOME/.local/share/$ID"
mkdir -p "$ROOT/engine" "$ROOT/models/qwen3.6"
printf 'x' > "$ROOT/models/qwen3.6/model.gguf"
cat > "$ROOT/engine/gufo" <<'EOF'
#!/usr/bin/env bash
echo "ARGV: $*"
EOF
chmod +x "$ROOT/engine/gufo"
echo "d7e938e4bf00c64abef2b0794ccac1ae0e170593" > "$ROOT/engine/COMMIT"
cat > "$ROOT/profiles.tsv" <<'EOF'
coding|131072|2|7|512|35285|MEASURED|default
EOF
write_manifest() { # <reasoning_efforts>
  cat > "$ROOT/install.env" <<EOF
INSTALL_ID="$ID"
COMBINATION="test/q36"
DISPLAY_NAME="Test Q36"
BACKEND="gufo-fork-ninjapear"
ACCEL="strix-halo"
ROOT_ENV_VAR=""
MODEL_SUBDIR=".local/share/$ID/models"
MODEL_FILE="qwen3.6"
MODEL_CACHE_ENV_VAR=""
MODEL_ALIAS_DEFAULT="qwen3.6-35b-a3b"
DEFAULT_PROFILE="coding"
DEFAULT_PORT="18099"
SERVER_CMD="${ID}-server"
SESSION_CMD="${ID}-pi"
CLIENT="pi"
REASONING_EFFORT_DEFAULT="default"
REASONING_EFFORTS="$1"
SAMPLING_THINKING=""
GUFO_FORK_COMMIT="d7e938e4bf00c64abef2b0794ccac1ae0e170593"
GUFO_FORK_BIN_REL="engine/gufo"
GUFO_FORK_CPATH_REL="include"
GUFO_MODEL_REL="model.gguf"
GUFO_FORK_BASE_ARGS=""
GUFO_FORK_SAMPLING_INSTRUCT=""
EOF
}

# Run the launcher with ALLOW_COEXIST=1 (this machine may be serving something) and a free port.
launch() { # <reasoning_effort> -> combined output; exit code in $?
  env -i HOME="$FAKE_HOME" PATH="/usr/bin:/bin" \
    LOCAL_AI_INSTALL_REL=".local/share/$ID" ALLOW_COEXIST=1 PORT=18099 \
    REASONING_EFFORT="$1" bash "$LAUNCHER" 2>&1
}

echo "the launcher exists and parses"
assert_ok "it is there" test -f "$LAUNCHER"
assert_ok "it parses"   bash -n "$LAUNCHER"

echo
echo "a model with no effort control ignores the harness's effort instead of refusing"
write_manifest "default"
out="$(launch low)"; rc=$?
assert_eq  "it starts (exit 0), it does not refuse" "0" "$rc"
assert_ok  "it reached the engine"                  bash -c "[[ \"\$1\" == *ARGV:* ]]" _ "$out"
assert_ok  "it says the effort is ignored"          bash -c "[[ \"\$1\" == *ignor* ]]" _ "$out"
assert_ok  "it names the effort it ignored"         bash -c "[[ \"\$1\" == *low* ]]" _ "$out"
assert_ok  "and passes no --reasoning-effort"       bash -c "[[ \"\$1\" != *--reasoning-effort* ]]" _ "$out"

echo
echo "...and 'default' is silent, since there is nothing to ignore"
out="$(launch default)"
assert_ok  "it starts"               bash -c "[[ \"\$1\" == *ARGV:* ]]" _ "$out"
assert_ok  "no ignore note"          bash -c "[[ \"\$1\" != *ignor* ]]" _ "$out"

echo
echo "a model that DOES support efforts still refuses one it does not know: there the value changes the run"
write_manifest "default low medium high"
out="$(launch nonsense)"; rc=$?
assert_eq  "it refuses"              "1" "$rc"
assert_ok  "it says what is allowed" bash -c "[[ \"\$1\" == *medium* ]]" _ "$out"
out="$(launch medium)"
assert_ok  "a known effort starts"   bash -c "[[ \"\$1\" == *ARGV:* ]]" _ "$out"

echo
echo "the engine must be the commit the manifest pins"
write_manifest "default"
echo "0000000000000000000000000000000000000000" > "$ROOT/engine/COMMIT"
out="$(launch default)"; rc=$?
assert_eq  "a different build is refused" "1" "$rc"
assert_ok  "it names both commits"        bash -c "[[ \"\$1\" == *0000000* && \"\$1\" == *d7e938e* ]]" _ "$out"
echo "d7e938e4bf00c64abef2b0794ccac1ae0e170593" > "$ROOT/engine/COMMIT"

finish

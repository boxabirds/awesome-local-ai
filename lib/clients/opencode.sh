#!/usr/bin/env bash
# lib/clients/opencode.sh -- OpenCode (https://opencode.ai) client adapter.
#
# Sourced by lib/runtime/session.sh at run time (installed as $ROOT/client.sh)
# and by the installer when it prints setup hints. Everything OpenCode-specific
# lives here; the lifecycle around it is shared.
#
# Contract -- a client adapter must define:
#   CLIENT_DISPLAY_NAME       name shown in messages
#   client_ensure_installed   fail with an install hint if the binary is absent
#   client_write_config       add the provider config (merging into any existing one)
#   client_matches_pid        does this pid look like the client?
#   client_exec               exec the client against the local server

CLIENT_DISPLAY_NAME="OpenCode"

_oc_config() { printf '%s/opencode/opencode.json' "${XDG_CONFIG_HOME:-$HOME/.config}"; }

client_ensure_installed() {
  command -v opencode >/dev/null 2>&1 || {
    echo "opencode not found. Install with: npm install -g opencode-ai" >&2; exit 1; }
}

# The provider block this install needs, on its own, so it can be written into
# a fresh config or merged into one the user already has.
_oc_provider_block() {
  cat <<JSON
{
  "npm": "@ai-sdk/openai-compatible",
  "name": "${DISPLAY_NAME} (local)",
  "options": {
    "baseURL": "http://127.0.0.1:${PORT}/v1",
    "apiKey": "local"
  },
  "models": {
    "${MODEL_ID}": {
      "name": "${DISPLAY_NAME} (local)",
      "limit": { "context": ${CONTEXT_LIMIT}, "output": ${OUTPUT_LIMIT} }
    }
  }
}
JSON
}

# Merge, rather than replace or skip. Skipping was the old behaviour and it
# fails badly: OpenCode is then launched with --model <provider>/<model> for a
# provider its config does not define, and reports only
# "UnknownError: Unexpected server error" -- which points at the model server,
# the one thing that is working.
_oc_merge_script() {
  cat <<'PY'
import json, os, shutil, sys

cfg   = os.environ["OC_CFG"]
name  = os.environ["OC_PROVIDER"]
block = json.loads(os.environ["OC_BLOCK"])

try:
    with open(cfg) as f:
        doc = json.load(f)
except Exception as e:
    sys.stderr.write("%s\n" % e)
    sys.exit(2)

if not isinstance(doc, dict):
    sys.stderr.write("top level is not an object\n")
    sys.exit(2)

providers = doc.get("provider")
if providers is None:
    providers = {}
    doc["provider"] = providers
if not isinstance(providers, dict):
    sys.stderr.write('"provider" is not an object\n')
    sys.exit(2)

# Already configured -- possibly hand-edited. Leave it exactly as it is.
if name in providers:
    sys.exit(3)

shutil.copy2(cfg, cfg + ".bak")
providers[name] = block
doc.setdefault("$schema", "https://opencode.ai/config.json")
with open(cfg, "w") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
sys.exit(0)
PY
}

client_write_config() {
  local cfg; cfg="$(_oc_config)"
  mkdir -p "$(dirname "$cfg")"

  if [[ ! -f "$cfg" ]]; then
    echo "Writing OpenCode provider config to $cfg" >&2
    cat > "$cfg" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "${PROVIDER}": $(_oc_provider_block)
  }
}
JSON
    return 0
  fi

  # A config already exists and may point at providers we know nothing about,
  # so never overwrite it -- add to it, keeping a .bak of what was there.
  local rc=0
  if command -v python3 >/dev/null 2>&1; then
    OC_CFG="$cfg" OC_PROVIDER="$PROVIDER" OC_BLOCK="$(_oc_provider_block)" \
      python3 -c "$(_oc_merge_script)" 2>/dev/null || rc=$?
  else
    rc=2
  fi

  case "$rc" in
    0) echo "Added the '${PROVIDER}' provider to $cfg (previous version: ${cfg}.bak)" >&2 ;;
    3) : ;;   # already present, nothing to do
    *)
      # Could not read or rewrite it. Say so loudly and print exactly what to
      # add: a silent skip here surfaces later as an unexplained OpenCode error.
      echo "" >&2
      echo "WARNING: could not add the '${PROVIDER}' provider to" >&2
      echo "  $cfg" >&2
      echo "OpenCode will fail with an unhelpful error until it is there." >&2
      echo "Add this inside the top-level \"provider\" object:" >&2
      echo "" >&2
      echo "  \"${PROVIDER}\": $(_oc_provider_block | sed 's/^/  /')" >&2
      echo "" >&2
      ;;
  esac
  return 0
}

client_matches_pid() {
  local pid="$1"
  if [[ -r "/proc/$pid/cmdline" ]]; then
    grep -qa opencode "/proc/$pid/cmdline"
  else
    ps -o command= -p "$pid" 2>/dev/null | grep -q opencode
  fi
}

client_exec() { exec opencode --model "${PROVIDER}/${MODEL_ID}" "$@"; }

# Printed by the installer so the summary can tell the user how to connect by
# hand if they prefer not to use the session wrapper.
client_manual_hint() {
  cat <<HINT
  Config file  ${XDG_CONFIG_HOME:-\$HOME/.config}/opencode/opencode.json
  Provider     ${1}
  Model key    ${2}   (must match what /v1/models returns)
HINT
}

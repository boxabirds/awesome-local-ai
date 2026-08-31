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
#   client_write_config       write the provider config (never clobber an existing one)
#   client_matches_pid        does this pid look like the client?
#   client_exec               exec the client against the local server

CLIENT_DISPLAY_NAME="OpenCode"

_oc_config() { printf '%s/opencode/opencode.json' "${XDG_CONFIG_HOME:-$HOME/.config}"; }

client_ensure_installed() {
  command -v opencode >/dev/null 2>&1 || {
    echo "opencode not found. Install with: npm install -g opencode-ai" >&2; exit 1; }
}

client_write_config() {
  local cfg; cfg="$(_oc_config)"
  # Never overwrite a config the user already has -- theirs may point at other
  # providers we know nothing about.
  [[ -f "$cfg" ]] && return 0
  echo "Writing OpenCode provider config to $cfg" >&2
  mkdir -p "$(dirname "$cfg")"
  cat > "$cfg" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "${PROVIDER}": {
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
  }
}
JSON
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

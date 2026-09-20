#!/usr/bin/env bash
# lib/clients/pi.sh -- Pi (https://pi.dev, @earendil-works/pi-coding-agent)
# client adapter.
#
# Sourced by lib/runtime/session.sh at run time (installed as
# $ROOT/client-pi.sh) and by the installer when it prints setup hints.
# Everything Pi-specific lives here; the lifecycle around it is shared.
#
# Contract -- a client adapter must define:
#   CLIENT_DISPLAY_NAME       name shown in messages
#   client_ensure_installed   locate an existing pi (PATH, then the common
#                             global-npm dirs) or fail with an install hint
#   client_write_config       add the provider config (merging into any existing one)
#   client_matches_pid        does this pid look like the client?
#   client_exec               exec the located client against the local server

CLIENT_DISPLAY_NAME="Pi"

_pi_config() { printf '%s/.pi/agent/models.json' "${HOME}"; }

# Find an already-installed pi. Prefer what is on PATH (the user's active node
# -- the least surprising choice); if it is not there, look in the common
# global-npm locations so a pi that is installed but not on this shell's PATH is
# still used instead of prompting for a second, competing install. Prints the
# path of the first one found; returns 1 if none.
_pi_find() {
  local p c dflt
  if p="$(command -v pi 2>/dev/null)"; then
    printf '%s' "$p"; return 0
  fi
  # nvm: the node version set as the default, else any installed version.
  dflt=""
  if [[ -f "$HOME/.nvm/alias/default" ]]; then
    dflt="$(tr -d '[:space:]' < "$HOME/.nvm/alias/default")"
  fi
  case "$dflt" in
    v*)
      if [[ -x "$HOME/.nvm/versions/node/$dflt/bin/pi" ]]; then
        printf '%s' "$HOME/.nvm/versions/node/$dflt/bin/pi"; return 0
      fi ;;
  esac
  for c in "$HOME"/.nvm/versions/node/*/bin/pi; do
    if [[ -x "$c" ]]; then printf '%s' "$c"; return 0; fi
  done
  # asdf (shim first, then per-version installs)
  for c in "$HOME"/.asdf/shims/pi "$HOME"/.asdf/installs/nodejs/*/bin/pi; do
    if [[ -x "$c" ]]; then printf '%s' "$c"; return 0; fi
  done
  # fnm (default alias, then installations)
  for c in "$HOME"/.fnm/aliases/default/bin/pi \
           "$HOME"/.local/share/fnm/node-versions/*/installation/bin/pi; do
    if [[ -x "$c" ]]; then printf '%s' "$c"; return 0; fi
  done
  # volta
  if [[ -x "$HOME/.volta/bin/pi" ]]; then
    printf '%s' "$HOME/.volta/bin/pi"; return 0
  fi
  # homebrew / system
  for c in /opt/homebrew/bin/pi /usr/local/bin/pi /usr/bin/pi; do
    if [[ -x "$c" ]]; then printf '%s' "$c"; return 0; fi
  done
  # wherever the active npm's global prefix points
  if command -v npm >/dev/null 2>&1; then
    p="$(npm prefix -g 2>/dev/null)/bin/pi"
    if [[ -x "$p" ]]; then printf '%s' "$p"; return 0; fi
  fi
  return 1
}

client_ensure_installed() {
  local bin
  if bin="$(_pi_find)"; then
    PI_BIN="$bin"
    case ":${PATH}:" in
      *":$(dirname "$bin"):"*) ;;   # already reachable on PATH
      *)
        # Not on PATH: put its directory first so pi's own subprocesses resolve
        # their node runtime too, and say so (this is the "found an existing pi"
        # case rather than "you need to install pi").
        export PATH="$(dirname "$bin"):${PATH}"
        echo "Using existing pi at ${bin} (not on PATH)." >&2 ;;
    esac
    return 0
  fi
  echo "pi not found. Install with:" >&2
  echo "  npm install -g @earendil-works/pi-coding-agent" >&2
  exit 1
}

# The provider block this install needs, on its own, so it can be written into
# a fresh config or merged into one the user already has.
#
# The two compat flags are load-bearing. This llama.cpp server does not accept
# a "developer" role (it wants "system"), and it applies its own reasoning
# effort, so a "reasoning_effort" field in the request is not honoured. Without
# both, Pi sends a request the server rejects and the failure points at the one
# component that is working.
_pi_provider_block() {
  cat <<JSON
{
  "baseUrl": "http://127.0.0.1:${PORT}/v1",
  "api": "openai-completions",
  "apiKey": "local",
  "models": [
    {
      "id": "${MODEL_ID}",
      "name": "${DISPLAY_NAME} (local)",
      "input": ["text"],
      "contextWindow": ${CONTEXT_LIMIT},
      "maxTokens": ${OUTPUT_LIMIT},
      "reasoning": true,
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      }
    }
  ]
}
JSON
}

# Merge, rather than replace or skip. Skipping was the old behaviour and it
# fails badly: Pi is then launched with --model <provider>/<model> for a
# provider its config does not define. Pi's config uses a top-level "providers"
# object (note: plural, unlike OpenCode's "provider").
_pi_merge_script() {
  cat <<'PY'
import json, os, shutil, sys

cfg   = os.environ["PI_CFG"]
name  = os.environ["PI_PROVIDER"]
block = json.loads(os.environ["PI_BLOCK"])

try:
    with open(cfg) as f:
        doc = json.load(f)
except Exception as e:
    sys.stderr.write("%s\n" % e)
    sys.exit(2)

if not isinstance(doc, dict):
    sys.stderr.write("top level is not an object\n")
    sys.exit(2)

providers = doc.get("providers")
if providers is None:
    providers = {}
    doc["providers"] = providers
if not isinstance(providers, dict):
    sys.stderr.write('"providers" is not an object\n')
    sys.exit(2)

# Already configured -- possibly hand-edited. Leave it exactly as it is.
if name in providers:
    sys.exit(3)

shutil.copy2(cfg, cfg + ".bak")
providers[name] = block
with open(cfg, "w") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
sys.exit(0)
PY
}

client_write_config() {
  local cfg; cfg="$(_pi_config)"
  mkdir -p "$(dirname "$cfg")"

  if [[ ! -f "$cfg" ]]; then
    echo "Writing Pi provider config to $cfg" >&2
    cat > "$cfg" <<JSON
{
  "providers": {
    "${PROVIDER}": $(_pi_provider_block)
  }
}
JSON
    return 0
  fi

  # A config already exists and may point at providers we know nothing about,
  # so never overwrite it -- add to it, keeping a .bak of what was there.
  local rc=0
  if command -v python3 >/dev/null 2>&1; then
    PI_CFG="$cfg" PI_PROVIDER="$PROVIDER" PI_BLOCK="$(_pi_provider_block)" \
      python3 -c "$(_pi_merge_script)" 2>/dev/null || rc=$?
  else
    rc=2
  fi

  case "$rc" in
    0) echo "Added the '${PROVIDER}' provider to $cfg (previous version: ${cfg}.bak)" >&2 ;;
    3) : ;;   # already present, nothing to do
    *)
      # Could not read or rewrite it. Say so loudly and print exactly what to
      # add: a silent skip here surfaces later as an unexplained Pi error.
      echo "" >&2
      echo "WARNING: could not add the '${PROVIDER}' provider to" >&2
      echo "  $cfg" >&2
      echo "Pi will fail with an unhelpful error until it is there." >&2
      echo "Add this inside the top-level \"providers\" object:" >&2
      echo "" >&2
      echo "  \"${PROVIDER}\": $(_pi_provider_block | sed 's/^/  /')" >&2
      echo "" >&2
      ;;
  esac
  return 0
}

# The registered pid becomes pi after the session exec's into it. Pi rewrites
# its process title to exactly "pi" once running, and before that its command
# line carries the npm package path. Match those; do NOT match the bare
# substring "pi" (that would hit "strip", "pipe", "compile", ...).
client_matches_pid() {
  local pid="$1" cmd=""
  if [[ -r "/proc/$pid/cmdline" ]]; then
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
  else
    cmd="$(ps -o command= -p "$pid" 2>/dev/null)"
  fi
  # Drop the trailing space the null->space conversion leaves behind.
  cmd="${cmd%"${cmd##*[![:space:]]}"}"
  case "$cmd" in
    "pi")            return 0 ;;   # pi rewrites its process title to "pi"
    "pi "*)          return 0 ;;   # pi with arguments, before any title rewrite
    *pi-coding-agent*) return 0 ;; # the npm package path, during early startup
  esac
  return 1
}

client_exec() { exec "${PI_BIN}" --model "${PROVIDER}/${MODEL_ID}" "$@"; }

# Printed by the installer so the summary can tell the user how to connect by
# hand if they prefer not to use the session wrapper.
client_manual_hint() {
  cat <<HINT
  Config file  \$HOME/.pi/agent/models.json
  Provider     ${1}
  Model id     ${2}   (must match what /v1/models returns)
HINT
}

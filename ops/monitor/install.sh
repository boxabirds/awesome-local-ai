#!/usr/bin/env bash
# install.sh [detector|triage|all] [--print] -- LaunchAgents for the monitor on this Mac.
#
#   detector  com.awesome-local-ai.monitor-detector   ops/monitor/monitor.py every TICK_S (no LLM, read-only)
#   triage    com.awesome-local-ai.monitor-triage     ops/monitor/triage.py every TRIAGE_EVERY_S (runs `claude -p`)
#
# The plists are generated here and written to ~/Library/LaunchAgents; nothing machine-specific is in the repo.
# The intervals come from monitor.py, so there is one place to change them. `--print` shows a plist without
# installing it. Other agents under com.awesome-local-ai.* (dbench's) are not touched.
#
#   stop:    launchctl bootout gui/$(id -u)/com.awesome-local-ai.monitor-detector
#            launchctl bootout gui/$(id -u)/com.awesome-local-ai.monitor-triage
#   status:  cat ops/monitor-status.json
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WHAT="${1:-all}"; PRINT="${2:-}"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$REPO/ops/monitor-state"
PY="$(command -v python3)"
interval() { "$PY" -c "import sys; sys.path.insert(0, '$HERE'); import monitor; print(monitor.$1)"; }

# launchd starts with a bare PATH: give the agents the directories of the tools the scripts call, found now.
tool_dirs() {
  local d out=""
  for t in "$@"; do
    d="$(dirname "$(command -v "$t")")" || { echo "install.sh: $t not found on PATH" >&2; exit 1; }
    case ":$out:" in *":$d:"*) ;; *) out="${out:+$out:}$d" ;; esac
  done
  printf '%s:/usr/bin:/bin:/usr/sbin:/sbin' "$out"
}

plist() { # label script interval path
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key>
  <array><string>$PY</string><string>$HERE/$2</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartInterval</key><integer>$3</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$4</string><key>HOME</key><string>$HOME</string></dict>
  <key>StandardOutPath</key><string>$LOGS/$1.out.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$1.err.log</string>
</dict>
</plist>
PLIST
}

install_one() { # label script interval path
  if [[ "$PRINT" == "--print" ]]; then plist "$@"; return; fi
  mkdir -p "$AGENTS" "$LOGS"
  plist "$@" > "$AGENTS/$1.plist"
  launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$1.plist"
  echo "installed $1 (every $3 s)"
}

case "$WHAT" in detector|triage|all) ;; *) echo "usage: $0 [detector|triage|all] [--print]" >&2; exit 2 ;; esac
if [[ "$WHAT" == detector || "$WHAT" == all ]]; then
  install_one com.awesome-local-ai.monitor-detector monitor.py "$(interval TICK_S)" "$(tool_dirs dbench gh uv git python3)"
fi
if [[ "$WHAT" == triage || "$WHAT" == all ]]; then
  install_one com.awesome-local-ai.monitor-triage triage.py "$(interval TRIAGE_EVERY_S)" "$(tool_dirs claude dbench gh uv git python3)"
fi

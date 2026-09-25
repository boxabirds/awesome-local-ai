#!/usr/bin/env bash
# install-collector.sh [--env-file PATH] [--uninstall] -- run collector.py as a background service.
#
#   benchmarks/perf/power/install-collector.sh                           # macOS: launchd agent; Linux: systemd user service
#   benchmarks/perf/power/install-collector.sh --env-file ~/.hermes/.env # credentials kept elsewhere
#   benchmarks/perf/power/install-collector.sh --uninstall
#
# Needs ~/.config/awesome-local-ai/power.json (see collector.py). Takes one reading first and refuses
# to install if that fails. Runs from this checkout; data goes to ~/.local/share/awesome-local-ai/power/.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.awesome-local-ai.power-collector"
UNIT="awesome-local-ai-power-collector.service"
OUT="$HOME/.local/share/awesome-local-ai/power"
ENV_FILE="$HOME/.config/awesome-local-ai/tapo.env"
UNINSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UNIT_FILE="$HOME/.config/systemd/user/$UNIT"

if [[ "$UNINSTALL" == 1 ]]; then
  if [[ "$(uname)" == Darwin ]]; then launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$PLIST"
  else systemctl --user disable --now "$UNIT" 2>/dev/null || true; rm -f "$UNIT_FILE"; systemctl --user daemon-reload; fi
  echo "uninstalled (data kept in $OUT)"; exit 0
fi

UV="$(command -v uv || true)"
for c in "$HOME/.local/bin/uv" "$HOME/.dbench/tools/bin/uv" /opt/homebrew/bin/uv; do [[ -n "$UV" ]] || { [[ -x "$c" ]] && UV="$c"; }; done
[[ -n "$UV" ]] || { echo "uv not found (brew install uv, or curl -LsSf https://astral.sh/uv/install.sh | sh)" >&2; exit 1; }
CMD=("$UV" run --quiet "$HERE/collector.py" run --env-file "$ENV_FILE" --out "$OUT")

echo "one reading first:"
"$UV" run --quiet "$HERE/collector.py" once --env-file "$ENV_FILE" || { echo "not installing: a source above gave no reading" >&2; exit 1; }
mkdir -p "$OUT"

if [[ "$(uname)" == Darwin ]]; then
  mkdir -p "$(dirname "$PLIST")"
  args=""; for a in "${CMD[@]}"; do args+="    <string>$a</string>"$'\n'; done
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
$args  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$OUT/collector.log</string>
  <key>StandardErrorPath</key><string>$OUT/collector.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "installed: launchd agent $LABEL (log $OUT/collector.log)"
else
  mkdir -p "$(dirname "$UNIT_FILE")"
  cat > "$UNIT_FILE" <<EOF
[Unit]
Description=awesome-local-ai power collector
After=network-online.target

[Service]
ExecStart=${CMD[*]}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT"
  echo "installed: systemd user service $UNIT (journalctl --user -u $UNIT)"
  if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]]; then
    echo "NOTE: user services stop when you log out. To keep this running: sudo loginctl enable-linger $USER"
  fi
fi

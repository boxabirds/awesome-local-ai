#!/usr/bin/env bash
# install.sh [--env-file PATH] [--uninstall] -- build power-collector and run it as a background service
# that starts with the machine.
#
#   tools/power-collector/install.sh                           # macOS: launchd agent; Linux: systemd user service
#   tools/power-collector/install.sh --env-file ~/.hermes/.env # Tapo credentials kept elsewhere
#   tools/power-collector/install.sh --uninstall
#
# Needs ~/.config/awesome-local-ai/power.json (see README.md). Builds with cargo, installs the binary to
# ~/.local/bin/power-collector only if it changed (a firewall such as Little Snitch asks again for a
# changed binary), takes one reading from every source and refuses to install if any fails.
# Data goes to ~/.local/share/awesome-local-ai/power/.
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
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

BIN="$HOME/.local/bin/power-collector"
command -v cargo >/dev/null || { echo "cargo not found (https://rustup.rs)" >&2; exit 1; }
(cd "$HERE" && cargo build --release --quiet)
mkdir -p "$(dirname "$BIN")"
if cmp -s "$HERE/target/release/power-collector" "$BIN"; then echo "binary unchanged: $BIN"
else cp "$HERE/target/release/power-collector" "$BIN.new" && mv "$BIN.new" "$BIN"; echo "installed binary: $BIN"; fi
CMD=("$BIN" run --env-file "$ENV_FILE" --out "$OUT")

echo "one reading first:"
"$BIN" once --env-file "$ENV_FILE" || { echo "not installing: a source above gave no reading" >&2; exit 1; }
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

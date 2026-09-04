#!/usr/bin/env bash
# lib/service.sh -- optional always-on service unit.
#
# Only written on platforms that have a user-level service manager we support.
# The unit carries no hardcoded username: systemd's %h specifier resolves the
# invoking user's home directory.

SERVICE_CREATED=0

create_service() {
  case "$TARGET_OS" in
    ubuntu|debian) _service_systemd ;;
    macos)         _service_launchd ;;
    *) info "No user service manager configured for ${TARGET_OS}; skipping." ;;
  esac
}

_service_systemd() {
  need_cmd systemctl || { warn "systemctl not found; skipping service unit."; return 0; }
  local unit_dir="${HOME}/.config/systemd/user"
  mkdir -p "$unit_dir"
  cat > "${unit_dir}/${INSTALL_ID}.service" <<EOF
[Unit]
Description=${DISPLAY_NAME} server (${BACKEND} + ${ACCEL})
After=network.target

[Service]
Type=simple
# %h is systemd's specifier for the invoking user's home directory, so this
# unit carries no hardcoded username either.
ExecStart=%h/.local/bin/${SERVER_CMD}
Restart=on-failure
RestartSec=5
Environment=PATH=%h/.local/bin:/usr/local/cuda/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload 2>/dev/null || true
  SERVICE_CREATED=1
  ok "Systemd unit: ${INSTALL_ID}.service"
}

# launchd has no equivalent of systemd's %h specifier, so this is the one file
# in the repo that must contain an absolute home path. It is written on the
# machine it runs on and never shipped, and `create_service` is opt-in via
# INSTALL_SERVICE=1 -- on macOS the on-demand session manager covers most use,
# and parking 28-107 GB of weights in RAM at login is rarely what anyone wants.
_service_launchd() {
  if [[ "${INSTALL_SERVICE:-0}" != "1" ]]; then
    info "Skipping launchd agent (on-demand session manager covers most use)."
    info "  To install an always-on agent instead: INSTALL_SERVICE=1 \$0"
    return 0
  fi
  need_cmd launchctl || { warn "launchctl not found; skipping launchd agent."; return 0; }

  local label="com.awesome-local-ai.${INSTALL_ID}"
  local dir="${HOME}/Library/LaunchAgents"
  local plist="${dir}/${label}.plist"
  mkdir -p "$dir"

  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>              <string>${label}</string>
  <key>ProgramArguments</key>   <array><string>${BIN_DIR}/${SERVER_CMD}</string></array>
  <key>RunAtLoad</key>          <true/>
  <key>KeepAlive</key>          <dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key>    <string>${INSTALL_ROOT}/service.log</string>
  <key>StandardErrorPath</key>  <string>${INSTALL_ROOT}/service.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key> <string>${BIN_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

  # bootout first so re-running the installer reloads rather than erroring on
  # an already-loaded label.
  launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null \
    || warn "Wrote ${plist} but launchctl bootstrap failed; load it manually."
  SERVICE_CREATED=1
  ok "launchd agent: ${label}"
}

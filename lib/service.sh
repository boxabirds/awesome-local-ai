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

# playwright-platform.sh -- sourced by setup-node.sh and run.sh, never run on its own.
#
# Playwright ships Chromium per Ubuntu release and refuses releases it has not listed yet
# ("Playwright does not support chromium on ubuntu26.04-x64"). On a newer Ubuntu this points it at
# the newest build it knows, 24.04's, which runs there once its shared libraries are installed
# (setup-node.sh names any that are missing). Every Playwright call after sourcing this -- install,
# the browser check, the held-out suite -- inherits the override. OS_RELEASE: tests only.
PLAYWRIGHT_UBUNTU_FALLBACK="24.04"
_os_release="${OS_RELEASE:-/etc/os-release}"
if [[ -z "${PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:-}" && "$(uname)" == Linux && -r "$_os_release" ]]; then
  _os_id="$(sed -n 's/^ID=//p' "$_os_release" | tr -d '"')"
  _os_ver="$(sed -n 's/^VERSION_ID=//p' "$_os_release" | tr -d '"')"
  if [[ "$_os_id" == ubuntu && "$(printf '%s\n' "$_os_ver" "$PLAYWRIGHT_UBUNTU_FALLBACK" | sort -V | tail -1)" != "$PLAYWRIGHT_UBUNTU_FALLBACK" ]]; then
    _arch="$(uname -m)"; case "$_arch" in x86_64) _arch=x64 ;; aarch64) _arch=arm64 ;; esac
    export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE="ubuntu${PLAYWRIGHT_UBUNTU_FALLBACK}-${_arch}"
  fi
fi
unset _os_release _os_id _os_ver _arch

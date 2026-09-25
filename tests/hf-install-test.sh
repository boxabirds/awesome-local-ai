#!/usr/bin/env bash
# How ensure_hf gets the hf CLI and hf_transfer, without touching the network.
#
# Ubuntu 23.04+ ships python3 without pip, and refuses `pip install --user`
# into the system interpreter anyway (PEP 668), so ensure_hf installs hf as a
# uv tool, bootstrapping uv (no sudo, into ~/.local/bin) when it is missing.
# hf_transfer must be importable by the python that runs hf -- the uv tool's
# venv, not the system python3.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# A clean machine: fake tools first, then only the system dirs, so no real hf
# or uv on the developer's PATH can leak in. Every fake logs to $S/calls.
scenario() { # name
  S="$SCRATCH/$1"; mkdir -p "$S/bin" "$S/userhome"; : > "$S/calls"
  # python3 as Ubuntu 26.04 has it: no pip module, no hf_transfer.
  cat > "$S/bin/python3" <<FAKE
#!/bin/bash
echo "python3 \$*" >> "$S/calls"
[[ "\$1 \$2" == "-m pip" ]] && { echo "/usr/bin/python3: No module named pip" >&2; exit 1; }
[[ "\$1" == "-c" ]] && exit 1
exit 0
FAKE
  chmod +x "$S/bin/python3"
}

# uv: `uv tool install huggingface_hub [--with hf_transfer]` makes a tool venv
# whose python imports hf_transfer only if it was asked for, and an hf shim in
# ~/.local/bin that runs on that python.
write_uv() { # path
  cat > "$1" <<FAKE
#!/bin/bash
echo "uv \$*" >> "$S/calls"
if [[ "\$1 \$2" == "tool install" ]]; then
  V="\$HOME/.local/share/uv/tools/huggingface-hub"
  mkdir -p "\$V/bin" "\$HOME/.local/bin"
  if [[ " \$* " == *" --with hf_transfer "* ]]; then ok=0; else ok=1; fi
  printf '#!/bin/bash\n[[ "\$1" == -c ]] && exit %s\nexit 0\n' "\$ok" > "\$V/bin/python"
  chmod +x "\$V/bin/python"
  printf '#!%s\necho "hf 1.0"\n' "\$V/bin/python" > "\$HOME/.local/bin/hf"
  chmod +x "\$HOME/.local/bin/hf"
fi
FAKE
  chmod +x "$1"
}

# uv's standalone installer, run as `curl -LsSf https://astral.sh/uv/install.sh | sh`:
# prints a script that drops uv into ~/.local/bin.
fake_curl() { # ok|fail
  write_uv "$S/uv.real"
  cat > "$S/bin/curl" <<FAKE
#!/bin/bash
echo "curl \$*" >> "$S/calls"
[[ "$1" == fail ]] && { echo "curl: (6) Could not resolve host: astral.sh" >&2; exit 6; }
echo 'mkdir -p "\$HOME/.local/bin" && cp "$S/uv.real" "\$HOME/.local/bin/uv"'
FAKE
  chmod +x "$S/bin/curl"
}

run_ensure_hf() {
  HOME="$S/userhome" PATH="$S/bin:/usr/bin:/bin" bash -c '
    LOG_FILE=/dev/null; . "'"$REPO_ROOT"'/lib/common.sh"; . "'"$REPO_ROOT"'/lib/hf.sh"
    ensure_hf; echo "HF_TRANSFER=${HF_HUB_ENABLE_HF_TRANSFER:-unset}"; command -v hf' 2>&1
}

echo "Ubuntu 26.04: python3 without pip, no uv yet"
scenario ubuntu2604; fake_curl ok
out="$(run_ensure_hf)"; rc=$?
assert_eq "it succeeds"                          "0" "$rc"
assert_ok "uv is bootstrapped from astral.sh"    grep -q '^curl .*astral.sh/uv/install.sh' "$S/calls"
assert_ok "hf is a uv tool, with hf_transfer"    grep -q '^uv tool install huggingface_hub --with hf_transfer' "$S/calls"
assert_fails "pip is never tried"                grep -q -- '-m pip' "$S/calls"
assert_ok "hf_transfer is switched on"           grep -q 'HF_TRANSFER=1' <<< "$out"
assert_ok "hf is found on PATH afterwards"       grep -q '\.local/bin/hf$' <<< "$out"

echo
echo "uv already installed"
scenario uv; write_uv "$S/bin/uv"; fake_curl ok
out="$(run_ensure_hf)"; rc=$?
assert_eq "it succeeds"                          "0" "$rc"
assert_fails "uv is not re-downloaded"           grep -q '^curl' "$S/calls"
assert_ok "hf is a uv tool, with hf_transfer"    grep -q '^uv tool install huggingface_hub --with hf_transfer' "$S/calls"
assert_ok "hf_transfer is switched on"           grep -q 'HF_TRANSFER=1' <<< "$out"

echo
echo "no uv, and it cannot be fetched"
scenario offline; fake_curl fail
out="$(run_ensure_hf)"; rc=$?
assert_fails "the install stops"                 test "$rc" = 0
assert_ok "...saying how to install uv by hand"  grep -q 'astral.sh/uv/install.sh' <<< "$out"
assert_fails "...without falling back to pip"    grep -q -- '-m pip' "$S/calls"

echo
echo "hf already present (pip --user era) without hf_transfer, no uv"
scenario bare; fake_curl fail
mkdir -p "$S/userhome/.local/bin"; printf '#!%s\necho "hf 1.0"\n' "$S/bin/python3" > "$S/userhome/.local/bin/hf"
chmod +x "$S/userhome/.local/bin/hf"
out="$(run_ensure_hf)"; rc=$?
assert_eq "an existing hf is used as it is"      "0" "$rc"
assert_ok "...it says downloads will be slower"  grep -q 'hf_transfer unavailable' <<< "$out"
assert_ok "...and leaves hf_transfer off"        grep -q 'HF_TRANSFER=unset' <<< "$out"

finish

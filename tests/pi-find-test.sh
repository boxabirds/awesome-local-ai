#!/usr/bin/env bash
# lib/clients/pi.sh must find pi.dev, not whatever else is called `pi`.
#
# Homebrew's Python can carry a 2013 package also named pi (chbrown/pi, "simpler
# python package installation"); its /opt/homebrew/bin/pi crashes on Python 3.
# Accepting any executable named pi meant the installer reported pi as
# installed, never offered pi.dev, and every <install>-pi session died in a
# Python SyntaxError.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
SANDBOX="$(cd "$SANDBOX" && pwd -P)"   # macOS: /var -> /private/var

# A pi.dev install as npm lays it out: <prefix>/bin/pi -> the package's cli.js.
make_pi_dev() { # prefix
  local pkg="$1/lib/node_modules/@earendil-works/pi-coding-agent/dist"
  mkdir -p "$pkg" "$1/bin"
  printf '#!/usr/bin/env node\n' > "$pkg/cli.js"; chmod +x "$pkg/cli.js"
  ln -s ../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js "$1/bin/pi"
}
# Something else called pi: the Homebrew Python console script.
make_impostor() { # dir
  mkdir -p "$1"
  printf '#!/usr/bin/env python3\nfrom pi.cli import main\n' > "$1/pi"; chmod +x "$1/pi"
}
assert_not() { # description rejected actual
  if [[ "$3" == "$2" ]]; then _fail "$1" "anything but $2" "$3"; else _pass "$1"; fi
}

# Run _pi_find with only the given PATH entries (plus the basics), in a clean HOME.
find_pi() { # home path-entries...
  local home="$1"; shift
  local p; p="$(IFS=:; echo "$*")"
  HOME="$home" PATH="${p:+$p:}/usr/bin:/bin" \
    bash -c '. "$1"; _pi_find' _ "$REPO_ROOT/lib/clients/pi.sh" 2>/dev/null
}

# 1. pi.dev on PATH is used.
H="$SANDBOX/h1"; make_pi_dev "$H/npm"
assert_eq "pi.dev on PATH is found" "$H/npm/bin/pi" "$(find_pi "$H" "$H/npm/bin")"

# 2. An impostor first on PATH, pi.dev later on PATH: pi.dev wins.
H="$SANDBOX/h2"; make_impostor "$H/brew"; make_pi_dev "$H/npm"
assert_eq "an impostor earlier on PATH is skipped" \
  "$H/npm/bin/pi" "$(find_pi "$H" "$H/brew" "$H/npm/bin")"

# 3. Impostor on PATH, pi.dev installed under nvm but not on PATH (this Mac).
H="$SANDBOX/h3"; make_impostor "$H/brew"; make_pi_dev "$H/.nvm/versions/node/v22.12.0"
assert_eq "an impostor on PATH does not hide pi.dev under nvm" \
  "$H/.nvm/versions/node/v22.12.0/bin/pi" "$(find_pi "$H" "$H/brew")"

# 4. Only an impostor: whatever is returned, it is never the impostor.
H="$SANDBOX/h4"; make_impostor "$H/brew"
assert_not "a lone impostor is not accepted" "$H/brew/pi" "$(find_pi "$H" "$H/brew")"

# 5. Version-manager shims are not symlinks into the package; they still count.
H="$SANDBOX/h5"; mkdir -p "$H/.volta/bin"
printf '#!/bin/sh\n' > "$H/.volta/bin/pi"; chmod +x "$H/.volta/bin/pi"
assert_eq "a volta shim is accepted (volta only manages node tools)" \
  "$H/.volta/bin/pi" "$(find_pi "$H")"

H="$SANDBOX/h6"; mkdir -p "$H/.asdf/shims"
printf '#!/usr/bin/env bash\n# asdf-plugin: nodejs 22.12.0\nexec asdf exec "pi" "$@"\n' > "$H/.asdf/shims/pi"
chmod +x "$H/.asdf/shims/pi"
assert_eq "an asdf nodejs shim is accepted" "$H/.asdf/shims/pi" "$(find_pi "$H")"

H="$SANDBOX/h7"; mkdir -p "$H/.asdf/shims"
printf '#!/usr/bin/env bash\n# asdf-plugin: python 3.11.9\nexec asdf exec "pi" "$@"\n' > "$H/.asdf/shims/pi"
chmod +x "$H/.asdf/shims/pi"
assert_not "an asdf python shim is not accepted" "$H/.asdf/shims/pi" "$(find_pi "$H")"

finish

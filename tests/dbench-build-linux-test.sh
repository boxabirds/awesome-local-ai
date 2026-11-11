#!/usr/bin/env bash
# tools/dbench/build-linux.sh: the zig cross-build of dbench for the Linux nodes, x86_64 (gruntus) and aarch64 (the
# DGX Sparks).
#
# On 11 Nov 2026 the first aarch64 build failed at its last step, the link, after an hour's compile: rustc passes
# -Wl,--fix-cortex-a53-843419 when it links for aarch64 Linux, and zig's linker refuses it ("unsupported linker arg").
# x86_64 links never get that flag, so the x86_64 builds had always worked.
#
# Stubs: cargo plays rustc's link step (it runs the linker the script set, with the arguments rustc gives it for the
# target) and zig records what it is given and, like the real one, refuses --fix-cortex-a53-843419.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
BUILD="$REPO_ROOT/tools/dbench/build-linux.sh"
CORTEX_FLAG=-Wl,--fix-cortex-a53-843419

setup() { # -> $T: a tools folder holding the script, stubs first on PATH
  T="$(mktemp -d)"
  mkdir -p "$T/tools/dbench" "$T/bin"
  cp "$BUILD" "$T/tools/dbench/build-linux.sh"
  cat > "$T/bin/cargo" <<'STUB'
#!/usr/bin/env bash
# cargo build --profile dist --target TARGET -p dbench: the link, as rustc runs it.
while [[ $# -gt 0 ]]; do [[ "$1" == --target ]] && target="$2"; shift; done
var="CARGO_TARGET_$(echo "${target//-/_}" | tr '[:lower:]' '[:upper:]')_LINKER"
linker="${!var:?no linker set for $target}"
extra=(); [[ "$target" == aarch64-* ]] && extra=(-Wl,--fix-cortex-a53-843419)
out="../target/$target/dist"; mkdir -p "$out"
"$linker" "${extra[@]}" main.o --target="$target" -Wl,--gc-sections -o "$out/dbench" || exit 101
STUB
  cat > "$T/bin/zig" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$T/zig.log"
for a in "\$@"; do [[ "\$a" == "$CORTEX_FLAG" ]] && { echo "error: unsupported linker arg: --fix-cortex-a53-843419" >&2; exit 1; }; done
[[ "\$1" == ar ]] && exit 0
while [[ \$# -gt 0 ]]; do [[ "\$1" == -o ]] && touch "\$2"; shift; done
STUB
  printf '#!/bin/sh\necho "$1: ELF stub"\n' > "$T/bin/file"
  chmod +x "$T/bin/cargo" "$T/bin/zig" "$T/bin/file"
}

run_build() { # ARCH -> $RC, $T/out.log
  (cd "$T" && PATH="$T/bin:$PATH" "$T/tools/dbench/build-linux.sh" "$@" > "$T/out.log" 2>&1); RC=$?
}

echo "aarch64 (the DGX Sparks)"
setup
run_build aarch64
assert_eq "the aarch64 build links" "0" "$RC"
assert_ok "and leaves the binary where rollout.sh looks for it" test -f "$T/tools/target/aarch64-unknown-linux-gnu/dist/dbench"
assert_fails "zig is never given --fix-cortex-a53-843419" grep -qF -- "$CORTEX_FLAG" "$T/zig.log"
assert_ok "zig links for aarch64 Linux at glibc 2.35" grep -qF -- "cc -target aarch64-linux-gnu.2.35" "$T/zig.log"
assert_ok "the linker's other arguments still reach zig" grep -qF -- "-Wl,--gc-sections" "$T/zig.log"
assert_fails "the rust-style --target never reaches zig" grep -qF -- "--target=" "$T/zig.log"
rm -rf "$T"

echo "x86_64 (gruntus)"
setup
run_build
assert_eq "x86_64 is the default, and it links" "0" "$RC"
assert_ok "zig links for x86_64 Linux at glibc 2.35" grep -qF -- "cc -target x86_64-linux-gnu.2.35" "$T/zig.log"
assert_ok "and the binary is in place" test -f "$T/tools/target/x86_64-unknown-linux-gnu/dist/dbench"
rm -rf "$T"

echo "an unknown arch"
setup
run_build riscv64
assert_eq "is refused with usage" "2" "$RC"
assert_fails "and nothing is linked" test -e "$T/zig.log"
rm -rf "$T"

finish

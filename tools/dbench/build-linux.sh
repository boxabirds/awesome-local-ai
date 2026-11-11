#!/usr/bin/env bash
# build-linux.sh [x86_64|aarch64] -- cross-build dbench for Linux (glibc) from a Mac, using zig as the C
# compiler, archiver and linker (ring, under rustls, has C code).
#   tools/dbench/build-linux.sh            -> tools/target/x86_64-unknown-linux-gnu/dist/dbench   (gruntus)
#   tools/dbench/build-linux.sh aarch64    -> tools/target/aarch64-unknown-linux-gnu/dist/dbench  (the DGX Sparks)
# The dist profile (tools/Cargo.toml): the fully optimised, stripped binary a node runs.
# Needs: zig (brew install zig). The Rust targets come with the toolchain rust-toolchain.toml pins.
set -euo pipefail
GLIBC="${GLIBC:-2.35}"   # Ubuntu 22.04; lower it for older distros
ARCH="${1:-x86_64}"
case "$ARCH" in x86_64|aarch64) ;; *) echo "usage: $0 [x86_64|aarch64]" >&2; exit 2 ;; esac
TARGET="$ARCH-unknown-linux-gnu"
TARGET_ENV="${TARGET//-/_}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAP="$(mktemp -d)"; trap 'rm -rf "$WRAP"' EXIT
cat > "$WRAP/cc" <<CC
#!/bin/sh
# cc-rs adds a rust-style --target that zig rejects; zig gets its own below.
# rustc links aarch64 Linux with -Wl,--fix-cortex-a53-843419, which zig's linker refuses ("unsupported linker arg").
# It works around an erratum of the Cortex-A53, a core the DGX Sparks do not have.
for a in "\$@"; do shift; case "\$a" in --target=*|-Wl,--fix-cortex-a53-843419) ;; *) set -- "\$@" "\$a" ;; esac; done
exec zig cc -target $ARCH-linux-gnu.$GLIBC "\$@"
CC
printf '#!/bin/sh\nexec zig ar "$@"\n' > "$WRAP/ar"
chmod +x "$WRAP/cc" "$WRAP/ar"
cd "$HERE"
env "CC_$TARGET_ENV=$WRAP/cc" "AR_$TARGET_ENV=$WRAP/ar" "CARGO_TARGET_$(echo "$TARGET_ENV" | tr '[:lower:]' '[:upper:]')_LINKER=$WRAP/cc" \
  cargo build --profile dist --target "$TARGET" -p dbench
file "../target/$TARGET/dist/dbench"

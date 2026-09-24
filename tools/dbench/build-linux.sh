#!/usr/bin/env bash
# build-linux.sh -- cross-build dbench for Linux x86_64 (glibc) from a Mac, using zig as the C
# compiler, archiver and linker (ring, under rustls, has C code).
#   tools/dbench/build-linux.sh            -> target/x86_64-unknown-linux-gnu/release/dbench
# Needs: zig (brew install zig) and `rustup target add x86_64-unknown-linux-gnu`.
set -euo pipefail
GLIBC="${GLIBC:-2.35}"   # Ubuntu 22.04; lower it for older distros
TARGET=x86_64-unknown-linux-gnu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAP="$(mktemp -d)"; trap 'rm -rf "$WRAP"' EXIT
cat > "$WRAP/cc" <<CC
#!/bin/sh
# cc-rs adds a rust-style --target that zig rejects; zig gets its own below.
for a in "\$@"; do shift; case "\$a" in --target=*) ;; *) set -- "\$@" "\$a" ;; esac; done
exec zig cc -target x86_64-linux-gnu.$GLIBC "\$@"
CC
printf '#!/bin/sh\nexec zig ar "$@"\n' > "$WRAP/ar"
chmod +x "$WRAP/cc" "$WRAP/ar"
cd "$HERE"
CC_x86_64_unknown_linux_gnu="$WRAP/cc" AR_x86_64_unknown_linux_gnu="$WRAP/ar" \
CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER="$WRAP/cc" \
  cargo build --release --target "$TARGET"
file "target/$TARGET/release/dbench"

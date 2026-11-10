#!/usr/bin/env bash
# ops/dbench/install.sh: building dbench, dbench-collector and bench-lake on this Mac and putting them in service.
#
# Until 10 Nov 2026 this was done by hand: the binaries copied into ~/.local/bin and the collector's launchd job written
# once, with no priority set. On 10 Nov the collector took a core of the owner's M2 for minutes at a time while they
# worked. The installer runs it as a background process (macOS throttles its CPU and disk use), and keeps the node
# server at normal priority, because benchmark jobs run under it and their timings must not change.
#
# cargo, codesign and launchctl are stubs here; the built `dbench` is a stub that answers `--version`, `nodes`,
# `status` and `service-unit`.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
INSTALL="$REPO_ROOT/ops/dbench/install.sh"
HOST="$(hostname)"

setup() { # -> $T: a repo holding the installer, a home with the old binaries, stubs on PATH
  T="$(mktemp -d)"
  mkdir -p "$T/repo/ops/dbench" "$T/repo/tools" "$T/home/.local/bin" "$T/bin" "$T/home/Library/LaunchAgents"
  cp "$INSTALL" "$T/repo/ops/dbench/install.sh"
  for b in dbench dbench-collector; do
    printf '#!/usr/bin/env bash\necho "%s 0.1.0+old111"\n' "$b" > "$T/home/.local/bin/$b"; chmod +x "$T/home/.local/bin/$b"
  done
  echo '{}' > "$T/status.json"
  # cargo: `build` writes the three binaries; dbench answers what the installer asks of it.
  cat > "$T/bin/cargo" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$T/cargo.log"
out="\$PWD/target/release"; mkdir -p "\$out"
cat > "\$out/dbench" <<'DB'
#!/usr/bin/env bash
case "\$1" in
  --version) echo "dbench 0.1.0+new222" ;;
  nodes) printf '{"elsewhere":{"url":"http://100.9.9.9:7717","status":"ok","node":{"hostname":"other"}},"this-mac":{"url":"http://100.1.2.3:7717","status":"ok","node":{"hostname":"$HOST"}}}\n' ;;
  status) cat "$T/status.json" ;;
  service-unit)
    shift; args=""; for a in "\$@"; do args+="<string>\$a</string>"; done
    printf '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>com.awesome-local-ai.dbench</string><key>ProgramArguments</key><array><string>%s</string><string>serve</string>%s</array><key>KeepAlive</key><true/></dict></plist>\n' "\$HOME/.local/bin/dbench" "\$args" ;;
esac
DB
printf '#!/usr/bin/env bash\necho "dbench-collector 0.1.0+new222"\n' > "\$out/dbench-collector"
printf '#!/usr/bin/env bash\necho "bench-lake 0.1.0"\n' > "\$out/bench-lake"
chmod +x "\$out/dbench" "\$out/dbench-collector" "\$out/bench-lake"
STUB
  cat > "$T/bin/codesign" <<STUB
#!/usr/bin/env bash
echo "\${@: -1}" >> "$T/codesign.log"
STUB
  # launchctl: a job is listed from its bootstrap until its bootout, and runs while listed.
  cat > "$T/bin/launchctl" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$T/launchctl.log"
case "\$1" in
  bootout)   rm -f "$T/loaded.\${2##*/}"; exit 0 ;;
  bootstrap) label="\$(basename "\$3" .plist)"; touch "$T/loaded.\$label"; exit 0 ;;
  print)     [[ -e "$T/loaded.\${2##*/}" ]] && { echo "state = running"; echo "pid = 4242"; exit 0; }; exit 113 ;;
esac
STUB
  chmod +x "$T/bin/cargo" "$T/bin/codesign" "$T/bin/launchctl"
}
run_install() { HOME="$T/home" PATH="$T/bin:$PATH" bash "$T/repo/ops/dbench/install.sh" "$@" > "$T/out.log" 2>&1; }
key() { plutil -extract "$2" raw -o - "$1" 2>/dev/null; }
inode() { stat -f %i "$1"; }

echo "the installer"
assert_ok "it exists and parses" bash -n "$INSTALL"
assert_eq "it holds no home directory" "0" "$(grep -c '/Users/' "$INSTALL" || true)"

echo "an install on a Mac whose node has no job running"
setup
OLD_INODE="$(inode "$T/home/.local/bin/dbench")"
run_install; RC=$?
assert_eq "it succeeds" "0" "$RC"
assert_ok "it builds dbench (both binaries) and bench-lake, release" grep -qE -- "build --release (-p dbench -p bench-lake|-p bench-lake -p dbench)" "$T/cargo.log"
B="$T/home/.local/bin"
assert_eq "dbench is the new build" "dbench 0.1.0+new222" "$("$B/dbench" --version)"
assert_eq "dbench-collector is the new build" "dbench-collector 0.1.0+new222" "$("$B/dbench-collector" --version)"
assert_eq "the old dbench is kept, named for its version" "dbench 0.1.0+old111" "$("$B/dbench.before-old111" --version 2>/dev/null)"
assert_eq "the old dbench-collector is kept, named for its version" "dbench-collector 0.1.0+old111" "$("$B/dbench-collector.before-old111" --version 2>/dev/null)"
assert_ok "each new binary is signed as the incoming copy, before it replaces the old" grep -qx "$B/dbench.incoming" "$T/codesign.log"
assert_ok "(the collector too)" grep -qx "$B/dbench-collector.incoming" "$T/codesign.log"
assert_fails "the running binary is replaced by a rename, never overwritten in place" test "$OLD_INODE" = "$(inode "$B/dbench")"
assert_fails "no incoming copy is left behind" test -e "$B/dbench.incoming"

C="$T/home/Library/LaunchAgents/com.awesome-local-ai.dbench-collect.plist"
echo "the collector's job"
assert_ok "a valid plist" plutil -lint "$C"
assert_eq "it runs in the background class: macOS throttles its CPU and disk use" "Background" "$(key "$C" ProcessType)"
assert_eq "its disk reads and writes are low priority" "true" "$(key "$C" LowPriorityIO)"
assert_ok "it runs at a lower scheduling priority (a positive nice)" bash -c '(( $(plutil -extract Nice raw -o - "$1") > 0 ))' _ "$C"
assert_eq "it runs the installed collector" "$B/dbench-collector" "$(key "$C" ProgramArguments.0)"
assert_eq "with the scope collection" "--scopes" "$(key "$C" ProgramArguments.1)"
assert_eq "in this checkout" "$T/repo" "$(key "$C" WorkingDirectory)"
assert_eq "kept alive" "true" "$(key "$C" KeepAlive)"
assert_eq "logging where it always has" "$T/home/.dbench/collect.log" "$(key "$C" StandardOutPath)"

S="$T/home/Library/LaunchAgents/com.awesome-local-ai.dbench.plist"
echo "the node server's job"
assert_ok "a valid plist" plutil -lint "$S"
assert_eq "not in the background class: benchmark jobs run under it and their timings must not change" "" "$(key "$S" ProcessType)"
assert_ok "it listens on this Mac's node address, from the node list" bash -c 'plutil -convert json -o - "$1" | grep -q "100.1.2.3:7717"' _ "$S"

echo "restarting"
assert_ok "the collector's job is loaded again" grep -q "bootstrap gui/.* .*com.awesome-local-ai.dbench-collect.plist" "$T/launchctl.log"
assert_ok "the node server's job is loaded again" grep -q "bootstrap gui/.* .*com.awesome-local-ai.dbench.plist" "$T/launchctl.log"
rm -rf "$T"

echo "a job running on this Mac's node"
setup
printf '{"this-mac":[{"id":"job-1","state":{"status":"running"}}],"elsewhere":[{"id":"job-2","state":{"status":"running"}}]}\n' > "$T/status.json"
run_install; RC=$?
assert_fails "the install is refused" test "$RC" = "0"
assert_ok "and says which job" grep -q "job-1" "$T/out.log"
assert_eq "dbench is left as it was" "dbench 0.1.0+old111" "$("$T/home/.local/bin/dbench" --version)"
assert_fails "no job is restarted" test -e "$T/launchctl.log"
rm -rf "$T"

echo "a job running on another node only"
setup
printf '{"this-mac":[{"id":"job-1","state":{"status":"done"}}],"elsewhere":[{"id":"job-2","state":{"status":"running"}}]}\n' > "$T/status.json"
run_install; RC=$?
assert_eq "the install goes ahead" "0" "$RC"
rm -rf "$T"

echo "printing"
setup
run_install --print; RC=$?
assert_eq "it succeeds" "0" "$RC"
assert_ok "it shows the collector's job" grep -q "com.awesome-local-ai.dbench-collect" "$T/out.log"
assert_eq "it writes no LaunchAgents" "0" "$(find "$T/home/Library/LaunchAgents" -name '*.plist' | wc -l | tr -d ' ')"
assert_eq "it replaces no binary" "dbench 0.1.0+old111" "$("$T/home/.local/bin/dbench" --version)"
rm -rf "$T"

finish

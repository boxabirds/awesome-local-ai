#!/usr/bin/env bash
# install.sh [--print] -- build dbench, dbench-collector and bench-lake on this Mac and put them in service.
#
#   1. cargo build --release of dbench (its two binaries, dbench and dbench-collector) and bench-lake. bench-lake is used where
#      it is built, tools/target/release (the harness, the benchmarker and the monitor run it there).
#   2. Refuses if a job is running on this Mac's node (the node in `dbench nodes` whose hostname is this machine's): hold the
#      node, let the job finish, run this again.
#   3. Puts each binary in ~/.local/bin: the old one is kept as <name>.before-<its build id>, the new one is copied in as
#      <name>.incoming, signed, and renamed over the old. A running macOS binary that is overwritten in place is killed.
#   4. Writes both launchd jobs and loads them again:
#        com.awesome-local-ai.dbench          `dbench serve`, written by `dbench service-unit`, at normal priority: benchmark jobs
#                                             run under it and their timings must not change.
#        com.awesome-local-ai.dbench-collect  `dbench-collector --scopes`, as a background process: macOS throttles its CPU and
#                                             disk use, so it gives way to whatever the person at this Mac is doing.
#   5. Waits for both to run (the first start after a swap can be killed for code signing; launchd starts it again) and checks
#      that the installed binaries are the new build.
#
# `--print` builds, then shows both jobs without installing anything.
# Nodes other than this Mac are not touched: their binaries are put in place separately.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TOOLS="$REPO/tools"
NEW="$TOOLS/target/release"
PRINT="${1:-}"

BIN="$HOME/.local/bin"
STATE="$HOME/.dbench"
AGENTS="$HOME/Library/LaunchAgents"
SERVE_LABEL=com.awesome-local-ai.dbench
COLLECT_LABEL=com.awesome-local-ai.dbench-collect
NODE_REPO="${DBENCH_NODE_REPO:-$HOME/.spec-bench/awesome-local-ai}"   # the checkout this Mac's node runs jobs from
SHARE_DIR="$HOME/.local/share"
MAX_RESTARTS=3
COLLECTOR_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
COLLECTOR_NICE=10        # a positive nice: the scheduler prefers every normal process to it
THROTTLE_S=10            # launchd's delay before restarting a job that exited
TEARDOWN_POLLS=75        # launchd returns from bootout before the job is gone; a bootstrap straight after it fails
TEARDOWN_POLL_S=0.2      # so wait up to TEARDOWN_POLLS x TEARDOWN_POLL_S (15 s) for the label to go
START_POLLS=60           # and up to START_POLLS x START_POLL_S (30 s) for a job to run: a start killed for code signing
START_POLL_S=0.5         # is restarted after THROTTLE_S
INSTALLED=(dbench dbench-collector)

die() { echo "install.sh: $*" >&2; exit 1; }

case "$PRINT" in ""|--print) ;; *) echo "usage: $0 [--print]" >&2; exit 2 ;; esac

echo "building dbench, dbench-collector and bench-lake"
(cd "$TOOLS" && cargo build --release -p dbench -p bench-lake)
for b in "${INSTALLED[@]}" bench-lake; do [[ -x "$NEW/$b" ]] || die "the build did not produce $NEW/$b"; done
build_id() { "$1" --version | awk '{print $2}' | sed 's/.*+//'; }
NEW_ID="$(build_id "$NEW/dbench")"

# This Mac's node, and the address it listens on, from the node list.
read -r NODE BIND < <("$NEW/dbench" nodes --json | python3 -I -c '
import json, sys
host = sys.argv[1].lower()
for name, n in json.load(sys.stdin).items():
    if ((n.get("node") or {}).get("hostname") or "").lower() == host:
        print(name, n["url"].split("://", 1)[-1].rstrip("/")); break
' "$(hostname)") || true
[[ -n "${NODE:-}" && -n "${BIND:-}" ]] || die "no node in \`dbench nodes\` has this machine's hostname ($(hostname))"

collector_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$COLLECT_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$BIN/dbench-collector</string><string>--scopes</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>$THROTTLE_S</integer>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>$COLLECTOR_NICE</integer>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$COLLECTOR_PATH</string><key>HOME</key><string>$HOME</string></dict>
  <key>StandardOutPath</key><string>$STATE/collect.log</string>
  <key>StandardErrorPath</key><string>$STATE/collect.log</string>
</dict>
</plist>
PLIST
}

serve_plist() {
  local args=(--kind launchd --bind "$BIND" --repo "$NODE_REPO" --home "$STATE" --share-dir "$SHARE_DIR" --max-restarts "$MAX_RESTARTS")
  local node_bin; node_bin="$(command -v node 2>/dev/null || true)"
  [[ -n "$node_bin" ]] && args+=(--path-prepend "$(dirname "$node_bin")")
  args+=(--path-prepend "$BIN")
  "$NEW/dbench" service-unit "${args[@]}"
}

if [[ "$PRINT" == "--print" ]]; then
  echo "== $COLLECT_LABEL"; collector_plist
  echo "== $SERVE_LABEL (node $NODE)"; serve_plist
  exit 0
fi

running="$("$NEW/dbench" status --json | python3 -I -c '
import json, sys
jobs = json.load(sys.stdin).get(sys.argv[1]) or []
print(" ".join(j["id"] for j in jobs if (j.get("state") or {}).get("status") == "running"))
' "$NODE")"
[[ -z "$running" ]] || die "a job is running on $NODE ($running): \`dbench hold $NODE\`, wait for it to finish, then run this again"

swap() { # name: put the new build of <name> in place, keeping the old one
  local name="$1" dest="$BIN/$1"
  mkdir -p "$BIN"
  if [[ -e "$dest" ]]; then
    if cmp -s "$NEW/$name" "$dest"; then echo "$name: already this build"; return; fi
    local old_id; old_id="$(build_id "$dest" 2>/dev/null || true)"
    cp -p "$dest" "$dest.before-${old_id:-$(date +%Y%m%d%H%M%S)}"
  fi
  cp "$NEW/$name" "$dest.incoming"
  chmod 755 "$dest.incoming"
  codesign -s - --force "$dest.incoming"
  mv -f "$dest.incoming" "$dest"
  echo "$name: installed $NEW_ID"
}

reload() { # label plist-text
  local label="$1" target="gui/$(id -u)/$1" waited=0
  mkdir -p "$AGENTS" "$STATE"
  printf '%s\n' "$2" > "$AGENTS/$label.plist"
  launchctl bootout "$target" 2>/dev/null || true
  while launchctl print "$target" >/dev/null 2>&1; do
    (( waited >= TEARDOWN_POLLS )) && die "$label did not stop in time"
    sleep "$TEARDOWN_POLL_S"; waited=$((waited + 1))
  done
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
  waited=0
  until launchctl print "$target" 2>/dev/null | grep -q "state = running"; do
    (( waited >= START_POLLS )) && die "$label is loaded but not running: see launchctl print $target"
    sleep "$START_POLL_S"; waited=$((waited + 1))
  done
  echo "$label: running"
}

for b in "${INSTALLED[@]}"; do swap "$b"; done
reload "$COLLECT_LABEL" "$(collector_plist)"
reload "$SERVE_LABEL" "$(serve_plist)"
for b in "${INSTALLED[@]}"; do
  [[ "$(build_id "$BIN/$b")" == "$NEW_ID" ]] || die "$BIN/$b is not build $NEW_ID after the install"
done
echo "installed build $NEW_ID on node $NODE; bench-lake is in $NEW"

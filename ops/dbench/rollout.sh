#!/usr/bin/env bash
# rollout.sh NODE... -- build dbench for each named bench node and put it in service there, one node at a time.
#
#   1. Reads each node's os, arch, version, hold and job from `dbench nodes --json`. A node already on this build is
#      left alone; this Mac's own node is refused (that is ops/dbench/install.sh, run after the nodes: a new `dbench
#      submit` can be refused by a node on an older dbench).
#   2. Builds on this Mac, once per kind of node: macOS arm64 `cargo build --release -p dbench`; Linux with
#      tools/dbench/build-linux.sh <arch> (zig cross-build, dist profile). Nothing is built on a node.
#   3. Per node, in the order given:
#        skips it if a job is running there (it is not held: hold it, let the job finish, run this again);
#        holds it, unless it is held already, and checks again that no job started;
#        copies the binary beside the old one as <name>.incoming; on the node: chmod 755, codesign on macOS, keeps the
#        old one as <name>.before-<its build id>, renames the new one over it, restarts the node's service;
#        waits until the node answers with the new build;
#        releases it, only if this script held it. A node that fails stays held, and the rollout stops.
#
# Nodes are named one by one: there is no "all".
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TOOLS="$REPO/tools"
DBENCH="${DBENCH:-dbench}"                 # the dbench that talks to the nodes (the installed one)
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20)
SCP=(scp -q -o BatchMode=yes -o ConnectTimeout=20)
LINUX_BIN=.dbench/tools/bin/dbench         # relative to the node's home
MAC_BIN=.local/bin/dbench
MAC_LABEL=com.awesome-local-ai.dbench
LINUX_UNIT=dbench
SENTINEL=ROLLOUT-NODE-OK                   # Tailscale SSH can exit 0 whatever the command did: success is this line
VERSION_POLLS="${ROLLOUT_VERSION_POLLS:-60}" # wait up to VERSION_POLLS x VERSION_POLL_S (120 s) for the new build to answer:
VERSION_POLL_S="${ROLLOUT_VERSION_POLL_S:-2}" # a macOS start after a swap is killed for code signing and restarted 10 s later
HOLD_REASON="dbench rollout: new build being installed"

die() { echo "rollout.sh: $*" >&2; exit 1; }
[[ $# -ge 1 ]] || { echo "usage: $0 NODE..." >&2; exit 2; }

nodes_json() { "$DBENCH" nodes --json; }
# field NODE KEY: one value from the node's own report (os, arch, dbench_version, hold, current_job), "" when absent.
field() {
  nodes_json | python3 -I -c '
import json, sys
n = (json.load(sys.stdin).get(sys.argv[1]) or {})
v = (n.get("node") or {}).get(sys.argv[2])
if sys.argv[2] == "status": v = n.get("status")
if isinstance(v, dict): v = v.get("id") or v.get("reason") or "yes"
print("" if v in (None, False) else v)
' "$1" "$2"
}
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }   # macOS bash 3.2 has no ${x,,}
commit_of() { sed 's/.*+//; s/-dirty$//'; }   # "0.1.0+96b66a53f" -> 96b66a53f
same_build() { [[ -n "$1" && -n "$2" && ( "$1" == "$2"* || "$2" == "$1"* ) ]]; }   # short ids differ in length per clone

THIS_HOST="$(hostname)"
NEW_ID="$(cd "$TOOLS" && git rev-parse --short HEAD)"
[[ -z "$(cd "$TOOLS" && git status --porcelain -- dbench)" ]] || die "tools/dbench has uncommitted changes: commit them first, so the build is a commit"

# What each node needs, decided before anything is built.
declare -a TODO=()
for node in "$@"; do
  os="$(field "$node" os)"; arch="$(field "$node" arch)"
  [[ -n "$os" && -n "$arch" ]] || die "$node: not in \`dbench nodes\`, or not answering"
  host="$(nodes_json | python3 -I -c 'import json,sys; print(((json.load(sys.stdin).get(sys.argv[1]) or {}).get("node") or {}).get("hostname") or "")' "$node")"
  [[ "$(lower "$host")" != "$(lower "$THIS_HOST")" ]] || die "$node is this Mac: use ops/dbench/install.sh"
  have="$(field "$node" dbench_version | commit_of)"
  if same_build "$have" "$NEW_ID"; then echo "$node: already on $NEW_ID"; continue; fi
  TODO+=("$node:$os:$arch")
done
[[ ${#TODO[@]} -gt 0 ]] || { echo "nothing to do"; exit 0; }

binary_for() { # os arch -> the built binary's path
  case "$1/$2" in
    macos/aarch64) echo "$TOOLS/target/release/dbench" ;;
    linux/x86_64|linux/aarch64) echo "$TOOLS/target/$2-unknown-linux-gnu/dist/dbench" ;;
    *) return 1 ;;
  esac
}
built=" "
for t in "${TODO[@]}"; do
  IFS=: read -r node os arch <<< "$t"
  binary_for "$os" "$arch" > /dev/null || die "$node: no build for $os/$arch"
  [[ "$built" == *" $os/$arch "* ]] && continue
  echo "building dbench for $os/$arch"
  if [[ "$os" == macos ]]; then (cd "$TOOLS" && cargo build --release -p dbench); else "$TOOLS/dbench/build-linux.sh" "$arch"; fi
  [[ -f "$(binary_for "$os" "$arch")" ]] || die "the build for $os/$arch did not produce $(binary_for "$os" "$arch")"
  built+="$os/$arch "
done

# The commands run on the node, as one bash script on stdin (a node's login shell may be zsh).
remote_swap() { # os relative-binary-path
  cat <<REMOTE
set -euo pipefail
cd "\$HOME"
bin="$2"
chmod 755 "\$bin.incoming"
[[ "$1" != macos ]] || codesign -s - --force "\$bin.incoming"
if [[ -e "\$bin" ]]; then
  old="\$("\$bin" --version 2>/dev/null | awk '{print \$2}' | sed 's/.*+//' || true)"
  cp -p "\$bin" "\$bin.before-\${old:-\$(date +%Y%m%d%H%M%S)}"
fi
mv -f "\$bin.incoming" "\$bin"
if [[ "$1" == macos ]]; then launchctl kickstart -k "gui/\$(id -u)/$MAC_LABEL"; else systemctl --user restart $LINUX_UNIT; fi
echo $SENTINEL
REMOTE
}

for t in "${TODO[@]}"; do
  IFS=: read -r node os arch <<< "$t"
  job="$(field "$node" current_job)"
  if [[ -n "$job" ]]; then
    echo "$node: skipped, job $job is running: \`$DBENCH hold $node --reason ...\`, wait for it to finish, run this again" >&2
    SKIPPED=1; continue
  fi
  held_before="$(field "$node" hold)"
  [[ -n "$held_before" ]] || "$DBENCH" hold "$node" --reason "$HOLD_REASON" > /dev/null
  job="$(field "$node" current_job)"
  if [[ -n "$job" ]]; then
    [[ -n "$held_before" ]] || "$DBENCH" release "$node" > /dev/null
    echo "$node: skipped, job $job started as it was being held" >&2
    SKIPPED=1; continue
  fi
  rel="$LINUX_BIN"; [[ "$os" == macos ]] && rel="$MAC_BIN"
  "${SCP[@]}" "$(binary_for "$os" "$arch")" "$node:$rel.incoming" || die "$node: copying the binary failed; the node is held"
  out="$(remote_swap "$os" "$rel" | "${SSH[@]}" "$node" bash -s 2>&1)" || true
  [[ "$out" == *"$SENTINEL"* ]] || die "$node: the swap on the node failed (the node is held): $out"
  waited=0
  until same_build "$(field "$node" dbench_version | commit_of)" "$NEW_ID" && [[ "$(field "$node" status)" == ok ]]; do
    (( waited >= VERSION_POLLS )) && die "$node: not answering with build $NEW_ID after the restart; the node is held"
    sleep "$VERSION_POLL_S"; waited=$((waited + 1))
  done
  if [[ -n "$held_before" ]]; then echo "$node: on $NEW_ID, still held ($held_before)"
  else "$DBENCH" release "$node" > /dev/null; echo "$node: on $NEW_ID, released"; fi
done
[[ -z "${SKIPPED:-}" ]] || exit 3
echo "done; this Mac last: ops/dbench/install.sh"

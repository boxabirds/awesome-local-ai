#!/usr/bin/env bash
# ops/dbench/rollout.sh: building dbench for the bench nodes and putting it in service there, one node at a time.
#
# Until 11 Nov 2026 the nodes got a new dbench by hand: a native build on thing1 copied to thing2, a cross-build for
# gruntus, a copy for quintus, each held, swapped, restarted and released by typed commands (the owner, 10 Nov 2026:
# "the whole process for building the 3 dbench apps should be in scripts not hand made").
#
# Stubs: dbench (the node list, hold, release), cargo and build-linux.sh (the builds), scp and ssh (a node is a
# directory; ssh runs the script it is given there and always exits 0, as quintus's does), and on the "node" codesign,
# launchctl and systemctl (a restart makes the node report the version of the binary now in place).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
ROLLOUT="$REPO_ROOT/ops/dbench/rollout.sh"
OLD=0.1.0+old1111

# node NAME OS ARCH [VERSION]: a node in the stub's list, with the old binary in place on it.
node() {
  local n="$1" os="$2" arch="$3" v="${4:-$OLD}" rel=.dbench/tools/bin/dbench
  [[ "$os" == macos ]] && rel=.local/bin/dbench
  mkdir -p "$T/nodes/$n" "$T/remote/$n/$(dirname "$rel")"
  echo "$os" > "$T/nodes/$n/os"; echo "$arch" > "$T/nodes/$n/arch"; echo "$v" > "$T/nodes/$n/version"; echo "$n" > "$T/nodes/$n/hostname"
  printf '#!/usr/bin/env bash\necho "dbench %s"\n' "$v" > "$T/remote/$n/$rel"; chmod +x "$T/remote/$n/$rel"
}

setup() { # -> $T: a committed checkout holding the script, stubs on PATH
  T="$(mktemp -d)"
  mkdir -p "$T/repo/ops/dbench" "$T/repo/tools/dbench/src" "$T/bin" "$T/remotebin" "$T/nodes"
  cp "$ROLLOUT" "$T/repo/ops/dbench/rollout.sh"
  echo "fn main() {}" > "$T/repo/tools/dbench/src/main.rs"
  # build-linux.sh ARCH: the dist build for that arch, a binary reporting the checkout's commit.
  cat > "$T/repo/tools/dbench/build-linux.sh" <<'STUB'
#!/usr/bin/env bash
here="$(cd "$(dirname "$0")" && pwd)"; echo "$1" >> "$here/../../build.log"
out="$here/../target/$1-unknown-linux-gnu/dist"; mkdir -p "$out"
printf '#!/usr/bin/env bash\necho "dbench 0.1.0+%s"\n' "$(git -C "$here" rev-parse --short HEAD)" > "$out/dbench"; chmod +x "$out/dbench"
STUB
  chmod +x "$T/repo/tools/dbench/build-linux.sh"
  (cd "$T/repo" && git init -q && git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -qm one)
  NEW="$(git -C "$T/repo" rev-parse --short HEAD)"
  cat > "$T/bin/cargo" <<STUB
#!/usr/bin/env bash
echo "cargo \$*" >> "$T/repo/build.log"
mkdir -p "\$PWD/target/release"
printf '#!/usr/bin/env bash\necho "dbench 0.1.0+$NEW"\n' > "\$PWD/target/release/dbench"; chmod +x "\$PWD/target/release/dbench"
STUB
  cat > "$T/bin/dbench" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$T/dbench.log"
N="$T/nodes"
case "\$1" in
  nodes) python3 -I - "\$N" <<'PY'
import json, os, sys
root = sys.argv[1]; out = {}
for n in sorted(os.listdir(root)):
    f = lambda k: open(os.path.join(root, n, k)).read().strip() if os.path.exists(os.path.join(root, n, k)) else None
    node = {"os": f("os"), "arch": f("arch"), "dbench_version": f("version"), "hostname": f("hostname")}
    if f("hold"): node["hold"] = {"reason": f("hold")}
    if f("job"): node["current_job"] = {"id": f("job")}
    out[n] = {"url": "http://x:7717", "status": "ok", "node": node}
print(json.dumps(out))
PY
  ;;
  hold) echo "\$4" > "\$N/\$2/hold"; [[ -e "$T/job-on-hold.\$2" ]] && cp "$T/job-on-hold.\$2" "\$N/\$2/job"; true ;;
  release) rm -f "\$N/\$2/hold" ;;
esac
STUB
  cat > "$T/bin/scp" <<STUB
#!/usr/bin/env bash
src="\${@: -2:1}"; dst="\${@: -1}"; cp "\$src" "$T/remote/\${dst%%:*}/\${dst#*:}"
STUB
  cat > "$T/bin/ssh" <<STUB
#!/usr/bin/env bash
host="\${@: -3:1}"; echo "\$host" >> "$T/ssh.log"
HOME="$T/remote/\$host" PATH="$T/remotebin:\$PATH" NODE="\$host" NODES="$T/nodes" bash -s 2>&1
exit 0
STUB
  # On the node: a restart makes it report the binary now in place, unless the test says it never comes back.
  cat > "$T/remotebin/restart" <<'STUB'
#!/usr/bin/env bash
echo "$NODE $*" >> "$NODES/../restart.log"
[[ -e "$NODES/../dead.$NODE" ]] && exit 0
"$HOME/$1" --version | awk '{print $2}' > "$NODES/$NODE/version"
STUB
  printf '#!/usr/bin/env bash\n[[ "$1" == kickstart ]] && exec restart .local/bin/dbench launchctl\n' > "$T/remotebin/launchctl"
  printf '#!/usr/bin/env bash\n[[ -e "$NODES/../fail-restart.$NODE" ]] && exit 1\nexec restart .dbench/tools/bin/dbench systemctl\n' > "$T/remotebin/systemctl"
  printf '#!/usr/bin/env bash\necho "$NODE ${@: -1}" >> "$NODES/../codesign.log"\n' > "$T/remotebin/codesign"
  chmod +x "$T"/bin/* "$T"/remotebin/*
}
run_rollout() { PATH="$T/bin:$PATH" ROLLOUT_VERSION_POLLS=3 ROLLOUT_VERSION_POLL_S=0 bash "$T/repo/ops/dbench/rollout.sh" "$@" > "$T/out.log" 2>&1; }
ver() { cat "$T/nodes/$1/version"; }
remote_ver() { "$T/remote/$1/$2" --version; }

echo "the script"
assert_ok "it exists and parses" bash -n "$ROLLOUT"
assert_eq "it holds no home directory" "0" "$(grep -c '/Users/' "$ROLLOUT" || true)"
assert_eq "it names no node" "0" "$(grep -cE 'thing1|thing2|gruntus|quintus' "$ROLLOUT" || true)"

echo "a rollout to both idle Sparks, gruntus and quintus"
setup
node thing1 linux aarch64; node thing2 linux aarch64; node gruntus linux x86_64; node quintus macos aarch64
run_rollout thing1 thing2 gruntus quintus; RC=$?
assert_eq "it succeeds" "0" "$RC"
assert_eq "thing1 answers with the new build" "0.1.0+$NEW" "$(ver thing1)"
assert_eq "gruntus too" "0.1.0+$NEW" "$(ver gruntus)"
assert_eq "quintus too" "0.1.0+$NEW" "$(ver quintus)"
assert_eq "thing2 too, from the same build" "0.1.0+$NEW" "$(ver thing2)"
assert_eq "the Spark's binary is the aarch64 Linux build" "dbench 0.1.0+$NEW" "$(remote_ver thing1 .dbench/tools/bin/dbench)"
assert_ok "built for each kind of node on this Mac, once each" bash -c 'diff <(sort "$1") <(printf "aarch64\ncargo build --release -p dbench\nx86_64\n")' _ "$T/repo/build.log"
assert_eq "the old binary is kept on the node, named for its build" "dbench $OLD" "$(remote_ver thing1 .dbench/tools/bin/dbench.before-old1111)"
assert_eq "(on quintus too)" "dbench $OLD" "$(remote_ver quintus .local/bin/dbench.before-old1111)"
assert_fails "no incoming copy is left on a node" test -e "$T/remote/gruntus/.dbench/tools/bin/dbench.incoming"
assert_ok "the Mac's binary is signed on the node before it replaces the old" grep -qx "quintus .local/bin/dbench.incoming" "$T/codesign.log"
assert_fails "a Linux binary is not" grep -q "thing1" "$T/codesign.log"
assert_ok "a Mac node is restarted by launchd" grep -qx "quintus .local/bin/dbench launchctl" "$T/restart.log"
assert_ok "a Linux node by systemd" grep -qx "thing1 .dbench/tools/bin/dbench systemctl" "$T/restart.log"
assert_ok "each node is held before it is touched" bash -c 'grep -n "^hold thing1" "$1" | head -1 | cut -d: -f1 | { read h; [[ $h -lt $(grep -n "^release thing1" "$1" | cut -d: -f1) ]]; }' _ "$T/dbench.log"
assert_eq "and released after: no node is left held" "0" "$(find "$T/nodes" -name hold | wc -l | tr -d ' ')"
assert_ok "one node at a time: thing1 is released before gruntus is held" bash -c '[[ $(grep -n "^release thing1" "$1" | cut -d: -f1) -lt $(grep -n "^hold gruntus" "$1" | cut -d: -f1) ]]' _ "$T/dbench.log"
assert_ok "it says this Mac goes last" grep -q "ops/dbench/install.sh" "$T/out.log"
rm -rf "$T"

echo "a node already on this build"
setup
node thing2 linux aarch64 "0.1.0+${NEW:0:7}"
run_rollout thing2; RC=$?
assert_eq "it succeeds" "0" "$RC"
assert_ok "it says so (a shorter id of the same commit is the same build)" grep -q "thing2: already on" "$T/out.log"
assert_fails "nothing is built" test -e "$T/repo/build.log"
assert_fails "the node is not held" grep -q "^hold" "$T/dbench.log"
rm -rf "$T"

echo "a node with a job running, and an idle one"
setup
node gruntus linux x86_64; node thing1 linux aarch64
echo "vidi-strata-r5" > "$T/nodes/gruntus/job"
run_rollout gruntus thing1; RC=$?
assert_eq "it ends with an exit that says a node was skipped" "3" "$RC"
assert_ok "and names the job" grep -q "vidi-strata-r5" "$T/out.log"
assert_eq "the busy node keeps its binary" "dbench $OLD" "$(remote_ver gruntus .dbench/tools/bin/dbench)"
assert_fails "and is not held" grep -q "^hold gruntus" "$T/dbench.log"
assert_eq "the idle node is done" "0.1.0+$NEW" "$(ver thing1)"
rm -rf "$T"

echo "a job that starts as the node is being held"
setup
node thing1 linux aarch64
echo "vidi-late" > "$T/job-on-hold.thing1"
run_rollout thing1; RC=$?
assert_eq "the node is skipped" "3" "$RC"
assert_eq "its binary is untouched" "dbench $OLD" "$(remote_ver thing1 .dbench/tools/bin/dbench)"
assert_eq "and the hold this script set is taken off" "0" "$(find "$T/nodes" -name hold | wc -l | tr -d ' ')"
rm -rf "$T"

echo "a node the owner held before"
setup
node gruntus linux x86_64
echo "paused for ACE-Step tests" > "$T/nodes/gruntus/hold"
run_rollout gruntus; RC=$?
assert_eq "it succeeds" "0" "$RC"
assert_eq "the node is on the new build" "0.1.0+$NEW" "$(ver gruntus)"
assert_eq "and still held, for the owner's reason" "paused for ACE-Step tests" "$(cat "$T/nodes/gruntus/hold" 2>/dev/null)"
assert_fails "the script neither held nor released it" grep -qE "^(hold|release) gruntus" "$T/dbench.log"
rm -rf "$T"

echo "a swap that fails on the node"
setup
node thing1 linux aarch64; node thing2 linux aarch64
touch "$T/fail-restart.thing1"
run_rollout thing1 thing2; RC=$?
assert_fails "the rollout fails (the node's ssh said 0; the missing success line is what counts)" test "$RC" = "0"
assert_ok "it says the swap failed, from the node's missing success line" grep -q "thing1: the swap on the node failed" "$T/out.log"
assert_ok "the failed node is left held" test -e "$T/nodes/thing1/hold"
assert_fails "the rollout stops: the next node is not touched" grep -q "thing2" "$T/ssh.log"
rm -rf "$T"

echo "a node that does not come back on the new build"
setup
node thing1 linux aarch64
touch "$T/dead.thing1"
run_rollout thing1; RC=$?
assert_fails "the rollout fails" test "$RC" = "0"
assert_ok "and says so" grep -q "not answering with build" "$T/out.log"
assert_ok "the node is left held" test -e "$T/nodes/thing1/hold"
rm -rf "$T"

echo "refusals"
setup
node thing1 linux aarch64
run_rollout; RC=$?
assert_eq "no node named: usage" "2" "$RC"
node this-mac macos aarch64; hostname > "$T/nodes/this-mac/hostname"
run_rollout this-mac; RC=$?
assert_fails "this Mac's own node is refused" test "$RC" = "0"
assert_ok "pointing at install.sh" grep -q "install.sh" "$T/out.log"
run_rollout nowhere; RC=$?
assert_fails "an unknown node is refused" test "$RC" = "0"
echo "// changed" >> "$T/repo/tools/dbench/src/main.rs"
run_rollout thing1; RC=$?
assert_fails "uncommitted changes to dbench are refused: the build must be a commit" test "$RC" = "0"
assert_fails "and nothing is built" test -e "$T/repo/build.log"
rm -rf "$T"

finish

#!/usr/bin/env bash
# The LaunchAgents that keep the benchmarker (port 7760) and the review server vidi-gallery (port 7800) running.
#
# On 10 Oct 2026 the Judge button stopped working because nothing was listening on 7800: the review server had been started by hand
# and had gone. The benchmarker had been started the same way. ops/services/install.sh writes a launchd job for each, kept alive,
# generated for this user at install time (a stored plist would carry one user's home directory into the repository).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
INSTALL="$REPO_ROOT/ops/services/install.sh"

echo "the installer"
assert_ok "it exists and parses" bash -n "$INSTALL"
assert_eq "an unknown service is refused (exit 2)" "2" "$(bash "$INSTALL" nonsense --print >/dev/null 2>&1; echo $?)"

plist_of() { bash "$INSTALL" "$1" --print; }
key() { # plist-text keypath
  printf '%s' "$1" | plutil -extract "$2" raw -o - - 2>/dev/null
}

for svc in benchmarker gallery; do
  echo "$svc: the job"
  P="$(plist_of "$svc")"
  assert_ok "$svc: a valid plist" bash -c 'printf "%s" "$1" | plutil -lint - >/dev/null' _ "$P"
  assert_eq "$svc: labelled com.awesome-local-ai.$svc" "com.awesome-local-ai.$svc" "$(key "$P" Label)"
  assert_eq "$svc: restarted whenever it exits (KeepAlive)" "true" "$(key "$P" KeepAlive)"
  assert_eq "$svc: starts at load" "true" "$(key "$P" RunAtLoad)"
  assert_ok "$svc: a restart delay, so a crash loop cannot spin" bash -c '[[ "$(printf "%s" "$1" | plutil -extract ThrottleInterval raw -o - - 2>/dev/null)" -ge 5 ]]' _ "$P"
  assert_ok "$svc: logs to files under the repo's ops state, not /tmp" bash -c 'printf "%s" "$1" | grep -q "ops/service-state/com.awesome-local-ai.'"$svc"'"' _ "$P"
  assert_ok "$svc: its PATH holds the directory of bun and cargo's tools it needs" bash -c 'printf "%s" "$1" | grep -q "$(dirname "$(command -v bun)")"' _ "$P"
done

B="$(plist_of benchmarker)"; G="$(plist_of gallery)"
echo "the benchmarker"
assert_ok "runs server/main.ts with bun" bash -c 'printf "%s" "$1" | grep -q "server/main.ts"' _ "$B"
assert_ok "serves port 7760" bash -c 'printf "%s" "$1" | grep -A1 -- "--port" | grep -q 7760' _ "$B"
assert_ok "starts in tools/benchmarker" bash -c 'printf "%s" "$1" | grep -A1 WorkingDirectory | grep -q "tools/benchmarker"' _ "$B"
assert_ok "reads this repository" bash -c 'printf "%s" "$1" | grep -A1 -- "--repo" | grep -q "'"$REPO_ROOT"'"' _ "$B"

assert_ok "its PATH holds the directory of dbench (it runs \`dbench status\` for the live jobs: without it the page has no running or queued job)" bash -c 'printf "%s" "$1" | grep -q "$(dirname "$(command -v dbench)")"' _ "$B"
assert_ok "its PATH holds the directory of git (it reads the run records with git)" bash -c 'printf "%s" "$1" | grep -q "$(dirname "$(command -v git)")"' _ "$B"

echo "the review server"
assert_ok "runs the release build of vidi-gallery" bash -c 'printf "%s" "$1" | grep -q "tools/vidi-gallery/target/release/vidi-gallery"' _ "$G"
assert_ok "serves port 7800" bash -c 'printf "%s" "$1" | grep -A1 -- "--port" | grep -q 7800' _ "$G"

echo "the two agree"
JUDGE_PORT="$(printf '%s' "$B" | sed -n 's|.*http://127\.0\.0\.1:\([0-9][0-9]*\)/review.*|\1|p')"
assert_eq "the Judge link in the benchmarker points at the port the review server listens on" "7800" "$JUDGE_PORT"

echo "printing installs nothing"
T="$(mktemp -d)"
HOME="$T" bash "$INSTALL" all --print >/dev/null 2>&1
assert_eq "--print writes no LaunchAgents" "0" "$(find "$T" -name '*.plist' | wc -l | tr -d ' ')"
rm -rf "$T"

echo "reinstalling while launchd is still tearing the old job down"
# Found installing on 10 Oct 2026: `launchctl bootout` returns before the job is gone, and a `bootstrap` straight after it fails with
# "Input/output error", leaving the service not running. The installer waits for the label to go. launchctl is a stub here whose job
# stays listed for the first few `print` calls after a bootout, and whose bootstrap fails while it is listed.
T="$(mktemp -d)"; mkdir -p "$T/repo/ops/services" "$T/repo/tools/benchmarker/dist" "$T/repo/tools/vidi-gallery/target/release" "$T/bin" "$T/home"
cp "$INSTALL" "$T/repo/ops/services/install.sh"; : > "$T/repo/tools/benchmarker/dist/index.html"; : > "$T/repo/tools/vidi-gallery/target/release/vidi-gallery"
cat > "$T/bin/launchctl" <<'STUB'
#!/usr/bin/env bash
state="$STUB_DIR/listed"; log="$STUB_DIR/calls"
echo "$*" >> "$log"
case "$1" in
  bootout) echo 3 > "$state"; exit 0 ;;
  print)   n=$(cat "$state" 2>/dev/null || echo 0); if (( n > 0 )); then echo $((n-1)) > "$state"; echo "pid = 1"; exit 0; fi; exit 113 ;;
  bootstrap) n=$(cat "$state" 2>/dev/null || echo 0); if (( n > 0 )); then echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; fi; echo ok > "$STUB_DIR/bootstrapped"; exit 0 ;;
esac
STUB
printf '#!/usr/bin/env bash\nexit 1\n' > "$T/bin/lsof"; chmod +x "$T/bin/launchctl" "$T/bin/lsof"
OUT="$(STUB_DIR="$T" HOME="$T/home" PATH="$T/bin:$PATH" bash "$T/repo/ops/services/install.sh" gallery 2>&1)"; RC=$?
assert_eq "the install succeeds" "0" "$RC"
assert_ok "the job was bootstrapped after the old one had gone" test -e "$T/bootstrapped"
rm -rf "$T"

echo "nothing machine-specific is stored"
assert_eq "the installer holds no home directory" "0" "$(grep -c '/Users/' "$INSTALL" || true)"

echo
if (( TESTS_FAILED )); then echo "$TESTS_FAILED of $TESTS_RUN checks FAILED"; exit 1; fi
echo "all $TESTS_RUN checks passed"

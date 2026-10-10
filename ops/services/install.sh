#!/usr/bin/env bash
# install.sh [benchmarker|gallery|all] [--print] -- LaunchAgents that keep the benchmarker and the review server running on this Mac.
#
#   benchmarker  com.awesome-local-ai.benchmarker  bun server/main.ts, port 7760 (the app; its Judge button opens the review server)
#   gallery      com.awesome-local-ai.gallery      tools/vidi-gallery's release build, port 7800 (the story review page behind the Judge button)
#
# Both are KeepAlive: launchd starts them at login and restarts them whenever they exit, after THROTTLE_S seconds. The plists are generated here
# for this user and written to ~/Library/LaunchAgents; nothing machine-specific is in the repo. `--print` shows a plist without installing it.
# Logs: ops/service-state/<label>.{out,err}.log (git-ignored). Other agents under com.awesome-local-ai.* are not touched.
#
# Before installing: build what each runs (`bun run build` in tools/benchmarker; `cargo build --release` in tools/vidi-gallery), and stop a copy
# started by hand, which would hold the port. The installer refuses, saying which, rather than starting a second copy that cannot bind.
#
#   stop:    launchctl bootout gui/$(id -u)/com.awesome-local-ai.benchmarker   (and .gallery)
#   restart: launchctl kickstart -k gui/$(id -u)/com.awesome-local-ai.benchmarker
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WHAT="${1:-all}"; PRINT="${2:-}"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$REPO/ops/service-state"
BENCH_PORT=7760
GALLERY_PORT=7800
THROTTLE_S=10
TEARDOWN_POLLS=75      # launchd returns from bootout before the job is gone; a bootstrap straight after it fails (Input/output error)
TEARDOWN_POLL_S=0.2    # so wait up to TEARDOWN_POLLS x TEARDOWN_POLL_S (15 s) for the label to go
LOOPBACK=127.0.0.1
BENCH_DIR="$REPO/tools/benchmarker"
GALLERY_BIN="$REPO/tools/vidi-gallery/target/release/vidi-gallery"

# launchd starts with a bare PATH: give the agents the directories of the tools they call, found now. The benchmarker runs `dbench` (the live
# jobs and the queue) and `git` (the run records); without dbench on its PATH it shows every run with no job.
tool_dirs() {
  local d out=""
  for t in "$@"; do
    d="$(dirname "$(command -v "$t")")" || { echo "install.sh: $t not found on PATH" >&2; exit 1; }
    case ":$out:" in *":$d:"*) ;; *) out="${out:+$out:}$d" ;; esac
  done
  printf '%s:/usr/bin:/bin:/usr/sbin:/sbin' "$out"
}

plist() { # label workdir path program-argument...
  local label="$1" workdir="$2" path="$3"; shift 3
  local args="" a
  for a in "$@"; do args+="<string>$a</string>"; done
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>$args</array>
  <key>WorkingDirectory</key><string>$workdir</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>$THROTTLE_S</integer>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$path</string><key>HOME</key><string>$HOME</string></dict>
  <key>StandardOutPath</key><string>$LOGS/$label.out.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$label.err.log</string>
</dict>
</plist>
PLIST
}

holder() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }

install_one() { # label port prerequisite-file workdir path program-argument...
  local label="$1" port="$2" need="$3"; shift 3
  if [[ "$PRINT" == "--print" ]]; then plist "$label" "$@"; return; fi
  [[ -e "$need" ]] || { echo "install.sh: $need is missing: build it first (see the header of this script)" >&2; exit 1; }
  local pid; pid="$(holder "$port")"
  if [[ -n "$pid" ]] && ! launchctl print "gui/$(id -u)/$label" 2>/dev/null | grep -q "pid = $pid"; then
    echo "install.sh: port $port is held by pid $pid, which launchd did not start: stop it first, then run this again" >&2; exit 1
  fi
  mkdir -p "$AGENTS" "$LOGS"
  plist "$label" "$@" > "$AGENTS/$label.plist"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  local waited=0
  while launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; do
    (( waited >= TEARDOWN_POLLS )) && { echo "install.sh: $label did not stop in time" >&2; exit 1; }
    sleep "$TEARDOWN_POLL_S"; waited=$((waited + 1))
  done
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
  echo "installed $label (port $port)"
}

case "$WHAT" in benchmarker|gallery|all) ;; *) echo "usage: $0 [benchmarker|gallery|all] [--print]" >&2; exit 2 ;; esac
if [[ "$WHAT" == benchmarker || "$WHAT" == all ]]; then
  BUN="$(command -v bun)" || { echo "install.sh: bun not found on PATH" >&2; exit 1; }
  install_one com.awesome-local-ai.benchmarker "$BENCH_PORT" "$BENCH_DIR/dist/index.html" "$BENCH_DIR" "$(tool_dirs bun git dbench)" \
    "$BUN" server/main.ts --repo "$REPO" --port "$BENCH_PORT" --judge-url "http://$LOOPBACK:$GALLERY_PORT/review"
fi
if [[ "$WHAT" == gallery || "$WHAT" == all ]]; then
  install_one com.awesome-local-ai.gallery "$GALLERY_PORT" "$GALLERY_BIN" "$REPO" "$(tool_dirs bun git)" \
    "$GALLERY_BIN" --repo "$REPO" --port "$GALLERY_PORT"
fi

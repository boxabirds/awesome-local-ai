#!/usr/bin/env python3
"""Sample macOS thermal pressure to a JSONL so decode rates can be audited.

Why: this machine sits at `heavy` under sustained inference -- every
metrics.json under opencode-omlx/results records "heavy throughout" -- and the
harness there measured ~20% monotonic drift across a session. A model A/B run
as separate blocks can manufacture or erase a difference of that size, so a
throughput number without a thermal level beside it is not auditable.

Reads the Darwin notification `com.apple.system.thermalpressurelevel` via
bench_harness.thermal_pressure(): no sudo, and it distinguishes `moderate` from
`heavy` where ProcessInfo.thermalState does not. `pmset -g therm` reports
nothing at all on Apple Silicon.

Usage:
  thermal-log.py &                      # sample until killed
  thermal-log.py --interval 5           # custom cadence
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# Resolve sibling harness modules regardless of the working directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from thermal import thermal_pressure  # noqa: E402

LOG_PATH = Path.home() / ".mtplx" / "logs" / "thermal.jsonl"
# MacThrottle polls at 2s; matching it keeps the two views comparable without
# generating a line per second for sessions that run for hours.
DEFAULT_INTERVAL_S = 2.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=DEFAULT_INTERVAL_S)
    ap.add_argument("--path", default=str(LOG_PATH))
    args = ap.parse_args()

    path = Path(args.path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Only transitions are written. A level held for an hour is one line plus
    # the heartbeat, and the reader interpolates: a request's level is the last
    # sample at or before it started.
    last = None
    with path.open("a") as fh:
        while True:
            level = thermal_pressure()
            now = time.time()
            if level != last:
                fh.write(json.dumps({"ts": now, "level": level}) + "\n")
                fh.flush()
                last = level
            time.sleep(args.interval)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        pass

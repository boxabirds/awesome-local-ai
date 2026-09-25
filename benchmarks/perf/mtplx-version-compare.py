#!/usr/bin/env python3
"""Compare two mtplx_throughput.py result files, usually two MTPLX versions.

The question: did upgrading change throughput on this machine, for this model?

The answer is usually "cannot tell", and saying so is the point. A point
release moving decode throughput by more than this machine's measured drift
floor (20%) would be extraordinary; anything smaller is indistinguishable from
the run-to-run variation that floor was derived from. A comparison that reports
"+3.1% faster" from two single samples is not a finding, it is noise with a
sign.

Usage:
    mtplx-version-compare.py before.json after.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from thermal import DRIFT_FLOOR_PCT, MAX_IQR_PCT  # noqa: E402


def key(run: dict) -> tuple:
    return (run.get("prompt_tokens"), run.get("mode"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("before")
    ap.add_argument("after")
    args = ap.parse_args()

    a = json.loads(Path(args.before).read_text())
    b = json.loads(Path(args.after).read_text())

    print(f"before : {a.get('label')}  mtplx {a.get('mtplx_version','?')}  "
          f"repeats={a.get('repeats','?')}  thermal={a.get('thermal_start','?')}")
    print(f"after  : {b.get('label')}  mtplx {b.get('mtplx_version','?')}  "
          f"repeats={b.get('repeats','?')}  thermal={b.get('thermal_start','?')}")
    if a.get("model_id") != b.get("model_id"):
        print(f"\nREFUSING: different models ({a.get('model_id')} vs {b.get('model_id')}).")
        print("This compares versions; the model must be held constant.")
        return 2
    print()

    ai = {key(r): r for r in a.get("runs", [])}
    bi = {key(r): r for r in b.get("runs", [])}
    shared = [k for k in ai if k in bi]
    if not shared:
        print("No comparable (context, mode) cells.")
        return 2

    print(f"{'ctx':>8} {'mode':>5} {'before':>9} {'after':>9} {'delta':>8} "
          f"{'spread':>14}  verdict")
    blockers, movers = [], []
    for k in sorted(shared, key=lambda x: (x[0] or 0, x[1])):
        ra, rb = ai[k], bi[k]
        da, db = ra.get("decode_tok_s"), rb.get("decode_tok_s")
        if not da or not db:
            print(f"{k[0]:>8} {k[1]:>5} {'-':>9} {'-':>9} {'-':>8} {'-':>14}  no data")
            continue
        delta = (db - da) / da * 100
        spread = f"{ra.get('iqr_pct','?')}%/{rb.get('iqr_pct','?')}%"

        if ra.get("iqr_exceeds_floor") or rb.get("iqr_exceeds_floor"):
            verdict = f"UNUSABLE (spread > {MAX_IQR_PCT}%)"
            blockers.append(f"{k[0]} {k[1]}: spread {spread} exceeds {MAX_IQR_PCT}%")
        elif abs(delta) < DRIFT_FLOOR_PCT:
            verdict = f"no change (< {DRIFT_FLOOR_PCT}% floor)"
        else:
            verdict = "MOVED"
            movers.append(f"{k[0]} {k[1]}: {delta:+.1f}%")

        print(f"{k[0]:>8} {k[1]:>5} {da:>9.2f} {db:>9.2f} {delta:>+7.1f}% "
              f"{spread:>14}  {verdict}")

    print()
    if blockers:
        print("NOT CONCLUSIVE — the runs are too unstable to compare:")
        for x in blockers:
            print(f"  - {x}")
        return 1
    if not movers:
        print(f"NO MEASURABLE DIFFERENCE. Every cell moved less than this machine's")
        print(f"{DRIFT_FLOOR_PCT}% drift floor, so nothing here distinguishes the two versions.")
        print("That is a result: the upgrade did not change throughput measurably.")
        return 0
    print("MOVED beyond the drift floor:")
    for x in movers:
        print(f"  - {x}")
    print("\nWorth re-running before believing: a real change should reproduce.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

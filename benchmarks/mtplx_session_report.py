#!/usr/bin/env python3
"""Real-world throughput report from MTPLX's own request log.

Why this and not throughput-bench.py: that script drives synthetic prompts at
a known context size, which is right for controlled A/B but wrong for "what do
I actually get in a coding session". Agent traffic has tool schemas, growing
multi-turn prefixes, reasoning tokens and warm-cache restores that no synthetic
prompt reproduces. MTPLX already records all of it per request, so the honest
measurement is: use the model normally, then read the log.

The log is one JSONL line per request at ~/.mtplx/logs/request-log-<port>.jsonl
with 330 fields. Each line carries `served_model_id`, so several models can
share one port/log and still be separated cleanly.

Usage:
  session-report.py                          # all models, all history
  session-report.py --since 2h               # last 2 hours only
  session-report.py --compare                # side-by-side model table
  session-report.py --model mtplx-flash-next-optimized-speed
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

# Single source of truth for this machine's measured noise floors. Duplicating
# the numbers here would let them drift apart from the harness that calibrated
# them against real repeated runs.
# Resolve sibling harness modules regardless of the working directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from thermal import DRIFT_FLOOR_PCT, MAX_IQR_PCT
except ImportError:  # harness not present; report without the verdict gate
    DRIFT_FLOOR_PCT = MAX_IQR_PCT = None

LOG_DIR = Path.home() / ".mtplx" / "logs"
THERMAL_LOG = LOG_DIR / "thermal.jsonl"
# Ordered worst-last so a mixed window reports the worst level it saw, matching
# ThermalWatch.level in benchmarks/thermal.py.
THERMAL_ORDER = ["nominal", "moderate", "heavy", "trapping", "sleeping"]

# A request shorter than this is a warmup ping or a one-word reply: decode rate
# over a handful of tokens is dominated by per-request overhead and reads far
# too high. Ignoring them is the difference between "112 tok/s" and the truth.
MIN_COMPLETION_TOKENS = 100
# Restores below this are incidental (a few tokens of shared system prompt),
# not the warm-prefix path that actually changes decode speed.
MIN_CACHED_TOKENS = 500
SECONDS_PER = {"m": 60, "h": 3600, "d": 86400}


def parse_since(spec: str | None) -> float:
    if not spec:
        return 0.0
    unit = spec[-1].lower()
    if unit not in SECONDS_PER:
        raise SystemExit(f"--since needs a unit m/h/d, got {spec!r}")
    return time.time() - float(spec[:-1]) * SECONDS_PER[unit]


def load(port: str | None, since: float) -> list[dict]:
    pattern = f"request-log-{port}.jsonl" if port else "request-log-*.jsonl"
    rows: list[dict] = []
    for path in sorted(LOG_DIR.glob(pattern)):
        for line in path.read_text(errors="ignore").splitlines():
            if not line.strip():
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("decode_tok_s") and r.get("logged_at_s", 0) >= since:
                rows.append(r)
    return rows


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(p / 100 * len(ordered)))]


def load_thermal() -> list[tuple[float, str]]:
    """Transition samples from thermal-log.py, oldest first."""
    if not THERMAL_LOG.exists():
        return []
    out = []
    for line in THERMAL_LOG.read_text(errors="ignore").splitlines():
        if not line.strip():
            continue
        try:
            d = json.loads(line)
            out.append((d["ts"], d["level"]))
        except (json.JSONDecodeError, KeyError):
            continue
    return sorted(out)


def thermal_over(samples: list[tuple[float, str]], start: float,
                 end: float) -> str:
    """Worst level seen across [start, end], or 'unsampled'.

    The sampler writes transitions only, so the level in force at `start` is
    the last sample at or before it -- not the first sample inside the window.
    """
    if not samples:
        return "unsampled"
    seen = [lvl for ts, lvl in samples if start <= ts <= end]
    prior = [lvl for ts, lvl in samples if ts <= start]
    if prior:
        seen.append(prior[-1])
    if not seen:
        return "unsampled"
    return max(seen, key=lambda s: THERMAL_ORDER.index(s)
               if s in THERMAL_ORDER else 0)


def drift_pct(rows: list[dict]) -> float:
    """Percent change in median decode from the first half to the second.

    Chronological, so a monotonic slide shows up as a signed number. The
    harness measured ~20% of this across a session on this machine, which is
    why a model comparison below that gap cannot be called.
    """
    ordered = sorted(rows, key=lambda r: r.get("logged_at_s", 0))
    if len(ordered) < 4:
        return 0.0
    h = len(ordered) // 2
    a = statistics.median([r["decode_tok_s"] for r in ordered[:h]])
    b = statistics.median([r["decode_tok_s"] for r in ordered[h:]])
    return 100.0 * (b - a) / a if a else 0.0



CONTEXT_BANDS = [(0, 20000), (20000, 45000), (45000, 75000),
                 (75000, 130000), (130000, 10**9)]
# A cell with fewer than this is noise; the medians move by more than the
# effect being measured.
MIN_CELL = 3


def annotate(rows: list[dict], thermal: list[tuple[float, str]]) -> list[dict]:
    """Attach thermal level and effective rate to each scored request."""
    out = []
    for r in rows:
        if (r.get("completion_tokens") or 0) < MIN_COMPLETION_TOKENS:
            continue
        span = (r.get("ttft_s") or 0.0) + (r.get("decode_elapsed_s") or 0.0)
        end = r.get("logged_at_s") or 0
        r = dict(r)
        r["_thermal"] = thermal_over(thermal, end - span, end) if thermal else "unsampled"
        r["_effective"] = (r["completion_tokens"] / span) if span > 0 else 0.0
        out.append(r)
    return out


def band_label(ctx: int) -> str:
    for lo, hi in CONTEXT_BANDS:
        if lo <= ctx < hi:
            return f"{lo//1000}-{hi//1000}k" if hi < 10**9 else f"{lo//1000}k+"
    return "?"


def stratified(groups: dict[str, list[dict]], by_thermal: bool,
               by_context: bool) -> None:
    """Compare models within matched cells.

    The flat comparison is refused whenever the arms ran at different thermal
    levels or context sizes, which on this machine is always. Holding both
    fixed is the only way the numbers mean anything -- and it is what turned a
    "NOT CONCLUSIVE" +121% into a defensible 1.9x.
    """
    def cells(rows):
        out = {}
        for r in rows:
            key = ((r["_thermal"] if by_thermal else "any"),
                   (band_label(r.get("prompt_tokens") or 0) if by_context else "any"))
            out.setdefault(key, []).append(r)
        return out

    names = list(groups)
    per = {n: cells(v) for n, v in groups.items()}
    keys = sorted(set().union(*[set(c) for c in per.values()]),
                  key=lambda k: (THERMAL_ORDER.index(k[0])
                                 if k[0] in THERMAL_ORDER else 99, k[1]))
    head = f"{'thermal':>10}{'context':>10}"
    for n in names:
        head += f"{n.split('-')[-1][:9]:>11}{'eff':>7}{'n':>4}"
    if len(names) == 2:
        head += f"{'ratio':>8}"
    print(head)
    for k in keys:
        row = f"{k[0]:>10}{k[1]:>10}"
        meds = []
        for n in names:
            c = per[n].get(k, [])
            if len(c) < MIN_CELL:
                row += f"{'-':>11}{'-':>7}{len(c):>4}"
                meds.append(None)
                continue
            d = statistics.median([x["decode_tok_s"] for x in c])
            e = statistics.median([x["_effective"] for x in c])
            row += f"{d:>11.1f}{e:>7.1f}{len(c):>4}"
            meds.append(e)
        if len(names) == 2 and all(m is not None for m in meds) and meds[0]:
            row += f"{meds[1]/meds[0]:>7.2f}x"
        print(row)
    print(f"\n  cells with fewer than {MIN_CELL} requests are shown as '-'")


def summarise(rows: list[dict], thermal: list[tuple[float, str]] | None = None) -> dict:
    real = [r for r in rows
            if (r.get("completion_tokens") or 0) >= MIN_COMPLETION_TOKENS]
    warm = [r for r in real
            if (r.get("cached_tokens") or 0) >= MIN_CACHED_TOKENS]
    cold = [r for r in real if r not in warm]
    decode = [r["decode_tok_s"] for r in real]

    accepted = drafted = 0
    for r in real:
        by_depth = r.get("accepted_by_depth") or []
        accepted += sum(by_depth)
        drafted += (r.get("verify_calls") or 0) * max(1, r.get("mtp_depth") or 1)

    # Effective throughput: output tokens over the whole wall clock, prefill
    # included. This is what a person actually experiences, and on long agent
    # prompts it is dominated by TTFT rather than decode -- a 27k-token cold
    # prefill costs ~45s before the first token, which no decode rate recovers.
    # Decode alone ranks models the user would rank the other way round.
    effective = [
        (r.get("completion_tokens") or 0)
        / ((r.get("ttft_s") or 0.0) + (r.get("decode_elapsed_s") or 0.0))
        for r in real
        if ((r.get("ttft_s") or 0.0) + (r.get("decode_elapsed_s") or 0.0)) > 0
    ]
    # How much of each prompt the session bank restored instead of prefilling.
    restored = [
        (r.get("cached_tokens") or 0) / r["prompt_tokens"]
        for r in real if r.get("prompt_tokens")
    ]

    # Thermal level in force while these requests actually ran, and whether it
    # stayed put. A number measured across a nominal->heavy transition is not
    # comparable to one measured entirely at either level.
    levels = []
    if thermal:
        for r in real:
            end = r.get("logged_at_s") or 0
            span = (r.get("ttft_s") or 0.0) + (r.get("decode_elapsed_s") or 0.0)
            levels.append(thermal_over(thermal, end - span, end))
    # Requests that predate the sampler are unknown, not a distinct level.
    # Counting them as one made every historical window read as a spurious
    # "MIXED moderate>unsampled" thermal transition.
    known = [lvl for lvl in levels if lvl in THERMAL_ORDER]
    worst = (max(known, key=THERMAL_ORDER.index) if known else "unsampled")

    return {
        "requests_total": len(rows),
        "requests_scored": len(real),
        "thermal": worst,
        "thermal_coverage": len(known) / len(levels) if levels else 0.0,
        "thermal_uniform": len(set(known)) <= 1 if known else None,
        "thermal_levels": sorted(set(known), key=THERMAL_ORDER.index),
        "drift_pct": drift_pct(real),
        "iqr_pct": (100.0 * (pct(decode, 75) - pct(decode, 25))
                    / statistics.median(decode)) if decode else 0.0,
        "effective_median": statistics.median(effective) if effective else 0.0,
        "effective_p90": pct(effective, 90),
        "decode_median": statistics.median(decode) if decode else 0.0,
        "decode_p90": pct(decode, 90),
        "decode_max": max(decode) if decode else 0.0,
        "warm_n": len(warm),
        "warm_median": statistics.median(
            [r["decode_tok_s"] for r in warm]) if warm else 0.0,
        "cold_median": statistics.median(
            [r["decode_tok_s"] for r in cold]) if cold else 0.0,
        "ttft_median": statistics.median(
            [r.get("ttft_s") or 0 for r in real]) if real else 0.0,
        "ttft_p90": pct([r.get("ttft_s") or 0 for r in real], 90),
        "restored_median": statistics.median(restored) if restored else 0.0,
        "cache_hit_rate": len(warm) / len(real) if real else 0.0,
        "acceptance": accepted / drafted if drafted else 0.0,
        "output_tokens": sum(r.get("completion_tokens") or 0 for r in real),
    }


def print_model(name: str, s: dict) -> None:
    print(f"\n=== {name} ===")
    print(f"  requests            {s['requests_scored']} scored "
          f"({s['requests_total']} logged, short ones excluded)")
    print(f"  output tokens       {s['output_tokens']:,}")
    print(f"  EFFECTIVE tok/s     median {s['effective_median']:.1f}   "
          f"p90 {s['effective_p90']:.1f}      <- what you feel")
    print(f"  decode tok/s        median {s['decode_median']:.1f}   "
          f"p90 {s['decode_p90']:.1f}   max {s['decode_max']:.1f}")
    print(f"    cold prefix       median {s['cold_median']:.1f}")
    print(f"    warm prefix       median {s['warm_median']:.1f}  "
          f"(n={s['warm_n']}, {s['cache_hit_rate']*100:.0f}% of requests)")
    print(f"  TTFT                median {s['ttft_median']:.2f}s   "
          f"p90 {s['ttft_p90']:.2f}s")
    print(f"  prompt restored     median {s['restored_median']*100:.0f}% "
          f"(session bank vs prefill)")
    print(f"  draft acceptance    {s['acceptance']*100:.0f}%")
    if s["thermal_uniform"] is None:
        therm = "unsampled (start thermal-log.py to capture it)"
    else:
        uniform = ("uniform" if s["thermal_uniform"]
                   else f"MIXED {'>'.join(s['thermal_levels'])}")
        therm = (f"{s['thermal']} ({uniform}, "
                 f"{s['thermal_coverage']*100:.0f}% of requests sampled)")
    print(f"  thermal             {therm}")
    print(f"  drift               {s['drift_pct']:+.1f}% first half -> second"
          f"   IQR {s['iqr_pct']:.0f}%")


def verdict(ranked: list[tuple[str, dict]]) -> None:
    """State whether the top two are actually distinguishable.

    These arms are necessarily blocked (the models cannot co-reside, so they
    cannot be interleaved), which is the design benchmarks/thermal.py warns produces or
    erases differences the size of the drift. A gap that does not clear the
    machine's measured floors is a coin flip, and saying so is the point.
    """
    if DRIFT_FLOOR_PCT is None or len(ranked) < 2:
        return
    (na, a), (nb, b) = ranked[0], ranked[1]
    if not (a["effective_median"] and b["effective_median"]):
        return
    gap = 100.0 * (a["effective_median"] - b["effective_median"]) / b["effective_median"]
    print(f"\n  gap {na.split('-')[-1]} vs {nb.split('-')[-1]}: "
          f"{gap:+.0f}% effective tok/s")

    blockers = []
    if gap < DRIFT_FLOOR_PCT:
        blockers.append(f"gap {gap:.0f}% is under the machine's "
                        f"{DRIFT_FLOOR_PCT:.0f}% drift floor")
    for n, s in (ranked[0], ranked[1]):
        if s["iqr_pct"] > MAX_IQR_PCT:
            blockers.append(f"{n.split('-')[-1]} spread {s['iqr_pct']:.0f}% "
                            f"exceeds {MAX_IQR_PCT:.0f}%")
        if s["thermal_uniform"] is False:
            blockers.append(f"{n.split('-')[-1]} ran across mixed thermal "
                            f"({'>'.join(s['thermal_levels'])})")
    if {ranked[0][1]["thermal"], ranked[1][1]["thermal"]} > {"unsampled"} and \
            ranked[0][1]["thermal"] != ranked[1][1]["thermal"]:
        blockers.append(f"arms ran at different thermal levels "
                        f"({ranked[0][1]['thermal']} vs {ranked[1][1]['thermal']})")

    if blockers:
        print("  NOT CONCLUSIVE:")
        for b in blockers:
            print(f"    - {b}")
    else:
        print(f"  CONCLUSIVE: {na} is faster by {gap:.0f}%")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", help="only this port's log")
    ap.add_argument("--model", help="only this served_model_id")
    ap.add_argument("--since", help="window, e.g. 90m / 2h / 7d")
    ap.add_argument("--compare", action="store_true",
                    help="one row per model, for A/B")
    ap.add_argument("--by-thermal", action="store_true",
                    help="split each model by thermal pressure level")
    ap.add_argument("--by-context", action="store_true",
                    help="split each model by context size band")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    rows = load(args.port, parse_since(args.since))
    if args.model:
        rows = [r for r in rows if r.get("served_model_id") == args.model]
    if not rows:
        print("no matching requests logged")
        return 1

    grouped: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        grouped[r.get("served_model_id") or "unknown"].append(r)

    # A model whose requests were all sub-threshold has nothing to report;
    # printing an all-zero row invites reading it as "this model is slow".
    thermal = load_thermal()
    results = {m: s for m, s in
               ((m, summarise(v, thermal)) for m, v in grouped.items())
               if s["requests_scored"]}
    if not results:
        print(f"no requests with >={MIN_COMPLETION_TOKENS} completion tokens "
              f"in range ({sum(len(v) for v in grouped.values())} logged)")
        return 1

    if args.json:
        print(json.dumps(results, indent=2))
        return 0

    if args.by_thermal or args.by_context:
        # Drop models with nothing scoreable: an all-dash column suppresses the
        # ratio (which needs exactly two arms) and reads as a real comparison.
        ann = {m: a for m, a in
               ((m, annotate(v, thermal)) for m, v in grouped.items()) if a}
        if not ann:
            print("no scoreable requests in range")
            return 1
        stratified(ann, args.by_thermal, args.by_context)
        return 0

    if args.compare:
        # Ranked by effective tok/s: prefill is part of the wall clock a person
        # waits through, so decode alone can rank two models backwards.
        print(f"{'model':34}{'n':>4}{'EFFECT':>8}{'decode':>8}{'TTFT':>7}"
              f"{'restored':>9}{'accept%':>8}{'thermal':>10}{'drift':>8}")
        ranked = sorted(results.items(),
                        key=lambda x: -x[1]["effective_median"])
        for m, s in ranked:
            print(f"{m[:33]:34}{s['requests_scored']:>4}"
                  f"{s['effective_median']:>8.1f}{s['decode_median']:>8.1f}"
                  f"{s['ttft_median']:>6.1f}s{s['restored_median']*100:>8.0f}%"
                  f"{s['acceptance']*100:>7.0f}%{s['thermal']:>10}"
                  f"{s['drift_pct']:>+7.0f}%")
        verdict(ranked)
    else:
        for m, s in results.items():
            print_model(m, s)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

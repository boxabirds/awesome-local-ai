# /// script
# requires-python = ">=3.11"
# ///
"""Summarise Vidi runs.

    uv run report.py <run-dir>                 # writes <run-dir>/summary.md
    uv run report.py --compare <run> <run> ... # prints a cross-combination table
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

SECONDS_PER_MINUTE = 60


def load(run: Path) -> tuple[dict, dict]:
    meta = json.loads((run / "run.json").read_text()) if (run / "run.json").exists() else {}
    return meta, json.loads((run / "metrics.json").read_text())


def fmt(x, nd=1):
    return "—" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))


def totals(m: dict) -> dict:
    ss = list(m["stories"].values())
    last = ss[-1] if ss else {}
    acc = last.get("accept", {})
    return {
        "stories": len(ss),
        "agent_minutes": sum(s["agent"]["seconds"] for s in ss) / SECONDS_PER_MINUTE,
        "requests": sum(s["requests"].get("requests", 0) for s in ss),
        "prompt_tokens": sum(s["requests"].get("prompt_tokens", 0) for s in ss),
        "completion_tokens": sum(s["requests"].get("completion_tokens", 0) for s in ss),
        "stalled": sum(bool(s["agent"]["stalled"]) for s in ss),
        "gate_green": sum(bool(s["gate"].get("all_green")) for s in ss),
        "accept_final": f"{acc.get('passed', 0)}/{acc.get('total', 0)}",
        "loc": last.get("loc", {}).get("lines"),
    }


def conditions_cell(c: dict) -> str:
    # Re-derived from raw samples so runs recorded under the older "any non-nominal = degraded" rule read the same.
    bad = c.get("bad_samples", [])
    power = any(not b["ac"] or b["low_power"] for b in bad)
    n = c.get("samples") or 0
    share = sum(b["thermal"] not in ("nominal", "unmonitored") for b in bad) / n if n else 0.0
    fp = c.get("server_footprint_peak_gb")
    return (("DEGRADED (power) " if power else "") + f"throttled {share:.0%}"
            + (f", server peak {fp:.0f} GB" if fp else "") + (" SWAP-ABORT" if c.get("aborted_swap") else "") + (" MEMORY-ABORT" if c.get("aborted_memory") else ""))


def summary(run: Path) -> str:
    meta, m = load(run)
    t = totals(m)
    lines = [f"# Vidi run — {meta.get('combination', run.parent.parent.parent.name)}", "",
             f"Model `{meta.get('model_id')}`, scope `{meta.get('scope')}`, effort `{meta.get('reasoning_effort')}`, "
             f"client {meta.get('client', 'opencode')} {meta.get('client_version') or meta.get('opencode', '')}, "
             f"host {meta.get('host')}.", "",
             "| Story | Title | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for sid, s in m["stories"].items():
        r, a = s["requests"], s["accept"]
        lines.append(
            f"| {sid} | {s['title']} | {s['agent']['seconds'] / SECONDS_PER_MINUTE:.1f} | {r.get('requests')} | "
            f"{r.get('prompt_tokens')} | {r.get('completion_tokens')} | {fmt(r.get('ttft_median_s'))} | "
            f"{fmt(r.get('decode_tok_s_median'))} | {'green' if s['gate'].get('all_green') else 'red'} | "
            f"{a.get('passed')}/{a.get('total')} | {'yes' if s['agent']['stalled'] else ''} | "
            f"{s['agent'].get('resumes', 0)} / {s['agent'].get('nudges', 0)}{' (ended in error)' if s['agent'].get('ended_in_error') else ''} | "
            f"{s['agent'].get('compactions', 0)} | {r.get('max_context', '—')} | "
            f"{conditions_cell(s.get('conditions', {}))} |")
    lines += ["", f"**Totals:** {t['stories']} stories, {t['agent_minutes']:.0f} agent-minutes, "
              f"{t['requests']} requests, {t['prompt_tokens']:,} prompt / {t['completion_tokens']:,} completion tokens, "
              f"gate green {t['gate_green']}/{t['stories']}, final acceptance {t['accept_final']}, "
              f"stalled {t['stalled']}, {t['loc']} lines in src+tests."]
    degraded = [sid for sid, s in m["stories"].items() if conditions_cell(s.get("conditions", {})).startswith("DEGRADED")]
    if degraded:
        lines.append(f"\n> Stories {', '.join(degraded)} ran partly on battery or in Low Power Mode. "
                     "Their timings are not comparable; re-run them.")
    bands: dict[str, list[float]] = {}
    for s in m["stories"].values():
        for band, b in s["requests"].get("decode_by_context", {}).items():
            bands.setdefault(band, []).extend([b["decode_tok_s_median"]] * b["requests"])
    if bands:
        lines += ["", "### Decode tok/s by context (server log, all stories)", "",
                  "| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |", "|---|---|---|"]
        for band, xs in bands.items():
            xs = sorted(x for x in xs if x is not None)
            lines.append(f"| {band} | {len(xs)} | {fmt(xs[len(xs) // 2] if xs else None)} |")
    missing = sum(s["requests"].get("usage_missing", 0) for s in m["stories"].values())
    if missing:
        lines.append(f"\n> {missing} requests returned no `usage`; token totals are a lower bound.")
    return "\n".join(lines) + "\n"


def compare(runs: list[Path]) -> str:
    rows = ["| Combination | Stories | Agent min | Requests | Completion tok | Gate green | Final accept | Stalled | LOC |",
            "|---|---|---|---|---|---|---|---|---|"]
    for run in runs:
        meta, m = load(run)
        t = totals(m)
        rows.append(f"| {meta.get('combination', run)} | {t['stories']} | {t['agent_minutes']:.0f} | {t['requests']} | "
                    f"{t['completion_tokens']:,} | {t['gate_green']}/{t['stories']} | {t['accept_final']} | {t['stalled']} | {t['loc']} |")
    return "\n".join(rows) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("runs", nargs="+", type=Path)
    ap.add_argument("--compare", action="store_true")
    a = ap.parse_args()
    if a.compare:
        print(compare(a.runs))
        return
    for run in a.runs:
        text = summary(run)
        (run / "summary.md").write_text(text)
        print(text)


if __name__ == "__main__":
    main()

# /// script
# requires-python = ">=3.11"
# ///
"""Microbenchmarks: short, targeted checks of a serving setup, run in minutes instead of a
full benchmark run.

    uv run microbench.py --url http://127.0.0.1:PORT --plan plans/effort-low.json --out results/NAME

A plan (JSON) names the probes to run, their settings, and pass criteria fixed before running.
Results: raw.jsonl (one line per request), summary.json (per probe and variant) and verdict.json.
Exit code 0 when every criterion passes, 1 when one fails, 2 on a usage error.

Probes are registered in PROBES below. Each takes the server URL and its settings and yields
result rows; each row names its probe and variant. To add a probe, add a function and register it.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Request helpers shared with the gufo long-session investigation.
sys.path.insert(0, str(HERE.parent / "gufo-eval" / "long-session"))
import effort_probe  # noqa: E402
import replay as replay_mod  # noqa: E402

EFFORT_VARIANTS = {"none": {}, "low": {"reasoning_effort": "low"}, "medium": {"reasoning_effort": "medium"},
                   "xhigh": {"reasoning_effort": "xhigh"}}
REPLAY_VARIANTS = {"as-is": {}, "effort-low": {"reasoning_effort": "low"},
                   "effort-medium": {"reasoning_effort": "medium"}, "effort-xhigh": {"reasoning_effort": "xhigh"}}


def probe_effort_silence(url: str, cfg: dict):
    """The same short reasoning prompt with no effort named and with named efforts: which one
    does the server apply when a request names none?"""
    model = effort_probe.served_model(url)
    for rep in range(1, cfg.get("repeats", 2) + 1):
        for v in cfg.get("variants", ["none", "low", "xhigh"]):
            try:
                r = effort_probe.ask(url, model, EFFORT_VARIANTS[v])
            except Exception as e:  # a failure is a result too
                r = {"error": f"{type(e).__name__}: {e}"}
            yield {**r, "variant": v, "repeat": rep}


def probe_replay(url: str, cfg: dict):
    """Real captured agent requests, sent as captured and in variants: thinking length, time and
    whether the reply still ends in a valid tool call."""
    model = replay_mod.served_model(url)
    cap = cfg.get("max_tokens")
    for path in cfg["requests"]:
        p = Path(path) if Path(path).is_absolute() else HERE / path
        for v in cfg.get("variants", ["as-is"]):
            for rep in range(1, cfg.get("repeats", 1) + 1):
                body = json.loads(p.read_text())
                body.update(model=model, stream=True, stream_options={"include_usage": True}, **REPLAY_VARIANTS[v])
                if cap:
                    body["max_completion_tokens"] = min(body.get("max_completion_tokens") or cap, cap)
                try:
                    r = replay_mod.replay(url, body)
                except Exception as e:
                    r = {"error": f"{type(e).__name__}: {e}"}
                yield {**r, "variant": v, "request": p.name, "repeat": rep}


PROBES = {"effort-silence": probe_effort_silence, "replay": probe_replay}


def _median(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def summarise(rows: list[dict]) -> dict:
    """Per probe and variant: count, errors, median completion tokens and seconds, valid tool rate."""
    groups: dict = {}
    for r in rows:
        groups.setdefault(r["probe"], {}).setdefault(r["variant"], []).append(r)
    out: dict = {}
    for probe, variants in groups.items():
        for v, rs in variants.items():
            ok = [r for r in rs if "error" not in r]
            tool = [r["tool_args_valid"] for r in ok if r.get("tool_args_valid") is not None]
            out.setdefault(probe, {})[v] = {
                "n": len(ok), "errors": len(rs) - len(ok),
                "median_completion_tokens": _median([r.get("completion_tokens") for r in ok]),
                "median_seconds": _median([r.get("seconds") for r in ok]),
                "valid_tool_rate": (sum(tool) / len(tool)) if tool else None,
            }
    return out


def _ratio(a, b):
    return a / b if a is not None and b else float("inf")


def verdict(summary: dict, criteria: list[dict]) -> dict:
    """Evaluate each criterion (a Python expression over the summary's probes) and the overall pass."""
    results = []
    for c in criteria:
        try:
            ok = bool(eval(c["expr"], {"__builtins__": {}}, {**summary, "ratio": _ratio}))  # our own plan files only
            results.append({"name": c["name"], "expr": c["expr"], "passed": ok})
        except Exception as e:
            results.append({"name": c["name"], "expr": c["expr"], "passed": False, "error": f"{type(e).__name__}: {e}"})
    return {"passed": bool(results) and all(r["passed"] for r in results), "criteria": results}


def run_plan(plan: dict, url: str, out: Path, label: str = "") -> dict:
    out.mkdir(parents=True, exist_ok=True)
    raw = out / "raw.jsonl"
    rows: list[dict] = []
    started = time.time()
    for step in plan["probes"]:
        for r in PROBES[step["probe"]](url, step):
            r["probe"] = step["probe"]
            rows.append(r)
            with raw.open("a") as f:
                f.write(json.dumps(r) + "\n")
            print(json.dumps({k: r.get(k) for k in ("probe", "variant", "request", "completion_tokens", "seconds", "error")}), flush=True)
    summary = summarise(rows)
    v = verdict(summary, plan.get("criteria", []))
    meta = {"plan": plan.get("name"), "label": label, "url": url, "started": started, "seconds": round(time.time() - started, 1)}
    (out / "summary.json").write_text(json.dumps({"meta": meta, **summary}, indent=2))
    (out / "verdict.json").write_text(json.dumps({"meta": meta, **v}, indent=2))
    return {"summary": summary, "verdict": v}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True)
    ap.add_argument("--plan", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--label", default="")
    a = ap.parse_args()
    plan = json.loads(a.plan.read_text())
    unknown = [s["probe"] for s in plan["probes"] if s["probe"] not in PROBES]
    if unknown:
        print(f"unknown probe(s): {', '.join(unknown)}; known: {', '.join(PROBES)}", file=sys.stderr)
        return 2
    result = run_plan(plan, a.url, a.out, a.label)
    for c in result["verdict"]["criteria"]:
        print(f"{'PASS' if c['passed'] else 'FAIL'}  {c['name']}{'  (' + c['error'] + ')' if 'error' in c else ''}")
    print("VERDICT", "PASS" if result["verdict"]["passed"] else "FAIL")
    return 0 if result["verdict"]["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())

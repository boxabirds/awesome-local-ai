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


CHARS_PER_TOKEN = 4          # rough, for sizing padding; the server's own count is what gets recorded
MEMORY_SAMPLE_S = 2
BYTES_PER_KB = 1024


def pad_request(body: dict, target_tokens: int, sources: list[Path]) -> dict:
    """Insert reference text after the system prompt until the request is about target_tokens long,
    keeping the rest of the conversation as captured."""
    text = "\n\n".join(Path(p).read_text(errors="replace") for p in sources)
    need = target_tokens * CHARS_PER_TOKEN - len(json.dumps(body))
    pad = (text * (need // max(1, len(text)) + 1))[:max(0, need)]
    msgs = list(body.get("messages") or [])
    at = 1 if msgs and msgs[0].get("role") == "system" else 0
    msgs.insert(at, {"role": "user", "content": "Reference material for this project:\n\n" + pad})
    return {**body, "messages": msgs}


def _server_rss_mb(match: str) -> float | None:
    import subprocess
    pids = subprocess.run(["pgrep", "-f", match], capture_output=True, text=True).stdout.split()
    total = 0
    for pid in pids:
        out = subprocess.run(["ps", "-o", "rss=", "-p", pid], capture_output=True, text=True).stdout.strip()
        total += int(out) if out.isdigit() else 0
    return total / BYTES_PER_KB if pids else None


def _swap_used_mb() -> float | None:
    import re, subprocess
    if sys.platform == "darwin":
        out = subprocess.run(["sysctl", "-n", "vm.swapusage"], capture_output=True, text=True).stdout
        m = re.search(r"used = ([\d.]+)M", out)
        return float(m.group(1)) if m else None
    try:
        info = dict(l.split(":", 1) for l in open("/proc/meminfo"))
        return (int(info["SwapTotal"].split()[0]) - int(info["SwapFree"].split()[0])) / BYTES_PER_KB
    except Exception:
        return None


def probe_long_context(url: str, cfg: dict):
    """One real agent request padded to a long context: does the server take it, how fast does it
    generate at that depth, and what do server memory and swap do meanwhile?"""
    import threading
    model = replay_mod.served_model(url)
    base = json.loads(Path(cfg["request"]).read_text() if Path(cfg["request"]).is_absolute()
                      else (HERE / cfg["request"]).read_text())
    sources = [Path(p) if Path(p).is_absolute() else HERE / p for p in cfg.get("pad_from", [])]
    sources = [p for s in sources for p in (sorted(s.parent.glob(s.name)) if "*" in s.name else [s])]
    body = pad_request(base, cfg["target_tokens"], sources)
    body.update(model=model, stream=True, stream_options={"include_usage": True})
    if cfg.get("max_tokens"):
        body["max_completion_tokens"] = cfg["max_tokens"]
    match = cfg.get("server_process_match", "mlx-serve")
    peak = {"rss": _server_rss_mb(match)}; swap0 = _swap_used_mb(); stop = threading.Event()
    def sample():
        while not stop.wait(MEMORY_SAMPLE_S):
            r = _server_rss_mb(match)
            if r is not None and (peak["rss"] is None or r > peak["rss"]):
                peak["rss"] = r
    t = threading.Thread(target=sample, daemon=True); t.start()
    try:
        r = replay_mod.replay(url, body)
    except Exception as e:
        r = {"error": f"{type(e).__name__}: {e}"}
    stop.set(); t.join()
    gen_s = (r.get("seconds") or 0) - (r.get("ttft_s") or 0)
    swap1 = _swap_used_mb()
    yield {**r, "variant": str(cfg["target_tokens"]),
           "decode_tok_s": round(r["completion_tokens"] / gen_s, 1) if r.get("completion_tokens") and gen_s > 0 else None,
           "peak_server_rss_mb": round(peak["rss"], 0) if peak["rss"] is not None else None,
           "swap_growth_mb": round(swap1 - swap0, 0) if swap0 is not None and swap1 is not None else None}


PROBES = {"effort-silence": probe_effort_silence, "replay": probe_replay, "long-context": probe_long_context}


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
                "min_prompt_tokens": min((r.get("prompt_tokens") for r in ok if r.get("prompt_tokens")), default=None),
                "min_decode_tok_s": min((r["decode_tok_s"] for r in ok if r.get("decode_tok_s")), default=None),
                "max_server_rss_mb": max((r["peak_server_rss_mb"] for r in ok if r.get("peak_server_rss_mb")), default=None),
                "max_swap_growth_mb": max((r["swap_growth_mb"] for r in ok if r.get("swap_growth_mb") is not None), default=None),
            }
    return out


def _ratio(a, b):
    return a / b if a is not None and b else float("inf")


def verdict(summary: dict, criteria: list[dict]) -> dict:
    """Evaluate each criterion (a Python expression over the summary's probes) and the overall pass."""
    results = []
    for c in criteria:
        try:
            names = {k.replace("-", "_"): v for k, v in summary.items()}  # "long-context" -> long_context
            ok = bool(eval(c["expr"], {"__builtins__": {}}, {**names, "ratio": _ratio}))  # our own plan files only
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

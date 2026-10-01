"""Check 2: tool calls over /v1/chat/completions with pi's real requests.

Samples are turns of a recorded pi session where pi had just sent a tool result, so the recorded model went on to
call a tool. Each sample is sent twice, as pi's body with a fixed seed (TensorFold's output is a function of prompt,
seed and settings, so both should give the same reply): once plain, once streamed.

FAIL when:
  * a tool call comes back as text, "<tool_call>" in the content (the shape of gufo issue 304),
  * a call names a tool that was not offered, its arguments are not a JSON object, or a value has the wrong JSON
    type for the schema (a stringified number or boolean, say),
  * the streamed deltas do not assemble to the same call as the plain reply,
  * fewer than MIN_STRUCTURED_SHARE of the samples come back as a structured call at all,
  * reasoning_effort "low" or "high" is refused, or "high" does not reason longer than "low".
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from tfcheck import schema
from tfcheck.client import chat, load_bodies, reasoning_tokens

SAMPLES = 8
# A cap on each sample's reply. pi asks for 32768; at effort low a tool call comes well inside this, and a reply cut
# here without a call is counted as inconclusive, not as a failure.
REPLY_TOKENS = 8192
# A fixed sampling key, so the plain and the streamed request are the same request (TensorFold docs/api.md: "seed").
SEED = 20261001
# Only turns under this many characters of request (about 40k tokens) are sampled, to keep each prefill short.
SAMPLE_MAX_CHARS = 160_000
# Every sampled turn was a tool call in the recorded run; a healthy server makes one on most of them.
MIN_STRUCTURED_SHARE = 0.5
EFFORT_SAMPLES = 3
TOOL_MARKUP = ("<tool_call>", "</tool_call>", "<function=")


def _chars(body: dict) -> int:
    return len(json.dumps(body.get("messages", [])) + json.dumps(body.get("tools", [])))


def pick_samples(bodies, n: int = SAMPLES) -> list[tuple[int, dict]]:
    """Up to n (turn, body) pairs spread over the turns that end in a tool result."""
    cands = [(i, b) for i, b in enumerate(bodies, start=1)
             if b.get("messages") and b["messages"][-1].get("role") == "tool" and _chars(b) <= SAMPLE_MAX_CHARS]
    if len(cands) <= n:
        return cands
    step = (len(cands) - 1) / (n - 1)
    return [cands[round(k * step)] for k in range(n)]


def _request(body: dict, model: str, stream: bool, **extra) -> dict:
    req = dict(body)
    req.pop("max_tokens", None)
    req.update(model=model, seed=SEED, max_completion_tokens=REPLY_TOKENS, stream=stream, **extra)
    if stream:
        req["stream_options"] = {"include_usage": True}
    else:
        req.pop("stream_options", None)
    return req


def _parsed(calls: list[dict]) -> list[tuple[str, object]]:
    out = []
    for c in calls:
        try:
            out.append((c.get("name"), json.loads(c.get("arguments") or "")))
        except json.JSONDecodeError:
            out.append((c.get("name"), c.get("arguments")))
    return out


def check_sample(base_url: str, model: str, turn: int, body: dict) -> dict:
    tools = {t["function"]["name"]: t["function"].get("parameters") or {}
             for t in body.get("tools", []) if t.get("type") == "function"}
    plain = chat(base_url, _request(body, model, stream=False))
    streamed = chat(base_url, _request(body, model, stream=True))
    s = {"turn": turn, "prompt_chars": _chars(body), "finish_reason": plain.finish_reason,
         "structured": bool(plain.tool_calls), "calls": plain.tool_calls, "streamed_calls": streamed.tool_calls,
         "content": plain.content[:500], "inconclusive": False, "problems": []}
    for name, r in (("plain", plain), ("streamed", streamed)):
        if not r.ok:
            s["problems"].append(f"turn {turn}: the {name} request failed: HTTP {r.status} {r.error}")
        for mark in TOOL_MARKUP:
            if mark in r.content:
                s["problems"].append(f"turn {turn}: the {name} reply returned a tool call as text "
                                     f"({mark!r} in its content), not as tool_calls")
                break
    if s["problems"]:
        return s
    for c in plain.tool_calls:
        if c.get("name") not in tools:
            s["problems"].append(f"turn {turn}: a call to {c.get('name')!r}, which was not offered ({sorted(tools)})")
            continue
        try:
            args = json.loads(c.get("arguments") or "")
        except json.JSONDecodeError as e:
            s["problems"].append(f"turn {turn}: {c['name']} arguments are not JSON ({e}): {c.get('arguments')!r:.120}")
            continue
        if not isinstance(args, dict):
            s["problems"].append(f"turn {turn}: {c['name']} arguments are a {type(args).__name__}, not an object")
            continue
        for p in schema.problems(args, tools[c["name"]]):
            s["problems"].append(f"turn {turn}: {c['name']}: {p}")
    if _parsed(plain.tool_calls) != _parsed(streamed.tool_calls):
        s["problems"].append(f"turn {turn}: the streamed deltas assembled to {_parsed(streamed.tool_calls)!r:.200}, "
                             f"the plain reply to {_parsed(plain.tool_calls)!r:.200}")
    if not plain.tool_calls and plain.finish_reason == "length":
        s["inconclusive"] = True
    return s


def check_effort(base_url: str, model: str, samples: list[tuple[int, dict]]) -> dict:
    e = {"samples": [], "low_reasoning_tokens": 0, "high_reasoning_tokens": 0, "problems": []}
    for turn, body in samples[:EFFORT_SAMPLES]:
        row = {"turn": turn}
        for level in ("low", "high"):
            r = chat(base_url, _request(body, model, stream=False, reasoning_effort=level))
            if not r.ok:
                e["problems"].append(f"reasoning_effort {level!r} was not accepted: HTTP {r.status} {r.error}")
                return e
            n = reasoning_tokens(r.usage)
            row[level] = n if n is not None else len(r.reasoning) // 4      # chars as a rough proxy if not reported
            row[f"{level}_source"] = "usage" if n is not None else "characters/4"
            e[f"{level}_reasoning_tokens"] += row[level]
        e["samples"].append(row)
    if e["high_reasoning_tokens"] <= e["low_reasoning_tokens"]:
        e["problems"].append(f"reasoning_effort did not change reasoning length: 'low' {e['low_reasoning_tokens']:,} "
                             f"tokens, 'high' {e['high_reasoning_tokens']:,} over {len(e['samples'])} requests")
    return e


def run(base_url: str, bodies, *, model: str, log=lambda s: None) -> dict:
    bodies = list(bodies)
    picked = pick_samples(bodies)
    result = {"check": "tool calls with pi's requests", "verdict": None, "reason": "", "samples": [],
              "effort": {}, "all_failures": []}
    if not picked:
        result.update(verdict="FAIL", reason="no recorded turn ending in a tool result was small enough to sample")
        return result
    for turn, body in picked:
        s = check_sample(base_url, model, turn, body)
        result["samples"].append(s)
        log(f"  turn {turn}: {'call ' + ', '.join(c['name'] or '?' for c in s['calls']) if s['structured'] else 'no call'}"
            f"{'  PROBLEMS: ' + '; '.join(s['problems']) if s['problems'] else ''}")
        result["all_failures"] += s["problems"]
    counted = [s for s in result["samples"] if not s["inconclusive"]]
    structured = sum(s["structured"] for s in counted)
    if counted and structured < MIN_STRUCTURED_SHARE * len(counted):
        result["all_failures"].append(f"only {structured} of {len(counted)} samples came back as a structured tool "
                                      f"call; every one of those turns called a tool in the recorded run")
    result["effort"] = check_effort(base_url, model, picked)
    result["all_failures"] += result["effort"]["problems"]
    if result["all_failures"]:
        result.update(verdict="FAIL", reason=result["all_failures"][0])
    else:
        result.update(verdict="PASS", reason=(f"{structured} of {len(counted)} samples called a tool, all structured, "
                                              f"schema-typed and identical when streamed; reasoning_effort low "
                                              f"{result['effort']['low_reasoning_tokens']:,} vs high "
                                              f"{result['effort']['high_reasoning_tokens']:,} reasoning tokens"))
    return result


def write_outputs(result: dict, out: Path) -> None:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(result, indent=1) + "\n")
    lines = [f"# Check 2: tool calls with pi's requests: {result['verdict']}", "", result["reason"], "",
             "| turn | finish | call(s) | streamed same | problems |", "| ---: | --- | --- | :-: | --- |"]
    for s in result["samples"]:
        calls = ", ".join(f"{c['name']}" for c in s["calls"]) or ("(inconclusive: cut at the limit)"
                                                                  if s["inconclusive"] else "none")
        same = "yes" if not any("streamed deltas" in p for p in s["problems"]) else "NO"
        lines.append(f"| {s['turn']} | {s['finish_reason']} | {calls} | {same} | {'; '.join(s['problems'])} |")
    e = result.get("effort") or {}
    if e:
        lines += ["", f"reasoning_effort: low {e.get('low_reasoning_tokens', 0):,} vs high "
                      f"{e.get('high_reasoning_tokens', 0):,} reasoning tokens over {len(e.get('samples', []))} "
                      f"requests{'; ' + '; '.join(e['problems']) if e.get('problems') else ''}"]
    if len(result.get("all_failures", [])) > 1:
        lines += ["", "All failures:", *[f"- {f}" for f in result["all_failures"]]]
    (out / "summary.md").write_text("\n".join(lines) + "\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--bodies", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args(argv)
    r = run(a.base_url, load_bodies(a.bodies), model=a.model, log=lambda s: print(s, flush=True))
    write_outputs(r, a.out)
    print(f"check 2: {r['verdict']}: {r['reason']}")
    return 0 if r["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())

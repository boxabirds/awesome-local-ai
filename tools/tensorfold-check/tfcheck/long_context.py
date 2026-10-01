"""Check 1: one pi conversation grown past 120k tokens, turn by turn, must reuse its prompt cache on every turn.

The requests are pi's own (capture_pi_requests.mjs renders a recorded agent log through pi's request builder), sent
in order. Only two fields change: `model` (the served name) and the reply limit (REPLY_TOKENS: this check measures
prefill, and the next turn sends pi's recorded reply anyway, not the one generated here).

PASS needs, on every turn after the first:
  * reuse: cached_tokens >= the previous prompt's tokens - CACHE_TOLERANCE_TOKENS, and
  * time to first token in proportion to the NEW tokens, not the whole context:
        ttft <= TTFT_FIXED_S + TTFT_FACTOR * new_tokens / cold_rate
    where cold_rate is turn 1's prompt tokens over its time to first token (a cold prefill),
and the conversation must reach the target size. FAIL names the first turn that broke a rule.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from tfcheck.client import cached_tokens, chat, load_bodies

# Our agent sessions run to about 131k tokens (horizon/tensorfold.md); the owner asked for at least 135k.
TARGET_TOKENS = 135_000
# This check measures prefill. A few dozen tokens end each turn quickly; TensorFold reserves the reply limit before
# prefill, so a small one also lets the prompt grow closest to the window.
REPLY_TOKENS = 64
# TensorFold resumes at a chunk boundary: assistant-message starts, skipped when under 256 tokens from the previous
# cut (README "Prompt caching", docs/recipes/qwen3.8-flash-next.md), and it keeps a prompt's state one token before
# its end. A healthy resume therefore re-reads a few tokens to a few hundred. Twice the planner's 256-token spacing
# allows that and nothing more; issue 71's failure re-read the whole context (100k+ tokens).
CACHE_TOLERANCE_TOKENS = 512
# Fixed cost of a turn before its first token, whatever its size: request parsing, rendering a 100k-token template,
# chunk planning, the memory check and the first decode round with its MTP drafts. Generous on purpose: re-reading
# 120k tokens takes minutes (7-11 per turn in issue 71), so this does not blur the line.
TTFT_FIXED_S = 5.0
# Per-token prefill gets slower as the context deepens (attention over all earlier tokens in the full-attention
# layers); turn 1's rate is measured at a shallow depth. A factor of 4 covers that; a full re-read at 120k tokens is
# 20-100 times what a cached turn's few thousand new tokens take.
TTFT_FACTOR = 4.0
# After the first failing turn, a couple more turns show whether the loss persists; more would only cost minutes each.
TURNS_AFTER_FAILURE = 2
# When the keep-prompt limit is what bounds the conversation, stop this far below it: one turn can add a whole tool
# result (pi caps one at 50 KB, about 12.5k tokens), and the turn that crosses the target must still be kept.
KEEP_MARGIN_TOKENS = 16_384


def _chars(body: dict) -> int:
    return len(json.dumps(body.get("messages", [])) + json.dumps(body.get("tools", [])))


def run(base_url: str, bodies, *, model: str, keep_limit: int, target_tokens: int = TARGET_TOKENS,
        reply_tokens: int = REPLY_TOKENS, tolerance: int = CACHE_TOLERANCE_TOKENS, ttft_fixed_s: float = TTFT_FIXED_S,
        ttft_factor: float = TTFT_FACTOR, log=lambda s: None) -> dict:
    target = min(target_tokens, keep_limit - reply_tokens - KEEP_MARGIN_TOKENS)
    result = {"check": "long-context cache retention", "verdict": None, "reason": "", "first_failing_turn": None,
              "keep_limit": keep_limit, "target_tokens": target, "reply_tokens": reply_tokens,
              "cache_tolerance_tokens": tolerance, "ttft_fixed_s": ttft_fixed_s, "ttft_factor": ttft_factor,
              "cold_rate_tps": None, "max_prompt_tokens": 0, "stopped_because": "", "turns": []}
    turns = result["turns"]
    failures: list[tuple[int, str]] = []
    prev_prompt = prev_chars = 0
    cold_rate = None

    def fail(n: int, why: str) -> None:
        failures.append((n, why))
        log(f"  FAIL {why}")

    for n, body in enumerate(bodies, start=1):
        if failures and n > failures[0][0] + TURNS_AFTER_FAILURE:
            result["stopped_because"] = f"{TURNS_AFTER_FAILURE} more turns after the first failure"
            break
        if prev_prompt and prev_chars:
            estimate = _chars(body) * prev_prompt / prev_chars
            if estimate + reply_tokens > keep_limit:
                result["stopped_because"] = (f"the next turn (about {estimate:,.0f} tokens) would pass the "
                                             f"keep-prompt limit of {keep_limit:,}")
                break
        req = dict(body)
        req.pop("max_tokens", None)
        req.update(model=model, max_completion_tokens=reply_tokens, stream=True,
                   stream_options={"include_usage": True})
        r = chat(base_url, req)
        t = {"turn": n, "previous_prompt_tokens": prev_prompt, "prompt_tokens": None, "cached_tokens": None,
             "new_tokens": None, "ttft_s": r.ttft_s, "total_s": round(r.total_s, 3), "prefill_tps": None,
             "ttft_bound_s": None, "cache_ok": None, "ttft_ok": None, "error": ""}
        turns.append(t)
        if not r.ok:
            t["error"] = f"HTTP {r.status} {r.error_code} {r.error}".strip()
            fail(n, f"turn {n}: the server refused the request ({t['error']}) after reaching "
                    f"{result['max_prompt_tokens']:,} prompt tokens, before the {target:,}-token target")
            break
        prompt = r.usage.get("prompt_tokens")
        cached = cached_tokens(r.usage)
        if not isinstance(prompt, int):
            fail(n, f"turn {n}: the server's usage has no prompt_tokens")
            break
        t["prompt_tokens"] = prompt
        result["max_prompt_tokens"] = max(result["max_prompt_tokens"], prompt)
        if cached is None:
            fail(n, f"turn {n}: the server reported no prompt_tokens_details.cached_tokens, so reuse cannot be seen")
            break
        if r.ttft_s is None:
            fail(n, f"turn {n}: no token was streamed back")
            break
        new = prompt - cached
        t.update(cached_tokens=cached, new_tokens=new, ttft_s=round(r.ttft_s, 3),
                 prefill_tps=round(new / r.ttft_s, 1) if r.ttft_s > 0 else None)
        if n == 1:
            cold_rate = prompt / r.ttft_s
            result["cold_rate_tps"] = round(cold_rate, 1)
        else:
            want = prev_prompt - tolerance
            t["cache_ok"] = cached >= want
            if not t["cache_ok"]:
                fail(n, f"turn {n} re-prefilled: the server reported cached {cached:,} of {prompt:,} prompt tokens; "
                        f"the previous prompt was {prev_prompt:,} tokens, so at least {want:,} should have been "
                        f"reused (tolerance {tolerance})")
            bound = ttft_fixed_s + ttft_factor * new / cold_rate
            t["ttft_bound_s"] = round(bound, 3)
            t["ttft_ok"] = r.ttft_s <= bound
            if not t["ttft_ok"] and t["cache_ok"]:
                fail(n, f"turn {n}: time to first token {r.ttft_s:.1f} s for {new:,} new tokens is over the "
                        f"{bound:.1f} s allowed ({ttft_fixed_s:g} s + {ttft_factor:g} x those tokens at turn 1's cold "
                        f"rate of {cold_rate:,.0f} tok/s); at that rate it is about {r.ttft_s * cold_rate:,.0f} "
                        f"tokens' work, against {prompt:,} in the whole prompt")
        log(f"  turn {n:4d}: prompt {prompt:>8,}  cached {cached:>8,}  new {new:>7,}  ttft {r.ttft_s:7.2f} s")
        prev_prompt, prev_chars = prompt, _chars(body)
        if prompt >= target and not failures:
            result["stopped_because"] = f"reached the {target:,}-token target"
            break
    else:
        if not result["stopped_because"]:
            result["stopped_because"] = "no more recorded turns"

    if failures:
        result["verdict"] = "FAIL"
        result["first_failing_turn"] = failures[0][0]
        result["reason"] = failures[0][1]
        result["all_failures"] = [w for _, w in failures]
    elif result["max_prompt_tokens"] < target:
        result["verdict"] = "FAIL"
        result["reason"] = (f"ran out of recorded turns at {result['max_prompt_tokens']:,} prompt tokens, short of "
                            f"the {target:,}-token target: use a longer agent log"
                            if result["stopped_because"] == "no more recorded turns" else
                            f"stopped at {result['max_prompt_tokens']:,} prompt tokens, short of the {target:,}-token "
                            f"target: {result['stopped_because']}")
    else:
        kept = turns[1:]
        result["verdict"] = "PASS"
        result["reason"] = (f"all {len(turns)} turns up to {result['max_prompt_tokens']:,} prompt tokens reused the "
                            f"previous prompt (worst re-read: "
                            f"{max((t['previous_prompt_tokens'] - t['cached_tokens'] for t in kept), default=0):,} "
                            f"tokens) and kept time to first token in proportion to new tokens")
    return result


def write_outputs(result: dict, out: Path) -> None:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(result, indent=1) + "\n")
    lines = [f"# Check 1: long-context cache retention: {result['verdict']}", "", result["reason"], "",
             f"- keep-prompt limit (server's startup line): {result['keep_limit']:,} tokens",
             f"- target: {result['target_tokens']:,} prompt tokens; reached {result['max_prompt_tokens']:,}",
             f"- stopped: {result['stopped_because'] or '-'}",
             f"- rules: cached >= previous prompt - {result['cache_tolerance_tokens']}; time to first token <= "
             f"{result['ttft_fixed_s']:g} s + {result['ttft_factor']:g} x new tokens / turn 1's cold rate "
             f"({result['cold_rate_tps'] or '-'} tok/s)",
             f"- reply limit per turn: {result['reply_tokens']} tokens (pi's own body otherwise)", "",
             "| turn | prompt | cached | new | ttft s | prefill tok/s | allowed s | ok |",
             "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | :-: |"]
    for t in result["turns"]:
        ok = "" if t["cache_ok"] is None else ("yes" if t["cache_ok"] and t["ttft_ok"] else "NO")
        if t["error"]:
            lines.append(f"| {t['turn']} | | | | | | | {t['error']} |")
            continue
        lines.append("| {turn} | {p} | {c} | {nw} | {tt} | {tps} | {b} | {ok} |".format(
            turn=t["turn"], p=f"{t['prompt_tokens']:,}" if t["prompt_tokens"] is not None else "",
            c=f"{t['cached_tokens']:,}" if t["cached_tokens"] is not None else "",
            nw=f"{t['new_tokens']:,}" if t["new_tokens"] is not None else "",
            tt=t["ttft_s"] if t["ttft_s"] is not None else "", tps=t["prefill_tps"] or "",
            b=t["ttft_bound_s"] or "", ok=ok))
    (out / "summary.md").write_text("\n".join(lines) + "\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--bodies", required=True, type=Path, help="directory of NNNN.json(.gz) request bodies")
    ap.add_argument("--keep-limit", required=True, type=int, help="from the server's startup line (startup.py)")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--target", type=int, default=TARGET_TOKENS)
    ap.add_argument("--tolerance", type=int, default=CACHE_TOLERANCE_TOKENS)
    a = ap.parse_args(argv)
    r = run(a.base_url, load_bodies(a.bodies), model=a.model, keep_limit=a.keep_limit, target_tokens=a.target,
            tolerance=a.tolerance, log=lambda s: print(s, flush=True))
    write_outputs(r, a.out)
    print(f"check 1: {r['verdict']}: {r['reason']}")
    return 0 if r["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())

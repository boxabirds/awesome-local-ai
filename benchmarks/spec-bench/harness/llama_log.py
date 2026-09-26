"""Per-request prefill, decode and MTP draft figures from llama-server's own log: no proxy in the
request path. llama-server prints, at INFO, when each request finishes:

  0.41.759.972 I slot print_timing: id  0 | task 0 | prompt eval time =  745.92 ms /  45 tokens (...)
  0.41.759.977 I slot print_timing: id  0 | task 0 |        eval time =  836.19 ms /  24 tokens (...)
  0.41.759.990 I slot print_timing: id  0 | task 0 | draft acceptance = 0.57143 (16 accepted / 28 generated), mean len = 3.29

Its clock is minutes.seconds.ms.us since the server started, so run.sh writes a start marker with
the wall-clock time before each start (start_marker); a log segment without one is skipped.

    python3 llama_log.py <server.log> [<from-epoch> <to-epoch>]   # summary as JSON
"""
from __future__ import annotations

import json
import re
import sys

MARKER = "=== server start "
MARKER_RE = re.compile(rf"^{re.escape(MARKER)}([\d.]+)")
STAMP = r"^\s*(\d+)\.(\d{2})\.(\d{3})\.(\d{3}) I slot print_timing: id\s+\d+ \| task (\d+) \|\s*"
PROMPT_RE = re.compile(STAMP + r"prompt eval time =\s*([\d.]+) ms /\s*(\d+) tokens")
EVAL_RE = re.compile(STAMP + r"eval time =\s*([\d.]+) ms /\s*(\d+) tokens")
DRAFT_RE = re.compile(STAMP + r"draft acceptance = [\d.]+ \(\s*(\d+) accepted /\s*(\d+) generated\), mean len =\s*([\d.]+)")
SECONDS_PER_MINUTE = 60
MS_PER_S = 1000
US_PER_S = 1_000_000


def start_marker(epoch: float) -> str:
    return f"{MARKER}{epoch:.3f} ===\n"


def server_starts(text: str) -> list[float]:
    return [float(m.group(1)) for line in text.splitlines() if (m := MARKER_RE.match(line))]


def _since_start(m: re.Match) -> float:
    mins, secs, ms, us = (int(m.group(i)) for i in range(1, 5))
    return mins * SECONDS_PER_MINUTE + secs + ms / MS_PER_S + us / US_PER_S


def parse(text: str) -> list[dict]:
    """Finished requests, in order: end (epoch s), prompt_n/ms (prefill), gen_n/ms (decode), and
    draft_accepted/draft_generated/mean_len when MTP drafted."""
    reqs: list[dict] = []
    base = None
    cur: dict | None = None
    for line in text.splitlines():
        if (m := MARKER_RE.match(line)):
            base, cur = float(m.group(1)), None
            continue
        if base is None or "print_timing" not in line:
            continue
        if (m := PROMPT_RE.match(line)):
            cur = {"task": int(m.group(5)), "end": base + _since_start(m),
                   "prompt_ms": float(m.group(6)), "prompt_n": int(m.group(7))}
            reqs.append(cur)
        elif (m := EVAL_RE.match(line)) and cur and cur["task"] == int(m.group(5)):
            cur.update(gen_ms=float(m.group(6)), gen_n=int(m.group(7)), end=base + _since_start(m))
        elif (m := DRAFT_RE.match(line)) and cur and cur["task"] == int(m.group(5)):
            cur.update(draft_accepted=int(m.group(6)), draft_generated=int(m.group(7)),
                       mean_len=float(m.group(8)), end=base + _since_start(m))
    return [r for r in reqs if "gen_ms" in r]


def summarise(reqs: list[dict], t_from: float, t_to: float) -> dict:
    """Totals for the requests that finished in [t_from, t_to]."""
    rs = [r for r in reqs if t_from <= r["end"] <= t_to]
    prefill_ms = sum(r["prompt_ms"] for r in rs)
    decode_ms = sum(r["gen_ms"] for r in rs)
    gen_n = sum(r["gen_n"] for r in rs)
    acc = sum(r.get("draft_accepted", 0) for r in rs)
    drafted = sum(r.get("draft_generated", 0) for r in rs)
    lens = [(r["mean_len"], r["gen_n"]) for r in rs if "mean_len" in r]
    return {
        "requests": len(rs),
        "prefill_s": round(prefill_ms / MS_PER_S, 1),
        "prefill_tokens": sum(r["prompt_n"] for r in rs),
        "prefill_tok_s": round(sum(r["prompt_n"] for r in rs) / (prefill_ms / MS_PER_S), 1) if prefill_ms else None,
        "decode_s": round(decode_ms / MS_PER_S, 1),
        "decode_tokens": gen_n,
        "decode_tok_s": round(gen_n / (decode_ms / MS_PER_S), 1) if decode_ms else None,
        "draft_acceptance": round(acc / drafted, 3) if drafted else None,
        # weighted by tokens generated, so long replies count for what they cost
        "mean_accepted_len": round(sum(l * n for l, n in lens) / sum(n for _, n in lens), 2) if lens and sum(n for _, n in lens) else None,
    }


def main(argv: list[str]) -> None:
    reqs = parse(open(argv[0], errors="replace").read())
    lo, hi = (float(argv[1]), float(argv[2])) if len(argv) == 3 else (0.0, float("inf"))
    print(json.dumps(summarise(reqs, lo, hi), indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])

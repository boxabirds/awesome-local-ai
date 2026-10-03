"""MTP draft figures from the logs of the servers that aren't llama.cpp (llama_log.py reads that one), each request
placed by the agent's own call for it.

gufo prints one line per finished request (Strix Halo box, v2-r4; abridged):

  2026-10-01 00:29:06 [INFO] [http] request=r4 event=completed method=POST path=/v1/chat/completions ...
      prompt_tokens=2049 prefill_tokens=2049 generated_tokens=103 ... draft_accepted=76 draft_proposed=90 ...

mlx-serve prints a block per request, its draft figures before its token counts (M5 Max, v2-r2; abridged):

  POST /v1/chat/completions (2 msgs, ...)
    [spec-stats] mode=mtp attempts=30 accepts=83 avg_per_round=2.77 per_draft_pct=87.4% depth=6 drafted=95 ...
    <- 2093+201 tokens streamed [prefill: 1120.8 tok/s, decode: 133.5 tok/s] [tool_calls]

mlx-serve's log has no clock at all, and gufo's is to the second in the machine's local time, so neither places a
request in a story's window. The tokens do: a request's prompt (read or cached) and the tokens it generated are what
the agent's client recorded for that call (pi's usage: input + cacheRead, output), and no two requests in a server's
run had the same pair (1,884 in gufo v2-r4, 3,714 in mlx-serve v2-r2). So the agent's calls are matched to the
requests in order, each within the server run that was up when it was sent (run.sh's start mark,
llama_log.start_marker; lines before any mark are one run from the beginning).

draft_acceptance is drafts accepted / drafted, over the requests matched to the counted calls. mean_accepted_len is
llama.cpp's "mean len" (1 + drafts accepted per verification round: its log's own figures fit that), weighted by
tokens generated as llama_log.summarise weights it. mlx-serve gives its rounds (attempts); gufo doesn't, so it has none.

    python3 engine_log.py <server.log>     # each request read, as JSON lines
"""
from __future__ import annotations

import bisect
import json
import re
import sys

import llama_log

GUFO_RE = re.compile(r"\[http\] request=\S+ event=completed method=POST path=/v1/chat/completions ")
GUFO_FIELD_RE = re.compile(r"(\w+)=(\S+)")
MLX_STATS_RE = re.compile(r"^\s*\[spec-stats\] mode=\S+ (.*)")
MLX_TOKENS_RE = re.compile(r"^\s*<- (\d+)\+(\d+) tokens streamed")
MLX_REQUEST = "POST "
# Strata, one line per request, in its engine log (the launcher puts that log into the server's own):
#   strata serve: prompt 54497 tokens = 54460 reused + 37 read in 231 ms (160.5 tok/s), 114 generated in 895 ms (127.4 tok/s), drafts accepted 73 of 89, 6 checkpoints
STRATA_RE = re.compile(r"^strata serve: prompt (\d+) tokens = \d+ reused \+ \d+ read in .*?, (\d+) generated in "
                       r"(?:.*?, drafts accepted (\d+) of (\d+))?")
NO_RUN_START = float("-inf")
DRAFT_KEYS = ("draft_acceptance", "mean_accepted_len")
RATIO_DECIMALS = 3          # as llama_log.summarise rounds them
LEN_DECIMALS = 2


def _fields(text: str) -> dict:
    return dict(GUFO_FIELD_RE.findall(text))


def _int(fields: dict, key: str) -> int | None:
    try:
        return int(fields[key])
    except (KeyError, ValueError):
        return None


def parse(text: str) -> list[dict]:
    """Finished requests, in order: start (when the server run they are in started, epoch s), prompt and gen
    (tokens), and draft_accepted, draft_generated, mean_len where the server gave them."""
    reqs: list[dict] = []
    start = NO_RUN_START
    stats: dict | None = None             # mlx-serve: the draft figures of the request in flight
    for line in text.splitlines():
        if (m := llama_log.MARKER_RE.match(line)):
            start, stats = float(m.group(1)), None
        elif (m := STRATA_RE.match(line)):
            r = {"start": start, "prompt": int(m.group(1)), "gen": int(m.group(2))}
            if m.group(3) is not None:
                r.update(draft_accepted=int(m.group(3)), draft_generated=int(m.group(4)))
            reqs.append(r)
        elif GUFO_RE.search(line):
            f = _fields(line)
            prompt, gen = _int(f, "prompt_tokens"), _int(f, "generated_tokens")
            if prompt is None or gen is None:
                continue
            r = {"start": start, "prompt": prompt, "gen": gen}
            acc, proposed = _int(f, "draft_accepted"), _int(f, "draft_proposed")
            if acc is not None and proposed is not None:
                r.update(draft_accepted=acc, draft_generated=proposed)
            reqs.append(r)
        elif line.startswith(MLX_REQUEST):
            stats = None                  # a new request: what the last one printed was its own
        elif (m := MLX_STATS_RE.match(line)):
            stats = _fields(m.group(1))
        elif (m := MLX_TOKENS_RE.match(line)):
            r = {"start": start, "prompt": int(m.group(1)), "gen": int(m.group(2))}
            acc, drafted, rounds = (_int(stats or {}, k) for k in ("accepts", "drafted", "attempts"))
            if acc is not None and drafted is not None:
                r.update(draft_accepted=acc, draft_generated=drafted)
                if rounds:
                    r["mean_len"] = 1 + acc / rounds
            reqs.append(r)
            stats = None
    return reqs


def _tokens(c) -> tuple | None:
    return None if c.out is None else (c.fresh + c.cached, c.out)


def _in_order(where: dict, wants: list, at: int) -> list[int | None]:
    """Each wanted pair's request index (where: pair -> its indices, ascending), from `at` on, in order; None for a
    pair the run doesn't have after the one before."""
    out: list[int | None] = []
    for want in wants:
        idx = where.get(want, [])
        k = bisect.bisect_left(idx, at)
        j = idx[k] if k < len(idx) else None
        if j is not None:
            at = j + 1
        out.append(j)
    return out


def _fit(got: list[int | None]) -> tuple[int, int]:
    """How well a placement fits a story: the most calls matched, then the tightest stretch of the run (a story's
    requests come together, with only its compactions' and cut-off calls' between them)."""
    hit = [j for j in got if j is not None]
    return len(hit), -(hit[-1] - hit[0]) if hit else 0


def match(reqs: list[dict], calls: list) -> list[dict | None]:
    """The request for each call (accounting.Call), or None: in order, by tokens, in the server run up when it was
    sent. A call with no request (cut off, or the log doesn't have it) takes none, so the ones after it still match.
    A story's log is one stretch of a server run that other stories' requests share: it starts at whichever request
    with its first call's tokens lets the most of its calls match in order, closest together (_fit), so another
    story's request with the same tokens can't take its place."""
    runs = sorted({r["start"] for r in reqs})
    by_run: dict[float, list[dict]] = {s: [r for r in reqs if r["start"] == s] for s in runs}
    found: dict[int, dict] = {}
    for s in runs:
        mine = [i for i, c in enumerate(calls) if max((u for u in runs if u <= c.sent), default=None) == s]
        run, wants = by_run[s], [_tokens(calls[i]) for i in mine]
        where: dict[tuple, list[int]] = {}
        for j, r in enumerate(run):
            where.setdefault((r["prompt"], r["gen"]), []).append(j)
        first = next((w for w in wants if w in where), None)
        best = max((_in_order(where, wants, j) for j in where.get(first, [0])), key=_fit)
        found.update({i: run[j] for i, j in zip(mine, best) if j is not None})
    return [found.get(i) for i in range(len(calls))]


def summarise(reqs: list[dict]) -> dict:
    """draft_acceptance and mean_accepted_len over the requests, None where nothing was drafted or no rounds known."""
    acc = sum(r.get("draft_accepted", 0) for r in reqs)
    drafted = sum(r.get("draft_generated", 0) for r in reqs)
    lens = [(r["mean_len"], r["gen"]) for r in reqs if "mean_len" in r]
    made = sum(n for _, n in lens)
    return {"draft_acceptance": round(acc / drafted, RATIO_DECIMALS) if drafted else None,
            "mean_accepted_len": round(sum(l * n for l, n in lens) / made, LEN_DECIMALS) if made else None}


def draft(text: str, calls: list, counted: list) -> dict:
    """Draft figures for the counted calls (a subset of calls, the same objects) from the server's log; {} when
    none of them is in it."""
    counted_ids = {id(c) for c in counted}
    mine = [r for c, r in zip(calls, match(parse(text), calls)) if r is not None and id(c) in counted_ids]
    return summarise(mine) if mine else {}


def main(argv: list[str]) -> None:
    for r in parse(open(argv[0], errors="replace").read()):
        print(json.dumps(r))


if __name__ == "__main__":
    main(sys.argv[1:])

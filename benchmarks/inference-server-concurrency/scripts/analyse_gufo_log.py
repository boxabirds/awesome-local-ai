#!/usr/bin/env python3
"""Exploratory: what a gufo server's request log says about concurrency. Not the future tool (see ../design.md).

    podman logs <gufo container> > gufo.log
    python3 -I analyse_gufo_log.py gufo.log

Reads the `event=received` and `event=completed` lines of gufo's HTTP log and prints: how busy the server was, how
requests queued, how the prompt cache behaved by prompt size, the draft depth gufo actually used, which requests were
cold starts, and a closed-loop simulation of N agents sharing the server one request at a time.

Assumptions, each stated where it matters: a speculative step yields its accepted drafts plus one verified token
(so steps = generated - accepted); a think gap longer than AWAY_S is a person away, not an agent working; the
simulation resamples this log's (gap, service time) pairs, treats requests as independent, and leaves service times
unchanged by sharing.
"""
import random
import re
import statistics as st
import sys
from datetime import datetime

AWAY_S = 300                 # a gap longer than this is a person away or a session over
WINDOW_S = 600               # busy-fraction window
BUSY_WINDOW = 0.80           # a window above this is "busy"; below IDLE_WINDOW it is "idle"
IDLE_WINDOW = 0.10
RUNAWAY_TOKENS = 5000        # more generated tokens than this is a runaway, left out of the speed and queue figures
COLD_CACHED_SHARE = 0.20     # under this share of the prompt cached: a cold start
PROMPT_BANDS = ((0, 100_000), (100_000, 131_072), (131_072, 10**9))
AGENT_COUNTS = (1, 2, 3, 4)
SIM_REPS, SIM_STEPS, SIM_SEED = 300, 300, 3
START_SPREAD_S = 20          # agents start at random offsets within this many seconds
P90, P99 = 0.90, 0.99
MS_PER_S = 1000


def stamp(text: str) -> float:
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").timestamp()


def pct(values: list, p: float):
    values = sorted(values)
    return values[min(len(values) - 1, int(p * len(values)))]


def load(path: str) -> list[dict]:
    received, rows = {}, []
    for line in open(path, errors="replace"):
        if "event=received" in line:
            m = re.match(r"(\S+ \S+).*request=(r\d+)", line)
            received[m.group(2)] = stamp(m.group(1))
        elif "event=completed" in line:
            f = dict(re.findall(r"(\w+)=([^\s]+)", line))
            end = stamp(line[:19])
            duration, queue = float(f["duration_ms"]) / MS_PER_S, float(f["queue_ms"]) / MS_PER_S
            rows.append({
                "id": f["request"], "end": end, "service": duration - queue, "queue": queue,
                "start": end - duration + queue, "arrival": received.get(f["request"], end - duration),
                "prompt": float(f["prompt_tokens"]), "prefill": float(f["prefill_tokens"]),
                "cached": float(f["cached_tokens"]), "generated": float(f["generated_tokens"]),
                "ttft": float(f["ttft_ms"]) / MS_PER_S, "decode_tps": float(f.get("decode_tps", 0)),
                "accepted": float(f.get("draft_accepted", 0)), "proposed": float(f.get("draft_proposed", 0)),
            })
    return sorted(rows, key=lambda r: r["end"])


def busy_and_queue(rows):
    first, last = rows[0]["arrival"], rows[-1]["end"]
    wall = last - first
    print(f"requests {len(rows)} over {wall / 3600:.1f} h; server busy {sum(r['service'] for r in rows) / wall * 100:.1f}% of wall-clock")
    windows = [sum(max(0, min(r["end"], w + WINDOW_S) - max(r["start"], w)) for r in rows) / WINDOW_S
               for w in range(int(first), int(last), WINDOW_S)]
    active = [x for x in windows if x >= IDLE_WINDOW]
    print(f"{len(windows)} windows of {WINDOW_S // 60} min: {sum(x > BUSY_WINDOW for x in windows) / len(windows) * 100:.0f}% busy (>{BUSY_WINDOW:.0%}), "
          f"{sum(x < IDLE_WINDOW for x in windows) / len(windows) * 100:.0f}% idle (<{IDLE_WINDOW:.0%}); "
          f"the {len(active)} active windows average {st.mean(active) * 100:.0f}%")
    queues = [r["queue"] for r in rows]
    print(f"queue: median {st.median(queues) * MS_PER_S:.0f} ms, p90 {pct(queues, P90):.1f} s, max {max(queues):.1f} s; "
          f"{sum(q > 5 for q in queues)} of {len(rows)} waited over 5 s")


def by_prompt_band(rows):
    print("by prompt size (runaway generations left out):")
    for lo, hi in PROMPT_BANDS:
        s = [r for r in rows if lo <= r["prompt"] < hi and r["generated"] < RUNAWAY_TOKENS]
        if not s:
            continue
        t = [r["ttft"] - r["queue"] for r in s]
        label = f"{lo // 1000}k+" if hi >= 10**8 else f"{lo // 1000}k-{hi // 1000}k"
        print(f"  {label:<9} n={len(s):3d}  decode median {st.median(r['decode_tps'] for r in s):.1f} tok/s  "
              f"re-read median {st.median(r['prefill'] for r in s):.0f} / p90 {pct([r['prefill'] for r in s], P90):.0f} tokens  "
              f"first token (queue out) median {st.median(t):.1f} s / p90 {pct(t, P90):.1f} s")


def draft_depth(rows):
    s = [r for r in rows if r["proposed"] > 0]
    gen, acc, prop = (sum(r[k] for r in s) for k in ("generated", "accepted", "proposed"))
    steps = gen - acc
    print(f"draft depth (assumes steps = generated - accepted): acceptance {acc / prop * 100:.1f}%, "
          f"{prop / steps:.2f} drafts proposed per step, {gen / steps:.2f} tokens per step")
    per = [r["proposed"] / (r["generated"] - r["accepted"]) for r in s if r["generated"] >= 200 and r["generated"] > r["accepted"]]
    print(f"  per request (>=200 tokens, n={len(per)}): median {st.median(per):.2f}, p90 {pct(per, P90):.2f}, max {max(per):.2f}")


def cold_starts(rows):
    cold = [r for r in rows if r["cached"] < COLD_CACHED_SHARE * r["prompt"]]
    print(f"cold starts (under {COLD_CACHED_SHARE:.0%} cached): {len(cold)} of {len(rows)}")
    for r in sorted(cold, key=lambda r: r["prompt"]):
        print(f"  prompt {r['prompt']:7.0f} tokens, took {r['service']:6.1f} s, generated {r['generated']:.0f}")


def simulate(rows):
    kept = [r for r in rows if r["generated"] < RUNAWAY_TOKENS]
    raw = [(r["arrival"] - p["end"], r["service"]) for p, r in zip(kept, kept[1:])]
    pairs = [(max(0, g), s) for g, s in raw if g <= AWAY_S]
    alone = sum(s for _, s in pairs) / sum(g + s for g, s in pairs)
    print(f"simulation: {len(pairs)} of {len(raw)} request pairs kept (gaps over {AWAY_S} s dropped); one agent alone keeps the server {alone * 100:.0f}% busy")
    random.seed(SIM_SEED)
    base = None
    for n in AGENT_COUNTS:
        waits, busy, span = [], [], []
        for _ in range(SIM_REPS):
            t = [random.uniform(0, START_SPREAD_S) for _ in range(n)]
            free, work, count = 0.0, 0.0, [0] * n
            while min(count) < SIM_STEPS:
                i = min((k for k in range(n) if count[k] < SIM_STEPS), key=lambda k: t[k])
                start = max(t[i], free)
                gap, service = random.choice(pairs)
                waits.append(start - t[i])
                free, work = start + service, work + service
                count[i] += 1
                t[i] = free + gap
            busy.append(work / free)
            span.append(max(t))
        base = base or st.mean(span)
        print(f"  {n} agent(s): wait mean {st.mean(waits):5.1f} s, p90 {pct(waits, P90):5.1f} s | server busy {st.mean(busy) * 100:3.0f}% | "
              f"each agent takes {st.mean(span) / base:.2f}x as long")


if __name__ == "__main__":
    log = load(sys.argv[1])
    busy_and_queue(log)
    by_prompt_band(log)
    draft_depth(log)
    cold_starts(log)
    simulate(log)

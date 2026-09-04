# Effective tok/s by context band — 2026-09-04

Effective tokens per second is completion tokens over TTFT plus decode time.
It is what the work feels like, and it is the figure this repo prefers: decode
alone hides the wait before the first token, which is most of the difference
between a fast model and a fast session.

All local figures were taken on an **Apple M5 Max, 128 GB unified memory,
macOS 26.4 (build 25E246), MLX 0.32.1 / mlx_lm 0.31.3**, from real OpenCode
sessions — not a synthetic loop. They are medians within a context band, over
the request counts shown.

Effective tok/s, with each column's decay against its own 20–45k figure in
brackets:

| Context used | Qwen3.8-27B (8-bit) | Flash-Next 2.10.x | Flash-Next 2.11.1 | Opus 5 (hosted) |
|---|---:|---:|---:|---:|
| 20–45k | 25.0 (100%) | 36.1 (100%) | **72.0 (100%)** | 39.2 (100%) |
| 45–75k | 23.2 (93%) | 36.8 (102%) | **59.5 (83%)** | 42.0 (107%) |
| 75–130k | 16.1 (64%) | 36.3 (101%) | **55.6 (77%)** | 39.3 (100%) |
| 130–260k | 12.8 (51%) | — | — | 37.8 (96%) |
| 260–500k | — | — | — | 34.8 (89%) |

Cells with fewer than three requests are shown as `—`.

**There is no 0–20k row.** A coding-agent session is essentially never under
20k: OpenCode's system prompt and tool schemas put the floor around 6.8k, and
one file read takes it past 26k. The band is populated only by a session's
first turn, so it measures how many sessions were sampled rather than anything
about the model. The old 0–20k figures were also the least comparable in the
table — the Flash-Next 2.10.x value came almost entirely from requests logged
before thermal sampling existed. Everything is therefore based on 20–45k.

Requests behind each cell:

| Context used | Qwen3.8-27B | Flash-Next 2.10.x | Flash-Next 2.11.1 |
|---|---:|---:|---:|
| 20–45k | 18 | 43 | 27 |
| 45–75k | 28 | 36 | 38 |
| 75–130k | 57 | 27 | 33 |
| 130–260k | 60 | 0 | 0 |

Read the bracketed column, not the absolute one. The 27B decays steeply
(100 → 64%), Flash-Next 2.11.1 decays gently (100 → 77%), the hosted model
barely decays at all — and Flash-Next 2.10.x does not decay, which turns out to
be the most interesting entry in the table and is not what it looks like.

## Where each column comes from

| Column | Served model | When | Source |
|---|---|---|---|
| Qwen3.8-27B | `mtplx-qwen38-27b-optimized-quality` | 22 Aug – 1 Sep | `mtplx_session_report.py --by-context` |
| Flash-Next 2.10.x | `mtplx-flash-next-optimized-speed` | 31 Aug – 1 Sep | same |
| Flash-Next 2.11.1 | `mtplx-flash-next-optimized-speed` | 4 Sep, after 15:40 | same |
| Opus 5 | hosted API | 1 Sep | **not reproduced here — see below** |

The three local columns were re-derived with
[`mtplx_session_report.py`](../benchmarks/mtplx_session_report.py) reading
`~/.mtplx/logs/request-log-<port>.jsonl`, splitting the arms on the MTPLX
upgrade timestamp. The 27B and Flash-Next 2.10.x columns reproduce the
2026-09-01 run exactly.

**The Opus 5 column is carried forward from that earlier run and was not
re-measured or verified here.** Its method is not recorded in this repo. Treat
it as provenance-unknown until someone re-derives it; it is kept only because
removing a column silently is worse than labelling it.

## What the 2.11 column does and does not show

In the three bands where both Flash-Next arms have data, 2.11.1 runs **1.5–2x**
2.10.x — 36.1 → 72.0 at 20–45k, 36.8 → 59.5 at 45–75k, 36.3 → 55.6 at 75–130k.

**That 2x is not a version measurement.** The two arms differ in thermal state
as much as in build: the 2.10.x population is 84 of 144 requests at `heavy`
thermal, the 2.11.1 population mostly `nominal` and `moderate`. Comparing them
directly compares fans as much as code.

## The decay curves, decomposed by thermal state

The aggregate table makes it look as though the two builds have differently
*shaped* curves — 2.10.x flat across 20–130k, 2.11.1 decaying. Most of that is
a mixture artefact, and seeing why is worth more than the headline.

**Flash-Next 2.10.x — effective tok/s:**

| Context used | nominal | moderate | heavy | unsampled |
|---|---:|---:|---:|---:|
| 0–20k | 40.6 (n=3) | — | — | 52.4 (n=16) |
| 20–45k | 42.6 (n=6) | — (n=2) | 34.6 (n=36) | — |
| 45–75k | 39.5 (n=4) | 45.6 (n=4) | 34.6 (n=32) | — |
| 75–130k | 36.4 (n=3) | 40.4 (n=8) | 34.3 (n=16) | — |

**Flash-Next 2.11.1 — effective tok/s:**

| Context used | nominal | moderate | heavy | unsampled |
|---|---:|---:|---:|---:|
| 0–20k | — (n=1) | — | — | — |
| 20–45k | 71.8 (n=14) | 71.8 (n=17) | — (n=1) | — |
| 45–75k | 57.3 (n=14) | — (n=1) | 59.5 (n=24) | — |
| 75–130k | — (n=1) | 56.4 (n=14) | 53.8 (n=18) | — |

Two artefacts were manufacturing the shape difference. The 2.10.x 0–20k figure
of 52.2 is *entirely* the 16 `unsampled` requests, logged before thermal
sampling began on 31 Aug 22:01; its nominal 0–20k value is 40.6, not 52.2. And
the flat "~36 across every band" is the heavy-thermal population, which supplies
84 of that column's requests and dominates every band above 20k.

**What survives is the real finding.** At heavy thermal, 2.10.x reads
34.6 → 34.6 → 34.3 across three bands — within 0.3 tok/s, on n=36/32/16. That
is not a decay curve, it is a **clamp**: the thermal floor sits below whatever
context decay would have produced, so context stops mattering. 2.11.1 at heavy
thermal reads 59.5 → 53.8, comfortably above that floor, so its context decay
is still visible through it.

So the honest statement is not "the builds have different curve shapes". It is:
**both decay with context within a thermal state; 2.10.x was clamped hard
enough at heavy load to hide its own curve, and 2.11.1 is not.** Whether that
is because 2.11.1 is simply faster, or because it produces less heat for the
same work, this data cannot separate — that needs power draw or a sustained
fixed-load run.

One caution on strength: the 2.10.x `nominal` column is n=6/4/3, so its mild
decay (42.6 → 39.5 → 36.4) is suggestive at best. The heavy-thermal flatness is
the well-sampled part and carries the argument.

## What clears the gates

Controlling for thermal state, one cell clears both of this repo's gates
(`DRIFT_FLOOR_PCT` 20%, `MAX_IQR_PCT` 25% — see
[`thermal.py`](../benchmarks/thermal.py)):

| Thermal | 2.10.x decode | 2.11.1 decode | Delta | Verdict |
|---|---|---|---|---|
| nominal | 51.5 (n=16, IQR 19.8%) | 70.0 (n=30, IQR 19.9%) | +36.1% | **moved** |
| moderate | 49.2 (n=14, IQR 27.3%) | 72.6 (n=32, IQR 25.0%) | +47.6% | not comparable — spread |
| heavy | 45.9 (n=84, IQR 23.8%) | 62.1 (n=43, IQR 26.4%) | +35.4% | not comparable — spread |

So **+36.1% is the defensible figure and ~2x is the uncontrolled one.** The two
failing cells point the same way, and the context confound runs against the
finding rather than for it — the 2.11.1 nominal arm ran at 45.3k median context
against 29.7k for 2.10.x, which should make it slower, not faster. That is
suggestive. It is not three-of-three.

## What this does NOT establish

**Version attribution is inferred, not recorded.** MTPLX's request log carries
no version field. The split is on the upgrade timestamp; it is sound here only
because no Flash-Next request falls in the ambiguous window. A log field would
make this durable, and its absence is why the arms had to be cut by hand.

**These are session logs, not a controlled comparison.** Every request has a
different prompt, completion length and cache-hit rate, so within-population
spread is 20–70%. The controlled harness
([`mtplx-throughput.sh`](../benchmarks/mtplx-throughput.sh)) produced 1.2–8.4%
spread on the same machine the same day. Session logs answer "what did this
cost me"; only the harness answers "did the version change anything", and the
2.10.1 arm no longer exists on this machine to run it against.

**The 2.11.1 column stops at 130k.** The session has not gone past it, so the
two longest bands are untested — and 2.10.x has no data there either, so
whether the 1.5x advantage at 75–130k holds, widens or closes above 130k is
simply unknown for Flash-Next in either build.

**The two Flash-Next columns are different numbers of sessions.** 2.10.x
aggregates several days across multiple session starts; 2.11.1 is one
continuous session. That matters most at the short-context end, which is why
the 0–20k row was dropped, but it also means the 2.10.x column mixes cold and
warm session banks in proportions the 2.11.1 column does not.

**Nothing here measures output quality.** No scored task, no held-out
benchmark, no human comparison. A throughput advantage says nothing about
whether the answers are as good.

**Per-request rows are not committed.** These are aggregates from real coding
sessions; the underlying telemetry is not published. Re-derive from your own
sessions with the reporter.

## Reproducing

```sh
# per-context and per-thermal medians for a live or past session
python3 benchmarks/mtplx_session_report.py --port 8010 --since 7d --by-context
python3 benchmarks/mtplx_session_report.py --port 8010 --since 7d --by-thermal

# controlled version comparison -- baseline FIRST, the old build is gone after
LABEL=before REPEATS=3 ./benchmarks/mtplx-throughput.sh
uv tool upgrade mtplx
LABEL=after  REPEATS=3 ./benchmarks/mtplx-throughput.sh
python3 benchmarks/mtplx-version-compare.py results/before.json results/after.json
```

# Measured results — Qwen3.8-Flash-Next / macOS / MTPLX

All figures here were taken on an **Apple M5 Max, 128 GB unified memory,
macOS 26.4 (build 25E246), MLX 0.32.1 / mlx_lm 0.31.3, mtplx 2.10.1**, on
2026-09-01. This is the machine class the combination targets, so unlike the
27B combination these are measurements, not extrapolations.

| File | Harness | What it shows |
|---|---|---|
| `ab-session-flash-next.json` | `benchmarks/mtplx_session_report.py` | A real OpenCode session: 69 requests logged, 65 scored, with per-thermal and per-context breakdowns and the matched-cell ratios against the 27B |
| `logs/ab-session-flash-next-requests.jsonl` | MTPLX request log | The raw rows, 333 fields per request |

If a figure elsewhere in this repo is not traceable to a file here, treat it
as unverified.

## Reading the comparison

`vs_27b_matched` is the number that matters, and it is deliberately not a
single ratio. Comparing two models across a whole session compares their
thermal states and context distributions as much as the models, so the ratios
are computed within matched cells — same thermal state, same context band:

| Context band | Flash-Next vs 27B |
|---|---|
| 20–45k | 2.16x |
| 45–75k | 1.65x |
| 75–130k | 1.98x |
| all, heavy thermal | 1.92x |

The spread between 1.65 and 2.16 is real and is why no single headline ratio
appears in this repo's catalogue.

The `thermal` block shows why cells matter: decode median is 52.4 tok/s at
`nominal`, 61.0 at `moderate` and 47.9 at `heavy`. The `moderate` figure is
higher than `nominal` on only 6 samples — that is noise, not a finding, and it
is recorded rather than smoothed away because hiding it would make the other
cells look more precise than they are.

## The falsified prediction

The prior expectation, written down before the run, was that the macOS memory
pressure guard would trim the session bank to zero on a 77.3 GB pack, so
warm-prefix restores would never happen. It did not: `restored_median` is
0.988, and the bank held 93–100% throughout. The 131072 context window (against
262144 on an earlier load) left enough headroom.

This is kept because it was wrong. The pack's draft acceptance is ~60% against
the 27B's ~78% — on the older reasoning, that plus a dead session bank should
have made it slower. It is roughly 1.9x faster instead, because MoE memory
traffic dominates both effects. Acceptance is not the whole story.

## What this does NOT establish

Nothing here measures output quality. Both arms ran the same agent workload,
but no scored task, no held-out benchmark, and no human comparison was run.
A 1.9x throughput advantage says nothing about whether the answers are as good.

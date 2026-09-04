# Measured results — Qwen3.8-27B / macOS / MTPLX

All figures here were taken on an **Apple M5 Max, 128 GB unified memory,
macOS 26.4 (build 25E246), MLX 0.32.1 / mlx_lm 0.31.3, mtplx 2.10.1**, between
2026-08-22 and 2026-09-01.

**No 64 GB machine was used.** This combination is filed under `64GB` because
the pack wires 27.9 GB and fits that class of machine, not because it was
measured there. Every figure below is a 128 GB measurement. Treat the sizing
claims as extrapolated and the throughput claims as measured — on a machine
with more headroom than the one the combination targets.

| File | Harness | What it shows |
|---|---|---|
| `ab-session-27b.json` | `benchmarks/mtplx_session_report.py` | A real OpenCode session: 63 requests logged, 52 scored; and a clean 31-request window used as the like-for-like arm against Flash-Next |
| `logs/ab-session-27b-requests.jsonl` | MTPLX request log | The raw rows behind it, 333 fields per request, including per-depth draft acceptance and session-bank accounting |
| `throughput-ctx1k.json` | `benchmarks/mtplx-throughput.sh` | MTP vs autoregressive at 1k context: 42.7 vs 17.0 tok/s |
| `throughput-ctx1k-32k.json` | `benchmarks/mtplx-throughput.sh` | The same at 1k and 32k: 34.6 vs 15.7 tok/s at 32k |
| `mtp-depth-sweep.json` | `mtplx tune` | Depth sweep AR/D1–D3; best D3 at 53.59 tok/s, 3.145x over AR |
| `logs/mtp-depth-*.json` | `mtplx tune` | Per-depth acceptance curves behind that verdict |

If a figure elsewhere in this repo is not traceable to a file here, treat it
as unverified.

## Reading the throughput numbers

There are two headline rates and they measure different things.

`mtp-depth-sweep.json` reports **53.59 tok/s** at depth 3. That is a short
greedy generation on a warm prefix, chosen to isolate the speculative-decoding
speedup from everything else — which it does well: 3.145x over the 17.04 tok/s
autoregressive baseline on the same machine.

`ab-session-27b.json` reports **26.2 tok/s decode, 21.8 effective** over a
clean 31-request agent session at ~53k median context. That is what the work
actually feels like.

Both are true. The second is the one to quote when comparing against anything
you would really do, and it is what this combination's `config.sh` advertises.

Note also that the depth sweep chose D3 (53.59) over D2 (54.62) despite D2
being marginally faster in raw rate: `mtplx tune` applies
`prefer_deeper_within_pct: 2.0`, on the grounds that a deeper draft is more
robust across prompts than a 1.9% rate difference measured once.

## Reading the session numbers

`decode_median` is tokens per second while decoding. `effective_median` is
completion tokens over (TTFT + decode elapsed) — it includes the wait before
the first token, so it ranks models the way a user would. The two diverge most
where TTFT is large, which is why both are recorded.

The top-level `results` block covers the whole 63-request window, which
includes a session that ran out to 201,779 tokens of context and returned
zero-token responses. `fresh_session` is the clean 31-request window after
that one was abandoned, and is the correct arm to compare against Flash-Next.
The difference between the two (23.6 vs 26.2 decode) is the cost of that long
context, and is itself the evidence for the 131072 cap.

## Re-verification

2026-09-04: the harnesses were ported into this repo from a standalone
scratchpad. `mtplx_session_report.py` was re-run against the same request log
and reproduced decode 26.1 / acceptance 78% against the archived 26.2 / ~78%,
within the harness's own 20% drift floor. The numbers above were not re-taken.

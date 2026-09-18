# Bonsai 2 27B on a 16 GB MacBook Air M2 (2026-09-18)

One run of [`benchmarks/apple-silicon-probe.sh`](../../../benchmarks/apple-silicon-probe.sh),
the first measurement this repo has of Bonsai 2 on Apple silicon rather than
[the third-party reports](../../measuring-bonsai2-on-apple-silicon.md#what-others-have-reported-on-16-gb).

| | |
|---|---|
| Machine | MacBook Air M2, 16 GB, macOS 26.6.2, `Mac14,2` — **fanless** |
| Weights | `Ternary-Bonsai-2-27B-PTQ1_0.gguf`, 5.53 GiB, 1.75 bpw ternary |
| Backend | llama.cpp fork, Metal, build `d8f26eec7` (10683) |

## What it measured

| | |
|---|---|
| Headline | pp512 **30.30 ± 5.65** tok/s, tg128 **3.83 ± 0.28** tok/s |
| Thermal soak, 5 runs | 7.63 → 4.23 tok/s, **−44.6%**: throttling, sustained is not the headline |
| Context ceiling | loads to **262144**, resident 7032 MiB (allocation only, no prefill) |
| KV types | q5_1 keeps a Metal kernel — pp512 26.34 ± 0.19, no CUDA-style cliff |

The thermal decline is the finding. A fanless M2 gives up nearly half its rate
by the fifth consecutive run, which matches the M3 Air column in the
third-party table and not the fan-cooled M1 one.

## This is not yet a combination

**Section A, the coherence check, came back empty.** The probe captured no
output and flagged it for a human. Until someone confirms this model emits
sensible text on this machine, every tok/s figure above is a rate for tokens
of unverified content — and `measuring-bonsai2-on-apple-silicon.md` is explicit
that coherence is checked *before* any throughput number is recorded.

Still open, from the probe's own operator notes:

- Was the section A output actually sensible prose/code?
- Any stalls, beachballs or memory pressure?
- Did the chassis get hot, and what else was running?

So this lives in `docs/research/` as evidence, not in
`combinations/bonsai/2/27b/macos/16GB/`. Promoting it needs the coherence
gap closed and the `config.sh` / `profiles.tsv` / `help.txt` / installer set
that [adding a combination](../../adding-a-combination.md) requires.

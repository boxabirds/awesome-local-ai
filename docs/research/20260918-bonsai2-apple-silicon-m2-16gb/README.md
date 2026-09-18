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

## Coherence: checked by hand, and it passes

Section A of the report is blank because the probe captured nothing —
`.sample.txt` came back 0 bytes. That is a **capture failure, not a model
failure**, and the automated heuristic below it cried wolf. The probe has since
been taught to tell those two cases apart.

The operator ran the same prompt by hand. The model generates correctly. Two
observations worth carrying forward:

- The output is **verbose**.
- It emits **the same code three times** in one answer.

That second point is the one with teeth. At 3.83 tok/s, tripling the answer
triples the wait: the *useful* rate on this machine is nearer **1.3 tok/s
equivalent** for a single copy of the code. Any comparison against the
third-party MLX numbers above has to say whether those runs were similarly
repetitive, or it is not comparing like with like.

Still unanswered, and only the operator can:

- Any stalls, beachballs or memory pressure during the soak?
- Did the chassis get hot, and what else was running?

## Why this is still not a combination

Coherence is settled; the rest of the furniture is not. Promoting this to
`combinations/bonsai/2/27b/macos/16GB/` needs the `config.sh` /
`profiles.tsv` / `help.txt` / installer set that
[adding a combination](../../adding-a-combination.md) requires — plus a view on
whether a model that triples its output is worth shipping a profile for.

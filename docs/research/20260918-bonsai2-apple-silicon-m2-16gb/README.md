# Bonsai 2 27B on a 16 GB MacBook Air M2 (2026-09-18)

> **Ternary quantisation solved the memory problem and handed the bill to
> prefill.** The 27B fits a 16 GB laptop with room to spare — 262k of context
> in 7 GB — and then takes **20 minutes to read a 32k prompt**. Not enough
> memory was never the problem; not enough compute is, and a fanless chassis
> gives up another third of it to heat.

One run of [`benchmarks/perf/apple-silicon-probe.sh`](../../../benchmarks/perf/apple-silicon-probe.sh),
the first measurement this repo has of Bonsai 2 on Apple silicon rather than
[the third-party reports](../../measuring-bonsai2-on-apple-silicon.md#what-others-have-reported-on-16-gb).

Which of prefill and generation binds depends on the workload, and for this
repo's purpose it is prefill. A coding agent's turn is characteristically a big
read and a small write — put 20k of files in front of the model, get 1k of
edits back — which at the measured sustained rates is **12 minutes reading
against 4 minutes writing**. For chat, short prompt and long answer, the
ordering reverses and generation is what hurts. The 27B is not unusable here;
it is unusable *as an agent*.

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

Answered by the operator: **the chassis got really hot.** Which is what the
-44.6% across five runs already implied, and confirms the throttling reading
rather than, say, a background process stealing the GPU.

## Two artefacts of the probe, now fixed

Both were the harness's fault, not the machine's, and both are corrected in
`benchmarks/perf/apple-silicon-probe.sh`:

**The headline was a warm number.** Section B ran straight after the download
and the coherence check, while the 180 s cooldown sat only in front of the
thermal soak. So the "headline" 3.83 tok/s was measured on a hot machine, and
the first thermal run — the same benchmark, cooled — gave **7.63**. Both are
real; only one was labelled. The cold rate also matches the 7.2 tok/s the
operator saw by hand. The probe now cools before the headline too and says so
in the report.

**The coherence capture was empty because of `llama-cli`.** It renders its chat
to the terminal, and a plain `> file` redirect caught nothing. The check now
runs through `llama-server` and parses JSON, which either works or fails
loudly, and reports `reasoning_chars` / `content_chars` separately.

## The context ceiling is real and almost useless

262144 loads in 7032 MiB, which sounds like the headline finding. It is not,
because *loading* a context and *filling* one are different problems and only
the first was measured. At the sustained 27 tok/s prompt rate:

| prompt | time to read it |
|---|---|
| 2,048 (a small edit) | 1.3 min |
| 8,192 (one file) | 5.1 min |
| 32,768 (a few files) | **20 min** |
| 131,072 (the 128k profile) | 81 min |
| 262,144 (the ceiling that fits) | **162 min** |

The same 262k prompt costs 1.4 minutes on the 24GB combination's 4090. **This
machine is ~112x slower at reading a prompt than the card this repo already
supports**, for identical weights.

That is the number that decides it. A coding agent's characteristic move is to
put a few files in front of the model, and twenty minutes before the first
token is not a slow tool, it is a different category of thing. Generation makes
it worse rather than better: 4.23 tok/s sustained, against an answer the
operator observed containing the same function three times.

(These rows are arithmetic on the measured rates, not separate measurements.
Nothing here prefilled a long context — doing so would have taken most of an
afternoon, which is rather the point.)

## It is not the 16 GB

The obvious conclusion from this run is "16 GB is not enough for a 27B". That
is the wrong lesson, and it matters because it points at the wrong fix.

**Memory was never the binding constraint here.** The model loaded a 262144
context in 7032 MiB and left roughly 9 GB of the machine unused. Ternary
quantisation did exactly what it claims: it solved the memory problem
completely. What it cannot do is change how much compute a 27B forward pass
costs, or how much of it a fanless laptop can sustain.

Prefill is the discriminator, and it tracks the chip class, not the RAM:

| machine | prefill tok/s | 32k prompt | generation |
|---|---|---|---|
| M2 Air 16GB — sustained *(measured here)* | 27 | **20.2 min** | 4.2 |
| M2 Air 16GB — cold *(measured here)* | 42 | 13.0 min | 7.6 |
| M3 Pro 18GB, v1 ternary *(community)* | 79 | 6.9 min | 12.6 |
| M5 Pro, Bonsai 2 *(publisher)* | 387 | 1.4 min | 28.1 |
| M5 Max, v1 ternary *(publisher)* | 765 | 0.7 min | 47.0 |
| RTX 4090 24GB *(measured here)* | 3016 | **0.2 min** | 92.2 |

Reading a 32k prompt inside a minute needs about **546 tok/s** of prefill. Only
the Max-class part and the discrete GPU clear it, and the rows above are not
separated by memory: an M2 Air with 64 GB, had Apple built one, would be
exactly this slow. A fan would help — the Air gives up a third of its rate to
heat within five runs — but a fan does not close a 14x gap to the M5 Pro.

So the finding is not about 16 GB. It is that **ternary quantisation moves the
constraint from memory to compute**, and having moved it, laptop-class silicon
is where it now binds. That is the same conclusion the 24GB combination reached
from the other direction, when two co-resident servers turned out to be limited
by compute rather than VRAM.

## Why 27 tok/s, when the machine has 100 GB/s

Because 100 GB/s is a statement about decode, and the number that hurts is
prefill. They are bound by different things.

**Decode is bandwidth-bound and behaves exactly as the spec predicts.** Batch-1
decoding streams every weight once per token — 5.94 GB — so the ceiling is
100 / 5.94 = **16.8 tok/s**. The cold 7.63 tok/s is 45.3 GB/s of effective
bandwidth, about 65% of what a base M2's GPU realistically reaches. Unremarkable.

**Prefill is compute-bound and bandwidth says nothing about it.** Processing 512
tokens loads each weight once and reuses it across all 512, so arithmetic
intensity is ~512x higher and FLOPS is the ceiling:

| | achieved | share of peak |
|---|---|---|
| M2 Air, sustained | 1.46 TFLOPS | 21% |
| M2 Air, cold | 2.27 TFLOPS | 32% |
| RTX 4090 | 88.8 TFLOPS | 54% |

Raw FLOPS gap 24x (≈7 against ≈165 TFLOPS fp16), utilisation gap 2.6x, product
**61x** — against a measured PTQ1_0 gap of 1645/27 = **61x**. The arithmetic
closes, so nothing here is unexplained.

## The packing was the wrong one, and for an instructive reason

This run used `PTQ1_0`, chosen because it is 1.26 GB smaller and the machine has
only 16 GB. That reasoning was wrong, and the run above is what proves it:
memory never came close to binding — 262144 of context fitted in 7032 MiB with
~9 GB spare.

Meanwhile `PTQ1_0` packs trits densely in base 3 and has to unpack them with
arithmetic, in the one phase that has no arithmetic to spare. Measured on the
4090, that costs half the prefill rate: **1597 tok/s against PQ2_0's 3016**.

So the slowest-prefilling packing was benchmarked on the most prefill-starved
machine, to save memory that was not scarce. If the same ratio holds on Metal,
`PQ2_0` would put this machine nearer 40-55 tok/s of prefill and a 32k prompt
nearer 10-13 minutes. That does not change the verdict — it is still not an
agent — but the 27 tok/s figure should not be quoted as Bonsai 2's prefill rate
on an M2. The probe now downloads `PQ2_0` and makes it primary.

## Why this is still not a combination

Coherence is settled and the furniture is buildable: `config.sh` /
`profiles.tsv` / `help.txt` / installer, per
[adding a combination](../../adding-a-combination.md), and thanks to
`LLAMA_REPO_URL` it needs no shell logic. The reason not to is the arithmetic
above.

This repo's pitch is a capable model with a coding agent already wired up. On
this machine that agent waits 20 minutes to read a few files and then receives
4 tokens a second of triplicated output. Shipping a `profiles.tsv` would say
the pairing was tested and works, and the honest reading is that it runs but
does not work — a distinction a profile table cannot express.

What would change the answer:

- **MLX instead of llama.cpp Metal.** On the previous ternary generation MLX
  was ~1.8x llama.cpp Metal on the same M1 Pro. Applied here that is ~7 tok/s
  sustained and ~50 tok/s prefill — better, still not enough for 32k prompts,
  and it costs a new backend module rather than a config file.
- **A smaller model.** The 8B ternary packs are a fifth the size; nothing in
  this repo has measured one, and 27B-on-a-laptop may simply be the wrong
  ambition for 16 GB.
- **Different work.** Short prompts and short answers — chat, single-function
  edits — are fine at these rates. That is not what this repo installs
  OpenCode for.

So: recorded, reproducible, and deliberately not promoted. The measurement was
worth taking precisely because it says no.

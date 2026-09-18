# Can we finally get AI Local coding agents running on a 16GB Mac?

*Draft — 2026-09-18. Every figure is measured on the machine named, unless the
line says otherwise. Sources: [the 24GB combination's benchmarks](../../combinations/bonsai/2/27b/ubuntu/24GB/llamacpp-opencode/benchmarks/README.md),
[the M2 Air note](../research/20260918-bonsai2-apple-silicon-m2-16gb/README.md),
[the concurrency analysis](../research/20260918-bonsai2-concurrent-sessions.md).*

Bonsai is a new Qwen 3.8 27b variant released recently that promises huge memory savings.

Were they enough for my lowly M2 Macbook Air 16GB? What about my Macbook Pro M5 Max and my 4090??

---

## Where we started

Before Bonsai, both of my capable machines had a local setup that worked — and
they worked for completely different reasons.

The **4090** runs Qwen3.8-27B as a 4-bit GGUF under llama.cpp. It holds a 128k
context in 24 GB, but only just: 22,398 MiB of a 24,047 MiB card, with the
micro-batch shrunk to 256 purely to make it fit. It reaches its ~92 tok/s
headline only because a multi-token-prediction head roughly doubles a ~44 tok/s
base rate.

The **M5 Max** runs something else entirely: Qwen3.8-Flash-Next, a 512-expert
MoE, served by MTPLX. That model does not fit in 24 GB at all. It is on the Mac
because 128 GB of unified memory means it does not have to.

| at 128k context | 4090 + Qwen3.8-27B | M5 Max + Flash-Next |
|---|---|---|
| decode, shallow | 46.1 tok/s ¹ | ~35 tok/s at 27k |
| decode, deep | 32.4 tok/s at 128k | ~11–18 tok/s at 200k |
| decode, headline | ~92 tok/s with MTP | 49.8 tok/s median ² |
| effective, incl. time-to-first-token | not measured | 38.8 tok/s |
| time to first token | not measured | 2.0 s median |
| memory at 128k | 22,398 MiB — 93% of the card | — |

¹ Measured with speculative decoding **off**, which is the honest basis for
comparison later. ² Median over 65 scored requests from real OpenCode sessions,
not a synthetic loop — a stricter number than the 4090 column, which is
`llama-bench`. The two columns are not measured with the same instrument, and
there is no clean way to fix that: Flash-Next runs on MTPLX and cannot go
through `llama-bench`, and there is no effective-tok/s harness on the llama.cpp
side. Read the columns as descriptions of each setup, not as a race.

Both usable. Both spending essentially the whole machine on one person.

## What Bonsai changes

Bonsai 2 is that same Qwen3.8-27B with its weights requantised to **ternary** —
every weight is −1, 0 or +1, with one scale per 128 of them. About 1.72 bits per
weight, 6.7 GB instead of 16.7. The architecture is untouched, so this is purely
a change of representation, not a different model.

On the 4090 it is not a modest gain. Same card, same flags, speculative decoding
off on both sides:

| context depth | Bonsai 2 | Qwen3.8-27B | speedup |
|---|---|---|---|
| 0 | 92.2 tok/s | 46.1 tok/s | **+100%** |
| 8k | 87.6 | 44.9 | **+95%** |
| 32k | 76.0 | 41.6 | **+82%** |
| 128k | 49.9 | 32.4 | **+54%** |
| prefill | 3,016 tok/s | 2,309 tok/s | **+31%** |
| memory at 128k | **10,663 MiB** | 22,398 MiB | **−52%** |

Bonsai matches the 27B's *speculative-decoding* headline with no drafter at all.
It has none — nobody ships one for it, and borrowing the Qwen MTP head was
measured a net loss, 95.8 → 92.6 tok/s at 0.62 draft acceptance. The ternary
target is cheap enough that a 1.6 GB drafter costs more than it saves.

### The memory column is the real story

Qwen at 128k occupies 93% of the card. You cannot run two. Bonsai at 128k
occupies 44% — and because slots inside one llama.cpp server share a single copy
of the weights, adding a session costs only its KV cache:

| concurrent 128k sessions, one 4090 | VRAM |
|---|---|
| 1 | 10,663 MiB |
| 2 | 13,607 |
| 3 | 16,551 |
| 4 | 19,495 |
| **5** | **22,438** |
| 6 | 25,382 — does not fit |

**Five 128k coding sessions fit in the memory Qwen3.8-27B needed for one.** A
consumer GPU stops being a single-user appliance.

(That table is arithmetic on a memory model derived from two measured points,
which predicts a third to within 1 MiB. The capacity is solid; what four
simultaneous sessions each *feel* like has not been measured end to end.)

### And on the M5 Max, the twist

Bonsai 2 on the M5 Max decodes at **40.5 tok/s**. Flash-Next on the same machine
does **49.8**. Bonsai is **19% slower** on the machine with 128 GB.

Which makes sense the moment you say it plainly: Bonsai's entire advantage is
needing less memory, and that is worth nothing on a machine that had plenty. The
128 GB Mac is better off with the bigger model it can already hold.

**Bonsai's value is inversely proportional to how much memory you have.**

## The drum roll: the M2 Air

Which is exactly why the 16 GB laptop should have been its best showing.

And the memory part worked perfectly. It loaded the **full 262,144-token context
in 7 GB**, leaving nine of my sixteen untouched. Every footprint claim held up.

Then I ran the same benchmark five times in a row:

| M2 Air 16GB, consecutive runs | prefill | decode |
|---|---|---|
| run 1 | 42.5 tok/s | 7.6 tok/s |
| run 2 | 41.2 | 6.3 |
| run 3 | 26.8 | 3.7 |
| run 4 | 26.6 | 4.2 |
| run 5 | 27.1 | 4.2 |
| | **−36%** | **−45%** |

The chassis was hot to the touch. There is no fan. Any single number you read
about a fanless machine is a statement about its first thirty seconds.

Against the other two, same weights, same build:

| | prefill | decode | read a 32k prompt |
|---|---|---|---|
| **M2 Air 16GB** | 27 tok/s | 4.2 tok/s | **20 minutes** |
| M5 Max | 244 | 40.5 | 2.2 minutes |
| RTX 4090 | 3,016 | 92.2 | **10 seconds** |

### Why this is specifically an uphill battle for coding agents

Here is the part that took me longest to understand, and it is the reason a
chatbot is fine on this machine and an agent is not.

Ask a model a question and it types an answer back. That is **generation**, and
it is limited by memory bandwidth — how fast the machine can stream six
gigabytes of weights, once per token produced. Apple silicon is genuinely good
at this. The M2 Air achieves 45 GB/s of its 100 GB/s, which is a respectable
fraction, and it is why the 27B feels fine for chat.

But a coding agent barely does that. Its characteristic move is to put your
files in front of the model — twenty or thirty thousand tokens — and get back a
few hundred tokens of edit. That first half is **reading**, and reading is a
different operation on the hardware: every weight is loaded once and reused
against every token of your prompt simultaneously. That is not limited by
bandwidth at all. It is limited by raw arithmetic, and a fanless laptop musters
roughly 7 TFLOPS against a 4090's 165.

So the number everyone quotes about Apple silicon — unified memory bandwidth —
predicts the half that agents barely use, and says nothing about the half that
dominates them. The gap works out at 61x, and the measurements reproduce that to
within rounding.

Twenty minutes to read a few files is not a slow tool. It is a different
category of object.

### The real lesson

This was never a memory problem, and that is the part worth taking away.
Ternary quantisation solved the memory problem outright — completely, on the
first try, with room to spare — and handed the bill straight to compute. Once
the bill is there, a fanless laptop is where it lands hardest.

An M2 Air with 64 GB, had Apple built one, would be exactly this slow.

---

*Caveats worth keeping: the two columns in the first table use different
measurement instruments. The five-session figure is derived from a validated
memory model, not measured end to end. And the whole steady-state argument
assumes prefix caching works — the model prefills once and then only processes
each turn's delta — which
[an open issue on the vendor's repo](https://github.com/PrismML-Eng/Bonsai-demo/issues/147)
suggests may not always hold.*

# Can we finally get AI Local coding agents running on a 16GB Mac?

*Draft — 2026-09-18. Every figure is measured on the machine named, unless the
line says otherwise. Sources: [the 24GB combination's benchmarks](../../combinations/bonsai/2/27b/ubuntu/24GB/llamacpp-opencode/benchmarks/README.md),
[the M2 Air note](../research/20260918-bonsai2-apple-silicon-m2-16gb/README.md),
[the concurrency analysis](../research/20260918-bonsai2-concurrent-sessions.md).*

Bonsai is a new Qwen 3.8 27b variant released recently that promises huge memory savings.

Were they enough for my lowly M2 Macbook Air 16GB? What about my Macbook Pro M5 Max and my 4090??

---

## Two numbers, in plain English

Everything below is measured in **tokens per second**. A token is roughly
three-quarters of a word, so 40 tokens/sec is about 30 words a second — faster
than you can read.

But there are two different speeds, and the whole article turns on the
difference:

- **Reading speed** — how fast the model gets through the code you hand it
  before it does anything. Ask it about a few files and that is 20–30,000
  tokens it has to read first.
- **Typing speed** — how fast it produces the answer, once it starts.

You mostly notice typing speed in a chatbot. As we will see, a coding agent is
dominated by reading speed, and the two are limited by completely different
parts of the machine.

## Where we started

Before Bonsai, both of my capable machines had a local setup that worked — and
they worked for completely different reasons.

The **4090** runs Qwen3.8-27B as a 4-bit GGUF under llama.cpp. It holds a 128k
context in 24 GB, but only just: 22,398 MiB of a 24,047 MiB card, with the
micro-batch shrunk to 256 purely to make it fit. It only reaches its ~92 tokens/sec
headline because of speculative decoding, which roughly doubles a ~44
tokens/sec base rate.

The **M5 Max** runs something else entirely: Qwen3.8-Flash-Next, a 512-expert
MoE, served by MTPLX. That model does not fit in 24 GB at all. It is on the Mac
because 128 GB of unified memory means it does not have to.

| | 4090 + Qwen3.8-27B | M5 Max + Flash-Next |
|---|---|---|
| **Typing speed**, early in a session | 46.1 tokens/sec ¹ | ~35 tokens/sec at 27k |
| **Typing speed**, with a full 128k loaded | 32.4 tokens/sec | ~11–18 at 200k |
| **Typing speed**, best case | ~92 tokens/sec ³ | 49.8 tokens/sec ² |
| **Wait before it starts typing** | not measured | 2.0 seconds |
| **What you actually feel**, wait included | not measured | 38.8 tokens/sec |
| **Memory used** at 128k | 22,398 MiB — 93% of the card | — |

¹ With speculative decoding **off**, which is the honest basis for the
comparison later. ³ Speculative decoding is a trick where a small fast model
guesses the next few tokens and the big model checks them; when the guesses are
good it roughly doubles typing speed for free. ² Median over 65 scored requests from real OpenCode sessions,
not a synthetic loop — a stricter number than the 4090 column, which is
`llama-bench`. The two columns are not measured with the same instrument, and
there is no clean way to fix that: Flash-Next runs on MTPLX and cannot go
through `llama-bench`, and nothing measures the
llama.cpp side the same way. Read the columns as descriptions of each setup, not as a race.

Both usable. Both spending essentially the whole machine on one person.

## What Bonsai changes

Bonsai 2 is that same Qwen3.8-27B with its weights requantised to **ternary** —
every weight is −1, 0 or +1, with one scale per 128 of them. About 1.72 bits per
weight, 6.7 GB instead of 16.7. The architecture is untouched, so this is purely
a change of representation, not a different model.

On the 4090 it is not a modest gain. Same card, same flags, speculative decoding
off on both sides:

| | Bonsai 2 | Qwen3.8-27B | difference |
|---|---|---|---|
| Typing speed, empty context | 92.2 tokens/sec | 46.1 | **+100%** |
| Typing speed, 8k loaded | 87.6 | 44.9 | **+95%** |
| Typing speed, 32k loaded | 76.0 | 41.6 | **+82%** |
| Typing speed, 128k loaded | 49.9 | 32.4 | **+54%** |
| **Reading speed** | 3,016 tokens/sec | 2,309 | **+31%** |
| **Memory used** at 128k | **10,663 MiB** | 22,398 | **−52%** |

Bonsai matches the 27B's *speculative-decoding* headline with no drafter at all.
It has none — nobody ships one for it. I tried borrowing the 27B's, and it
made things *slower*: 95.8 → 92.6 tokens/sec. The guessing model has to be run
too, and Bonsai is now cheap enough that checking someone else's guesses costs
more than just doing the work.

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

Bonsai 2 on the M5 Max types at **40.5 tokens/sec**. Flash-Next on the same
machine does **49.8**. Bonsai is **19% slower** on the machine with 128 GB.

Which makes sense the moment you say it plainly: Bonsai's entire advantage is
needing less memory, and that is worth nothing on a machine that had plenty. The
128 GB Mac is better off with the bigger model it can already hold.

**Bonsai's value is inversely proportional to how much memory you have.**

## The drum roll: the M2 Air

Which is exactly why the 16 GB laptop should have been its best showing.

And the memory part worked perfectly. It loaded the **full 262,144-token context
in 7 GB**, leaving nine of my sixteen untouched. Every footprint claim held up.

Then I ran the same benchmark five times in a row:

| M2 Air, five runs back to back | Reading speed | Typing speed |
|---|---|---|
| run 1 | 42.5 tokens/sec | 7.6 tokens/sec |
| run 2 | 41.2 | 6.3 |
| run 3 | 26.8 | 3.7 |
| run 4 | 26.6 | 4.2 |
| run 5 | 27.1 | 4.2 |
| **lost to heat** | **−36%** | **−45%** |

The chassis was hot to the touch. There is no fan. Any single number you read
about a fanless machine is a statement about its first thirty seconds.

Against the other two, same weights, same build:

| | Reading speed | Typing speed | Time to read a few files (32k) |
|---|---|---|---|
| **M2 Air 16GB** | 27 tokens/sec | 4.2 tokens/sec | **20 minutes** |
| M5 Max | 244 | 40.5 | 2.2 minutes |
| RTX 4090 | 3,016 | 92.2 | **10 seconds** |

### Why this is specifically an uphill battle for coding agents

Here is the part that took me longest to understand, and it is the reason a
chatbot is fine on this machine and an agent is not.

Ask a model a question and it types an answer back. **Typing speed** is
limited by memory bandwidth — how fast the machine can stream six
gigabytes of weights, once per token produced. Apple silicon is genuinely good
at this. The M2 Air gets 45 GB/s out of a possible 100, which is a perfectly respectable
fraction — and it is why this model feels fine for chat.

But a coding agent barely does that. Its characteristic move is to put your
files in front of the model — twenty or thirty thousand tokens — and get back a
few hundred tokens of edit. That first half is **reading speed**, and reading is
a completely different operation on the hardware: every weight is loaded once and reused
against every token of your prompt simultaneously. That is not limited by
bandwidth at all. It is limited by raw arithmetic — how many
sums the chip can do at once — and a fanless laptop manages about a
twenty-fourth of what a 4090 does.

So the number everyone quotes about Apple silicon — unified memory bandwidth —
predicts the half that agents barely use, and says nothing about the half that
dominates them. Reading is where the 4090 is 61 times faster, and the measurements match that
prediction almost exactly.

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

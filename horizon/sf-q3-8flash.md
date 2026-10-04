# sf-q3-8flash: DwarfStar cut down to Qwen3.8 Flash-Next on Metal, measured on an M5 Max

**Status:** candidate for the M5 Max, gated on the checks below (4 Oct 2026). Not run. Supersedes
[DwarfStar](dwarfstar.md) as the ds4-family candidate for that machine: same engine family, but with figures on our
own hardware, which ds4's own documentation does not publish for any Mac.
**Kind:** a fourth engine for the model we already benchmark there, beside mlx-serve, MTPLX and TensorFold.
**Source:** [github.com/Chida82/sf-q3-8flash](https://github.com/Chida82/sf-q3-8flash), MIT, C, created 19 Sep 2026,
last pushed 3 Oct 2026, 2 stars, no open issues. Read 4 Oct 2026 (README only; nothing run).

## What it is

A reduction of antirez's [ds4](dwarfstar.md) to **one model and one backend**: Qwen3.8 Flash-Next (`qwen4exp`) on
Apple Metal. Everything else — other models, other GPU backends, the bundled agent — is deleted from the tree
rather than switched off. Not a GitHub fork object: a detached copy that tracks upstream through `sync-*` tags and
records, in `docs/upstream-prs.md`, which upstream pull requests it took and which it rejected.

The author's stated reason is that a tree small enough to read whole — by a person or a model — makes it cheap to
try an idea on this one model and keep or drop it on measurement. Metal only, because the only machine it is
developed and tested on is **an Apple M5 Max with 128 GB**, which is our machine.

Kept from ds4: the HTTP server (OpenAI chat/completions **and** Responses, Anthropic Messages, streaming, batching,
**tool calls**), built-in MTP, disk KV cache, vision, directional steering across all 48 trunk layers, and the
BF16 n-gram table read straight from the GGUF rather than loaded. Same two downloads as ds4: Q2 (137.10 GiB on
disk, 41.73 GiB resident) and Q4 (165.11 GiB, 69.74 GiB resident).

## What it measured against ds4 (its own figures, 27 and 29 Sep 2026, one M5 Max)

Its headline claim is that it is faster than its parent on the same machine and the same weights. Q4, the size we
would run (and see "What testing it would actually achieve" below: speed is not the reason to run it):

| | ds4 | sf | |
|---|---:|---:|---:|
| prefill, 32,768 context | 1,107.9 t/s | 1,234.9 t/s | +11.5% |
| prefill, 65,536 context | 907.4 t/s | 994.0 t/s | +9.5% |
| generation, 32,768 context | 48.5 t/s | 52.4 t/s | +8.1% |
| generation, 65,536 context | 41.7 t/s | 44.1 t/s | +5.9% |
| CLI generation, MTP | 77.8 t/s | 85.9 t/s | +10.4% |

**How it holds itself to that.** Performance work must not change the model's output: a CLI check requires
token-identical output against the same GGUF, and the A/B harness requires identical tokens against the previous
build. The harness alternates builds in ABBA order and reports bootstrap 95% intervals; every change appends a row
to `speed-bench/perf-record.md` against a fixed start commit. Without MTP its text is identical to ds4's in all six
CLI cases; with MTP it equals its own plain text, after a fix (`82-mtp-greedy-divergence`) that made each MTP verify
row compute as a single decoded token would. That is a more disciplined bar than most forks set, and more than we
ask of our own engines.

## How it compares with what the M5 Max already runs

Our mlx-serve runs there measure a **median 58 tok/s decode over 7 runs**, at the benchmark's context and on real
stories. Set beside that, this fork's figures say two different things depending which row is read:

- **CLI generation with MTP, 85.9 t/s**: well above mlx-serve, but a short-prompt CLI benchmark.
- **Generation at 65,536 context, 44.1 t/s**: *below* mlx-serve's median, and the trend over its own sweep is
  downward (54.4 at 2,048 to 44.1 at 65,536, an 18% fall).

**Its sweep stops at 65,536. The benchmark runs at 131,072.** So the number that would decide this is the one
nobody has: generation at our context. The same gap as [Strata](strata.md), for the same reason — published
benchmarks stop short of the context a coding agent actually carries.

Quantisation also differs from everything else on that machine, so a quality difference could not be attributed to
the engine (see Confounds).

## What testing it would actually achieve

Not memory: the M5 Max has 128 GB, and the whole ds4 design — small resident weights, the n-gram table left on
disk — answers a problem that machine does not have. Not speed either, on the published figures: 44.1 t/s at 65,536
context is below the **58 tok/s median our mlx-serve runs already measure** at the benchmark's own context, and the
one row that beats it (85.9 with MTP) is a short-prompt CLI benchmark.

**The reason to run it is quality, and it is specific.** Flash-Next's n-gram table is 51B parameters. Our mlx-serve
pack carries it as **one 4-bit `ngram_table.bin` (32.00 GB)**, dequantised 16 rows at a time on the CPU per token.
This fork carries the **original BF16 table**, read from the GGUF. Nobody has measured what quantising a
51B-parameter table to 4 bits costs, and our best Mac stack is the one doing it.

A series here would not isolate the table — engine, expert quantisation and MTP all differ at once — but it would
answer the question the owner actually has: whether a stack that keeps the table at BF16 scores better on the
held-out suite than one that quantises it. If it does, the next question is whether mlx-serve can be made to keep
it too.

## Checks before a run

1. **Generation at 131,072 context**, which no published figure covers. If it falls much below mlx-serve's 58
   tok/s there, the case is gone.
2. **Memory at that context.** Q4 is 69.74 GiB resident before context and runtime buffers; the machine has 128 GB
   and a story also runs the agent, browsers and test servers. Q2 (41.73 GiB) is the fallback.
3. **Tool calls over the API with pi's real requests** — the class of problem behind gufo issue 304.
4. **Cross-turn caching past 120k tokens**, as for [TensorFold](tensorfold.md): every turn must reuse the prompt.
5. A one-story smoke test. No separate smoke story: the checks above are the ten-minute ones.

## Confounds

Engine, quantisation and MTP all differ from mlx-serve at once; its Q4 (Q4_K gate/up, MXFP4 down) is not the pack
any other stack runs, so a quality difference cannot be read as the engine's. One author, one machine, two stars:
its figures are self-reported, on the same machine class as ours, with a method stated plainly enough to repeat.
No releases or tags, so a pin is a commit.

**Last checked:** 4 Oct 2026 (README only). **Recheck when:** the M5 Max has a free window after the mlx-serve
series, or the author publishes a figure at 128k context.

Sources: [repository](https://github.com/Chida82/sf-q3-8flash) · [ds4](https://github.com/antirez/ds4) ·
[our DwarfStar note](dwarfstar.md)

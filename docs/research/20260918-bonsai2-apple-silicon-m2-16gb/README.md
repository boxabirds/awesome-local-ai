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

## Two artefacts of the probe, now fixed

Both were the harness's fault, not the machine's, and both are corrected in
`benchmarks/apple-silicon-probe.sh`:

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

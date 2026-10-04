# Strata

**Status:** combination written (3 Oct 2026), to run after the Swift 1.5 baseline on the RTX 4090 machine; engine checks
passed at 131,072 tokens of context. Next: the real install, a harness release, then five runs. Details below.
**Machine:** the RTX 4090 machine (Ubuntu or Windows). Would give it a Flash-Next stack, the same model
family as the Strix Halo box and the M5 Max, for a hardware comparison we don't have.

## What it is

An MIT-licensed server that runs Qwen3.8 Flash-Next (125B mixture-of-experts) on one consumer NVIDIA card
(RTX 30/40/50, 12 GB or more; AMD 7900 XT/XTX experimental on Linux): the busiest experts on the GPU, all of
them in RAM, a lookup table on the SSD. OpenAI- and Anthropic-compatible API, reasoning effort off/low/medium/
high, MTP drafting. Version 0.1.x. Models: the original Flash-Next, ISTA-DASLab's Coder (half the experts
removed) and UkisAI's Swift 1.5 for Flash-Next, at Q2_0, IQ2_XS, IQ3_XXS or IQ3_S.

## Checks before a run

1. Tool calls: the docs cover chat and "MCP tools" in its own interface; OpenAI `tools` / tool-call
   support over the API is not confirmed.
2. Cross-turn caching: the same multi-turn test past 120k tokens as [TensorFold](tensorfold.md). Its own
   figures give 4.5 minutes to read a 262k prompt, so re-reading every turn would be a blocker.
3. Memory: it needs "shard 1 + about 10 GB" of RAM (it loads 35-55 GB); the RTX 4090 machine has 62 GB and a run also
   puts the agent, browsers and test servers there. Check the memory guard's headroom on a real story.
4. Then a one-story smoke test.

## Confounds

1- to 3-bit quantisation (GSQ-RCO) against our IQ4_XS and mixed 4/8-bit Flash-Next runs; the Coder variant
is effectively a different model. Start with the full model at IQ3_S.

## What we measured (2 Oct 2026, the RTX 4090 machine, nothing else running)

Strata v0.1.36, compiled on the machine (CUDA 12.3), with `ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF` at revision
`ed59f920`, quantization IQ3_XXS (75.8 GB in two files, both sha256-checked against Hugging Face), the MTP draft
layer, `--max-context 131072 --kv int8 --spec 4`. IQ3_XXS was the owner's choice: the larger sizes do not leave a
usable margin in 63 GB of RAM.

| | Measured |
|---|---|
| Start to ready | about 25 s |
| RAM (engine resident) | 42.7 GiB at start, 43.5 GiB after a 128k-token conversation, of 62 GiB |
| VRAM | 23.8 to 24.0 GiB of 24.6 GiB |
| Tool calls (OpenAI API, two turns, two tools) | structured `tool_calls` both times; arguments parse as JSON; a newline inside a string argument is kept |
| Prompt read, cold | 54,465 tokens in 12.6 s (4,323 tok/s); 111,583 tokens in 25.3 s (4,412 tok/s) |
| Prompt reuse | every later turn reused all but the new tokens: 54,460 of 54,497; 127,962 of 128,001 |
| Turn time with the prompt reused | about 1 s at 54k and at 128k |
| Generation | 104 to 173 tok/s on short replies; drafts accepted about 80 to 95% |

Two things to watch:

- At startup it warned: "243 MiB of VRAM free with everything loaded - LOW: requests may stall; add
  `--vram-reserve-mib 969` to the config's args (or lower `--max-context`)". No request stalled in these tests, which
  were short replies. A harness backend should set the reserve.
- These are synthetic prompts and replies of under 200 tokens. Nothing here says anything about quality: IQ3_XXS is
  a heavier quantization than any Flash Next pack the other machines run.

How it was set up, for the backend: `./setup.sh --yes --family qwen --model IQ3_XXS --context 131072 --no-start`
needs a Python with venv and a cmake newer than Ubuntu 22.04's 3.22 on PATH (uv's CPython 3.12 and the cmake in
Strata's own `.venv/bin` were used). Its downloader is one connection per file and was slow; the files were fetched
with ranged requests over 16 connections and setup accepted them as already downloaded. The server is
`serve/server.py --engine strata --config strata-iq3_xxs.json --host 127.0.0.1 --port N` (drop the start script's
`--open`, which opens a browser).

## What other people report (4 Oct 2026, unverified)

Relayed by the owner, with no source or machine given: users running GSQ-RCO on Strata report about **60 tok/s
generation and 1,000 tok/s prefill**, against about **30 tok/s and 300 tok/s prefill** for Unsloth's IQ3_XXS on
llama.cpp. Memory use not reported.

Both figures are **well below what this machine measured** on 2 Oct (104 to 173 tok/s generation, 4,300 to 4,400
tok/s prefill), and the memory question is answered above: 43.5 GiB of RAM and 24.0 GiB of VRAM at 128k context.
So the reports neither add nor contradict anything we need; they are kept here only so the same claim is not
chased twice. If the gap matters later, the likely causes are a smaller card, no MTP drafting, a larger
quantisation, or longer replies than the short ones measured here. Our own figures are from synthetic prompts with
replies under 200 tokens, and a real story's decode rate will be lower.

**What this combination also answers:** its runs use the same IQ3_XXS pack as a 12 GB card would, so their
held-out score decides whether the floor for a useful coding agent drops to much cheaper hardware. See
[Strata on a small card](strata-small-card.md).

## Three releases since our pin (read 4 Oct 2026)

We pin **v0.1.36** (commit `36fa455e`). Upstream is now **v0.1.39** (`6f32ec07`, 4 Oct). Nothing has run on 0.1.36
yet, so changing the pin costs nothing today; changing it after the series starts would break comparability.

- **v0.1.37** (2 Oct): `--vram-reserve-mib N` is documented, which is the flag our startup warning asked for. A
  **silent-engine watchdog**: if the engine prints nothing for `engine_silence_s` (default 300, longer while a long
  prompt is read; 0 turns it off), the server ends the request and the next one restarts the engine. Our own guard
  interrupts a tool call silent for 600 s, so the two now overlap — worth setting deliberately rather than
  discovering on a story. Steadier PCIe probe; AMD-on-Windows fixes we don't need.
- **v0.1.38** (3 Oct): **a security change that could break our install.** Without an `api_key` the server answers
  only requests addressed to a name it knows and returns 403 to cross-site requests; `/unload` and `/load` take
  JSON only. Our launcher binds 127.0.0.1 and pi uses an SDK that sends no `Origin`, so it should be unaffected —
  but that is a check, not an assumption. Also: faster prompts (Q2_0 +10% at 4K, +3% at 128K), `--kv q4_0` on
  tensor cores, and a 6 GB card that starts.
- **v0.1.39** (4 Oct): decode **+6%** (IQ3_XXS 46.1 -> 48.8 tok/s on their RTX 5070), long prompts **+18.5%** at 32K
  for IQ3_XXS *with a 1,500-slot expert cache* and unchanged with setup's default config, `POST /v1/responses` (the
  OpenAI Responses API, for Codex), several requests at once (opt-in, off by default), and a fix for prompts under a
  RAM budget that 0.1.38 made 15-40% slower. **A long prompt's output bits change against 0.1.38**, because the
  experts go through a different mix of cached and streamed groups; the author's teacher-forced check puts the
  quality in the same band (IQ3_XXS, 32K prompt: KL 0.020, top-1 95.3%).

### What this says about our own measurements

The project's README publishes its own table, measured on two gaming PCs (4K answers, 32K prompts):

| RTX 5070, 12 GB, 64 GB RAM | short chat | **at 128K context** | prompt |
|---|---|---|---|
| Q2_0 | 94 tok/s | 76 tok/s | 2,650 tok/s |
| IQ2_XS | 79 tok/s | 63 tok/s | 2,090 tok/s |
| **IQ3_XXS** (ours) | **62 tok/s** | **49 tok/s** | **1,750 tok/s** |
| IQ3_S | 53 tok/s | 46 tok/s | 1,620 tok/s |

The same page gives the AMD machine (16 GB, 47 GB RAM): Q2_0 60 short, 48 at 128K. **The fall from a short chat to
128K is 20 to 30% on both machines, not a collapse**, and the benchmark's own context (131,072) is the column on
the right. The README's headline figures are the short-chat ones at 32K prompts; docs/MODELS.md has these.

The README also says: *"A card with more VRAM is faster: an RTX 3090 (24 GB) should write about 100-140
tokens per second."*

Three things follow, and they fit together:

- **Our 104 to 173 tok/s on the RTX 4090 (24 GB) is not anomalous.** It sits in the band the project itself
  predicts for a 24 GB card. An earlier reading here, that our figure was 2 to 3 times optimistic because the
  0.1.39 notes quote 46 to 52 tok/s, was wrong: those are a different workload on a 12 GB card.
- **The user reports of about 60 tok/s are the 12 GB figure**, which is what the README prints for IQ3_XXS.
  Nothing is in dispute between them and us; they are different machines.
- **VRAM is a cache, not the model's home.** The card holds the busiest experts; the rest sit in RAM and cross
  PCIe on a miss. That is why 12 GB works at all, and why the 16 GB AMD machine with only 47 GB of RAM is *slower*
  than the 12 GB NVIDIA one with 64 GB (60 against 94 tok/s on Q2_0). RAM and PCIe matter as much as VRAM here.

What remains true: ours were synthetic prompts with replies under 200 tokens, and the README's are 4K answers, so
a recorded story is still the figure that counts.

**A gap in our own measurement.** The 2 Oct table above records the prompt side at the benchmark's context
(111,583 tokens read at 4,412 tok/s; 127,962 of 128,001 tokens reused; about 1 s a turn), but its generation figure
does not say at what context it was taken, and short replies on a nearly empty context are the easy case. Taking
the 12 GB machine's ratio (49/62, a 21% fall) as a guide, a 24 GB card might write 80 to 135 tok/s at 128K — an
inference from someone else's hardware, not a measurement. **Measure decode at 128K before the series**, in the
same ten-minute check that re-pins the version.

## The combination and the harness (3 Oct 2026)

`combinations/qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi/` exists (backend `lib/strata.sh`, launcher
`lib/runtime/server-strata.sh`, `tests/strata-test.sh`, 76 checks against stubs), and so does the harness side: Strata's
engine settings are read from its run configuration, its version is its checkout's tag, and its draft figures come from its
engine log, which the launcher follows into the server's output. Not yet installed through the real installer on the
machine, and the harness changes need a harness release before a run can carry them. The owner's order: five runs of
Strata after the Swift 1.5 baseline on the RTX 4090 machine. No smoke story: the ten-minute checks are above.

**Last checked:** 4 Oct 2026 (releases 0.1.37 to 0.1.39 read; nothing re-measured, nothing re-pinned). **Recheck when:** the real install has run and the first Strata story is recorded.

Sources: [Strata](https://github.com/Niko1221/Strata) ·
[DETAILS.md](https://github.com/Niko1221/Strata/blob/main/docs/DETAILS.md) ·
[Coder GGUF](https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-Coder-GGUF) ·
[Swift 1.5 Flash-Next GGUF](https://huggingface.co/ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF)

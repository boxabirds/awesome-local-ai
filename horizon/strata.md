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

## The combination and the harness (3 Oct 2026)

`combinations/qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi/` exists (backend `lib/strata.sh`, launcher
`lib/runtime/server-strata.sh`, `tests/strata-test.sh`, 76 checks against stubs), and so does the harness side: Strata's
engine settings are read from its run configuration, its version is its checkout's tag, and its draft figures come from its
engine log, which the launcher follows into the server's output. Not yet installed through the real installer on the
machine, and the harness changes need a harness release before a run can carry them. The owner's order: five runs of
Strata after the Swift 1.5 baseline on the RTX 4090 machine. No smoke story: the ten-minute checks are above.

**Last checked:** 3 Oct 2026. **Recheck when:** the real install has run and the first Strata story is recorded.

Sources: [Strata](https://github.com/Niko1221/Strata) ·
[DETAILS.md](https://github.com/Niko1221/Strata/blob/main/docs/DETAILS.md) ·
[Coder GGUF](https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-Coder-GGUF) ·
[Swift 1.5 Flash-Next GGUF](https://huggingface.co/ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF)

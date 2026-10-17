# DeepSeek V4.1-Flash-1017, VQ GGUF (for a DGX Spark)

**Status:** gated (17 Oct 2026). Added at the owner's request; nothing downloaded, built or run. Read from three pages: the
quantiser's model card, the engine's repository and DeepSeek's own model card. The gate is the checks below, and the first
is that the owner's DGX Spark is on the network as a node.
**Kind:** a new model family and a new engine on new hardware, so every confound in a comparison moves at once. It can be a
new combination if it runs; it is not a version bump of anything we run.
**Machine:** a DGX Spark. The owner has two (their word, 17 Oct 2026). We have none as a node yet.

## What it is

- **The artifact.** [Baekpica/DeepSeek-V4.1-Flash-1017-VQ-GGUF](https://huggingface.co/Baekpica/DeepSeek-V4.1-Flash-1017-VQ-GGUF),
  made from `deepseek-ai/DeepSeek-V4.1-Flash-1017` at revision `1bae0e10…` (all 48 input shards SHA-256 checked, per the
  card). Its only date is a status line, "2026-10-17: the conversion is finished and uploaded". MIT. 5 likes when read.
- **The model.** DeepSeek's V4.1-Flash-1017, "a minor update to DeepSeek-V4.1-Flash"; the Hub lists 763B parameters in total,
  active parameters not stated. 1M-token context, MIT. DeepSeek recommends temperature 1.0 and top_p 1.0. It has no Jinja
  chat template; thinking and tool calling are in its `encoding` folder.
- **The quantisation.** Vector quantisation (VQ) using YoungAi's recipe `vq8sh14-q4k-mtpnative`, applied unchanged. Routed
  experts are 8-dimensional VQ with one codebook per layer shared by all 384 experts (13-bit indices in layers 0-13, 12-bit in
  layers 14-39), no calibration data, "roughly 1.6 bits per routed-expert weight". Attention, shared experts, embedding and head
  are q4_K. Three draft towers (DSpark) with 12-bit VQ experts. Vision is a separate BF16 file.
- **The files.** Total download "about 318 GB": the base GGUF in 40 parts (113.6 GB), a vision file (0.97 GB), and two Engram
  safetensors shards (101.5 GB each). The card says to plan for about 114 GB of extra disk while the parts are assembled. The
  Engram tables are read from disk in rows, so it recommends a local SSD.
- **The fit claim.** The card says it is "sized for one 128 GB DGX Spark": "about 106 GiB loaded for this recipe on V4.1 Flash"
  (not a 1017 measurement), server example `--mem-budget-mb 110000`, and a full 1M-token KV cache measured at 0.89 GB (by the
  quantiser, on V4.1 Flash). It names no setup with more than one Spark. On the card's own numbers 106 GiB resident leaves
  about 22 GiB of 128 for the operating system, our agent, browsers and test servers, if both are GiB. That is arithmetic, not a
  measurement.
- **The engine.** The card says llama.cpp, Ollama and Transformers do not read this format. It needs
  [ds4-dfm-rs](https://github.com/Baekpica/ds4-dfm-rs) (the uploader's own; MIT; Rust host with native C/CUDA/Metal; README
  version v0.1.3, 2,094 commits, 15 stars when read), built with `make cuda-spark` (target `sm_121a`); YoungAi's `ds4-server`
  also reads the files. No ds4-dfm-rs commit is given for this artifact. The repository lists its lineage as
  antirez/ds4, Entrpi/ds4, Baekpica/ds4, then ds4-dfm-rs, and it is the continuation of [DwarfStar](dwarfstar.md).
  The engine page names "the 128 GB NVIDIA DGX Spark / GB10" as its release reference.
- **The API.** OpenAI-style `/v1/chat/completions`, `/v1/completions`, `/v1/responses`, and Anthropic-style `/v1/messages`,
  plus `/v1/stats` and `/metrics`. The engine page says responses "retain each surface's tool, reasoning, finish and error
  forms"; the quantiser's card does not describe tool calling or the chat template. The engine keeps conversations "through
  persistent banks, prefix reuse and disk checkpoints where the model's state contract supports them", and says disk KV
  persists checkpoints and does not offload live banks.

## Whose figures these are

| Claim | Figure | Whose |
|---|---|---|
| Terminal-Bench 4.0 | 42.3 (31.2 for V4.1-Flash) | DeepSeek, on the FP8 checkpoint, not this quantisation; its card says it used the Claude Code harness |
| DeepSWE v1.1 / ProgramBench / NL2Repo-Bench | 77.0 / 29.1 / 68.2 | DeepSeek, FP8 |
| Next-token agreement with the original, V4.1 Flash | 78.6% (code, 30 languages), 78.5% (English), 69.1% (medicine); mean KL 0.42 to 0.69 | the quantiser, on **V4.1 Flash, not 1017** |
| Weight-space cosine, 1017 routed experts | 0.925 (layers 0-13), 0.911 (layers 14-39) | the quantiser; the card says it is not a quality measurement |
| Speed on one DGX Spark | prefill 1,040 tok/s, decode 38.2 tok/s (2K-64K sweep, temperature 0, MTP on, median of three); 54-66 tok/s decode on short prompts on a later build | the quantiser, on **V4.1 Flash, not 1017**, 13 Oct |

The card says the artifact is "not a drop-in equal of the FP8 model" and that no 1017-specific quality or Spark speed
measurement has been published. None of these figures is ours, and none predicts our scores: ours are measured at
temperature 1.0 in long agent sessions, which the card's greedy sweeps are not.

## Where it could run

The two DGX Sparks, one at a time. The first question is whether it runs on **one** Spark with the agent and the held-out
suite also on that Spark. Two Sparks give two options and the card supports neither yet:

1. **Two independent nodes**, so a five-run series takes two runs at a time. This needs nothing from the model or the engine
   beyond one Spark each. It is the plain use of two machines.
2. **The two linked** to hold more than 128 GB. The card does not mention it, and neither does the engine page; treat it as
   not available until a source says it is.

A cross-check this machine would also allow, because the engine lists it: **Qwen3.8 Flash-Next** on the same engine and
hardware (the engine page gives a Q5 figure of 1,323 tok/s prefill and 28.93 tok/s decode, 2K-64K, MTP 2, its own
measurement). That would run our existing Flash-Next model on the Spark, so a DeepSeek result can be read against a model
we already score on three other machines. It is a separate decision and costs a separate series.

It would be compared first with the Flash-Next stacks in the 17 Oct 2026 state-of-play report (`docs/reports/20261017.md`, median 68-72 of 75),
which are a different model, a different quantisation family and a different engine; and with the Claude reference runs
(74-75).

## Checks before a run

1. **The Spark is a node.** `dbench` installed and `dbench serve` running on it, with its own checkout and `nodes.toml` entry.
   The Spark is an Arm Linux machine (my knowledge; neither the card nor the engine page says "aarch64"), so check that
   every part of the harness runs there: the `dbench` binary, the agent sandbox (`tools/agent-sandbox`), `pi`, Node,
   Playwright with a Chromium build for Arm Linux, and the held-out suite's own install. Any one that does not is a blocker
   that has nothing to do with DeepSeek.
2. **The right files.** The card warns that the V4.1 and 1017 Engram shards have the same names and sizes, so an engine would
   load the old ones without an error and run a mismatched model; likewise the V4.1 vision sidecar differs in about 532.6 MB
   but loads silently. Verify every file against the card's `SHA256SUMS` after download, pin the revision, and record the
   hashes with the run.
3. **Pin the engine.** Pick a ds4-dfm-rs commit (none is given for this artifact), build it, and read back what it reports as
   its version. Write the backend adapter (`lib/<engine>.sh`) with that pin so the version lands in `run.json`, and a
   version-string test first, as for gufo and mlx-serve.
4. **Tool calls over the API.** Structured `tool_calls`, arguments that parse as JSON, and a newline inside a string argument
   kept (the check Strata passed). The card is silent; the engine page mentions a "DeepSeek DSML" agent (DSML is, as far as I
   know, DeepSeek's tool-call markup; the page does not define it), so this is the check most likely to fail.
5. **How thinking comes back.** Our thinking analytics keep story runs whose thinking is complete (`think_complete`), and the
   card says the recipe under-weights stop decisions (`</think>`, end of text), so long thinking segments may not close. Run
   a short conversation in both modes and read what the API returns for reasoning. The server defaults to non-thinking.
6. **Cross-turn caching and memory in a long session.** The multi-turn test past 120k tokens (as for TensorFold and Strata):
   every later turn reuses the cache, and resident memory stays within the Spark's headroom while a run's browsers and test
   servers also run. Strata's lesson applies: a memory guard stopped a Strata run at story 7 when free memory fell under 8%.
   Read the Engram disk reads under that load too.
7. **The sampler.** DeepSeek's temperature 1.0 and top_p 1.0 against our standard sampler (temperature 1.0, top_p 0.95, top_k
   20). Decide which the run uses before it starts, and record it. The card says to send both explicitly in each request.
8. **The network.** The engine page says the server "is one trust domain and has no authentication or tenant isolation".
   Bind it to the loopback the harness uses; do not expose it on the tailnet.
9. **Then** a smoke test of ten minutes or less (the engine starts, answers, returns a tool call, reuses a prompt), then queue
   the series and watch the first story. A story is never a smoke run.

## Confounds

Everything differs from the stacks we have scored:

- **Model.** A different family from Qwen3.8, with a different tool format and thinking behaviour.
- **Quantisation.** About 1.6 bits per routed-expert weight in a vector-quantised format no other engine reads, against 3-bit
  and 4-bit scalar quantisations elsewhere. The card's own agreement figures (69% to 79% same next token as the original) are
  for a related checkpoint. Our 3-bit llama.cpp arm of Flash-Next (UD-IQ3_XXS) scored 68, 71 and 74, so a low bit width does not decide the
  outcome on its own.
- **Engine.** One maintainer's engine at v0.1.3, with its own cache policy, in place of llama.cpp, gufo, mlx-serve or Strata.
- **Hardware.** An NVIDIA Spark with 128 GB of memory shared between the model, the agent and the tests, which is closer to
  the Strix Halo and M5 Max boxes than to the RTX 4090 machine.
- **Sampler and thinking mode**, per check 5 and 7.

## Relation to the earlier note

[DeepSeek V4.1](deepseek-v4.1.md) was eliminated on 29 Sep 2026 as about 750B parameters, too large for our machines, with the
recheck "whether V4.1-Flash fits any of our machines". This note is that recheck, for a machine we did not have then: the
full-precision Flash is far beyond 128 GB, and only this 1.6-bit expert quantisation is described as fitting a Spark. The
Strix Halo and M5 Max boxes are out on the engine, not the memory: the only builds the card and the engine page name for this
model are CUDA (`make cuda-spark`), and the page's Metal path says "separate live checks required".

## Last checked and recheck

**Last checked:** 17 Oct 2026, from the three pages above, read once; nothing is measured here.
**Recheck when:** the owner's Sparks are on the network; the quantiser or the engine publishes a 1017 measurement or a pinned
commit; the engine publishes an aarch64 note or a multi-Spark recipe; or anyone reports tool calling or long-session behaviour
on this artifact.

Sources: [model card](https://huggingface.co/Baekpica/DeepSeek-V4.1-Flash-1017-VQ-GGUF) ·
[DeepSeek's card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017) ·
[ds4-dfm-rs](https://github.com/Baekpica/ds4-dfm-rs) · see also [DwarfStar](dwarfstar.md), [concurrency](concurrency.md)

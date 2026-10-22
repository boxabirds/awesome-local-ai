# DeepSeek V4.1-Flash-1017 on two DGX Sparks (Mia's AI Lab recipe)

**Status:** parked (22 Oct 2026, owner): wait a few weeks for the repo to settle; nothing is scheduled, and the Sparks are not touched for it. Was gated; the gates below still stand when it comes back. Added at the owner's request: [MiaAI-Lab/DeepSeek-v4.1-Flash-1017-2x-DGX-Sparks](https://github.com/MiaAI-Lab/DeepSeek-v4.1-Flash-1017-2x-DGX-Sparks). Nothing downloaded, built or run.
**Kind:** a new model family on a new engine, a 2.9-bit quant, on hardware we have just got. Every confound moves at once; it is not a version bump of anything we run.
**Machine:** thing1 and thing2 together as **one linked node** (tensor parallel, TP=2). See [the hardware note](dgx-spark-thing1-thing2.md). It uses both units, so nothing else runs on either while it does.
**Gate:** both Sparks on the network and enrolled as one node; the disk, memory and cabling checks below; then the first story, watched. The repo's open issues (below) are the main risk for our workload.

## What it is

A recipe, not a model: scripts, patches and a container that serve [DeepSeek V4.1-Flash-1017](deepseek-v4.1-flash-1017-vq.md) across two Sparks on TensorFold's native Zig engine. Apache-2.0 recipe; weights MIT. Read from the README, the issues page and the checkpoint's model card, once each, through a fetch summariser.

- **The checkpoint.** `Mia-AiLab/DeepSeek-V4.1-Flash-1017-EXL3-EAQ-v1-2.9-bpw` at `45ee5d0f`: 196 GiB, 39 shards, standard EXL3 (codebook `mul1`). Routed experts 3 bits (layers 18-22 at 2), attention 5, shared experts 4-5, head 6, DSpark draft tensors 4. Vision included. The unquantised **Engram tables** (shards 47 and 48, about 203 GB) come from DeepSeek's own repo at `1bae0e10`.
- **The split.** One rank per Spark over a direct ConnectX-7 QSFP cable (RoCE v2). The ranks exchange data twice per layer, so the slower unit sets the pace. About 98 GiB of weights per unit; rank 0 holds about 104 GiB on the GPU.
- **The API.** OpenAI-compatible on port 8888, model name `DeepSeek-V4.1-Flash-1017`; text, thinking on or off, tool calling, images. Optional `API_KEY`.
- **Pins.** TensorFold `629c524`; image `tensorfold-dsv41:exl3-tp2-136c93b359b4` (24.9 GB, about 6 minutes of Zig compiling per Spark); a former checkpoint revision no longer resolves.

## Whose figures

All the author's, none dated, none ours.

| Claim | Figure | Whose |
|---|---|---|
| Decode, one stream, `CONTEXT=524288` | 74.9 tok/s prose, 109.9 code (their dashboard) | author |
| Decode, `bench.py` (random words, thinking off) | 55-61 one stream, 113-117 four streams | author |
| Prefill | about 2,000-2,170 tok/s from 8K to 256K | author |
| Needle at 524,288 | 3 of 3, each prefill about 280 s | author |
| Quality vs original | KL 0.0137, 96.6% top-1 (short context); about 0.005, 99% (up to 31.2k tokens) | the checkpoint's card; teacher-forced fidelity, **not** generation quality, nothing above 31.2k |
| Baseline | BertholomusAI, earlier checkpoint, two Sparks: 59.0-106.6 decode, about 2,400 prefill | author's quote of another's |

The README says the checkpoint has **no** KL measurement; the model card has them. The two disagree (the README may be stale), so I trust neither as final. DeepSeek's own agent scores are for its FP8 model, not this quantisation.

## Open issues on the repo when read (22 Oct, all 1-2 days old)

These are what a 131k-token, tool-calling, sub-agent harness would hit, so they decide the gate:

- **#36** rank 0 segfaults in cuBLASLt with 4 agent streams and 100K-130K-token prompts.
- **#34** the whole system hangs when a sub-agent runs a local `grep` tool call.
- **#18** with `PREFILL_INTERLEAVE_MS=250` and several long prompts queued, no request gets a first token in 210 s; turning interleave off completes the same load.
- **#27, #16** cache placement evicts an agent's idle main conversation before finished sub-agents' states, and a new picture drops the previous turn's cached prefix. Our harness depends on prompt reuse across turns.
- **#21** control-token spellings in request text become real control tokens; **#22** no `response_format`; **#42** `ABLIT=1` fails on a read-only cache.
- The README itself lists a freeze risk (a rank can take all shared memory and the Spark then needs a power cycle) and says its memory guard is "a brake, not a guarantee"; #17 and #4 were ranks killed by memory.

## Open questions for the owner (logged 22 Oct 2026, unanswered)

1. **Where does the harness run?** The head probably cannot host the agent, Chromium and the tests in what is left: 112 GiB must be free on each unit of about 119 GiB, and the author's own head, with about 6 GiB of other software, was limited to a 524,288 window. This is arithmetic, not a measurement. Options: the harness on another machine than the head, or a smaller `CONTEXT`.
2. **May I log in to thing1** to check disk, free memory, the link and the Arm Linux dependencies? Read-only checks. Not asked again until this note is picked up. The GPU clock lock (`nvidia-smi -lgc 0,2200`) needs root, which is the owner's.
3. **Pair or independent?** This recipe takes both units and nothing else may run on either. Decide whether the pair is reserved for it or thing1 and thing2 stay independent nodes first.

## Checks before a run

1. **Disk.** The head needs about 505 GB plus 25 GB for the image, the worker about 310 GB. Engram tables must be on **local** disk: over NFS their reads were about 10x slower (940 vs 90 µs) and prefill fell to 690-890 tok/s. Free disk on thing1 and thing2: **not checked**.
2. **Memory, with our load.** `start.sh` refuses to start without 112 GiB free on each unit, and a Spark has 128 GB (about 119 GiB). Our harness also puts the agent, Chromium, Playwright and test servers on the node, and the author's own head was limited by only about 6 GiB of other software (524,288 recommended). Arithmetic, not measured: the harness probably has to run on a different machine from the head, or with a smaller `CONTEXT`. Decide this before enrolling the node.
3. **Cabling and clock.** A direct QSFP cable, both ports addressed in one private subnet with the same MTU on both units, `ping` working, RoCE v2 GID present (`start.sh` checks it). The author sets the GPU clock with `nvidia-smi -lgc 0,2200` on both (one unit at 1,800 MHz cost 3-6% of prefill); needs root, so that is the owner's.
4. **Software on both:** Docker with the NVIDIA runtime, key-based ssh from head to worker, `hf` CLI on the head, NFS only for the Hugging Face cache (not Engram).
5. **Pin everything** (TensorFold, image tag, checkpoint, Engram revision), verify the files, and read back the engine version for `run.json`. A version-string test first.
6. **Tool calls over the API:** structured `tool_calls`, JSON arguments, a newline in a string argument kept, several calls per turn, a call from a sub-agent (#34). The README says only that tool calling is supported.
7. **How thinking comes back** (`think_complete`). Thinking is on by default; `THINKING_BUDGET` can cut plans short and cause repeated tool calls, so leave it unset.
8. **Cross-turn caching past 120k tokens under agent load** (#27, #16), and the memory floor while a story's tests run. This is the check TensorFold failed on the Mac, on a different engine; here it is untested.
9. **Sampler.** The recipe defaults to temperature 1.0, top_p 0.95, top_k 20, which is our standard sampler; DeepSeek recommends top_p 1.0. Decide and record. `top_k` above 56 is refused.
10. **Network.** Bind the API to the node's loopback or tailnet-private address only; port 8888 has no auth unless `API_KEY=1`.
11. **A ten-minute smoke** (starts, answers, returns a tool call, reuses a prompt), then queue the series and watch story 1. A story is never a smoke run.

## Confounds

Model family (not Qwen), quantisation (EXL3 2.9 bpw, 3-bit experts, versus 3- and 4-bit GGUF elsewhere), engine (one lab's patched TensorFold), two units over a network link, and the memory-sharing arrangement for the harness. The link adds a failure mode no other arm has: either rank dying ends the run.

## Relation to other notes

- [DeepSeek V4.1-Flash-1017 VQ](deepseek-v4.1-flash-1017-vq.md): the same model on **one** Spark (1.6-bit, different engine, its own gate). Different quantiser, engine and unit count: a different arm.
- [TensorFold](tensorfold.md): parked on the M5 Max for a 47k-token window. That is MLX on a Mac; this recipe uses the CUDA/Zig engine, so the ceiling here is unknown.
- Same lab, not this item: an [Ornith-1.5-122B EXL3 quant on one Spark](ornith-1.5-122b.md) and a GB10 [exllamav3 fork](https://github.com/MiaAI-Lab/exllamav3) (MIT; batch-1 speculative decoding; no GB10 figures).

**Last checked:** 22 Oct 2026. **Recheck when:** from mid-November 2026 (the owner's "a few weeks"), or sooner if the owner asks; then look at whether #36, #34, #18 and #27 are closed, whether the README and model card agree on quality, and whether the author has published an agent benchmark.

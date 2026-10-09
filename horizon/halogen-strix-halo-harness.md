# aic0d3r's Strix Halo harness (the "halogen" engine and NPU sidecars)

**Status:** open question (9 Oct 2026). Added at the owner's request as "Strata + NPU sidecars for AMD".
**Read from the pages only, nothing installed or run:** the harness (<https://github.com/aic0d3r/qwen38-strix-halo-harness>) on 9 Oct 2026,
and halogen's own repository (<https://github.com/peonist-ai/halogen-flash-server>) and its `LICENSE.md` the same day, after the owner supplied it.
**A correction to the request's label:** the page never mentions Strata. The engine it recommends is called **halogen**
("the NPU+GPU engine stack"), a different engine from the Strata we have been running. Whether the two are related is not
stated, and halogen's own page does not mention Strata either. Treat it as a separate engine.
**Needs before it is a candidate:** a check that the engine runs on our Strix Halo box's settings (ROCm version, BIOS memory carve-out,
room for the model), a check that it loads the same GGUF as `gufo-pi` and gives the same answers, and the image digest to pin.

## What it is

A harness for running the **pi** coding agent locally on an AMD Strix Halo machine: setup and launch scripts, crash recovery,
NPU-accelerated codebase search, and a small "sidecar" model for compaction and commit messages. It says the model was never the
hard part and frames the work around it as the product. MIT licence, 46 commits, 16 stars, no releases listed; the page shows no
release dates.

- **Hardware it was measured on:** an ASUS ROG Flow Z13 (Ryzen AI MAX+ 395, Radeon 8060S, 128 GB) at 70 W sustained. The OS is
  not named (shell scripts, Docker and systemd units suggest Linux). The NPU is called only "NPU".
- **Two engine stacks.** *halogen* (recommended): Qwen3.8 Flash-Next (125B) from a local `.hgn` checkpoint (about 124 GB of
  files; its quantisation is not stated), 262,144 tokens of context over 4 slots. *llama.cpp on Vulkan*: Flash-Next as
  UD-IQ4_XS, or a 27B as UD-Q4_K_XL, with DFlash2 and MTP drafters, up to 256k context.
- **NPU sidecars.** Small models on the NPU, each a tool for the agent: a 0.6B embedding model for `codebase_search` (about 5 to 6k
  tok/s while indexing), a 0.6B reranker, a 0.6B guard that screens for prompt injection (its own canary: 42% recall, 0% false
  positives on 30 prompts), and a 0.8B "decider" for a constrained `decide` tool. Search latency about 0.2 to 1.3 s.
- **Setup:** `./setup.sh` (idempotent), `./start.sh <dir>` to heal a dead server and open pi. Needs Docker and the pi agent.

## Speeds it reports (the page's own, conditions mostly unstated)

- halogen 0.17.1: decode 64 tok/s, up from 44 on 0.16.2. Headline posts cite about 40 tok/s sustained for Flash-Next and 31 for
  the 27B, with no conditions given on the page. Prefill for the main model is not stated.
- A "warm-cache replay" line gives 336 to 382k tok/s on halogen against 133 to 147k on gufo. That is a replay of cached prompt
  tokens, not generation, and I can't tell from the page what is being compared.
- The full figures are in a separate `BENCHMARKS.md`, which I did not read.

## Limits it states

One pi task per repository for crash recovery (stale checkpoints removed by hand); recovery reliable to about 8 to 10 compactions;
**halogen is the only engine the harness verifies, and other engines lose the NPU tools and image input**; one large model server
at a time (two cause device-lost errors); cold boot can take several minutes and memory fragmentation can block a launch until a
reboot; the halogen download is at least 124 GB.

## Halogen itself (from its own repository and licence, 9 Oct 2026)

- **What it is:** a GPU inference engine and server for Qwen3.8 Flash-Next on one machine type: AMD Strix Halo (gfx1151), reference
  box a Ryzen AI Max+ 395 with 128 GB, ROCm 7.14.0. Published by the GitHub account `peonist-ai` (906 stars, 116 commits, 19 open
  issues when read). Version 0.17.3 in its quickstart. The page gives no release dates.
- **Closed source, free to use.** The repository holds deployment files, documents and tools, **no engine or kernel source**. The
  engine is a compiled binary (`flash_serve`, with gfx1151 device code) in a container image
  (`ghcr.io/peonist-ai/halogen-flash-server`, tag `0.17.3`, `:latest` also exists). Its licence is the **halogen End User License
  Agreement, version 0.1 (effective 25 Aug 2026), Peonist, LLC**, which says it does not commit to providing source. It grants free
  use for any purpose including commercial, no keys, no telemetry by default; modification for your own use but not passing a
  modified image on as halogen; reverse engineering is not prohibited. Model weights are licensed separately by their authors.
- **We may benchmark it and publish the results without approval.** It asks that published figures state the software version and the
  prompt set (a request, not a condition). Our records name the engine build already.
- **What closed source costs us.** We cannot read its sampler, quantisation handling or draft logic. We pin by **image digest** (a tag
  can move), record it, and every result says the engine cannot be inspected.
- **Interface:** OpenAI-compatible on port 8731 under `/v1`, also the Responses and Anthropic Messages APIs, and `/metrics`. A plain
  `pi` can talk to it directly; the third-party harness is not needed for that.
- **Weights: it loads GGUFs.** Besides its own `.hgn` checkpoints (v2 is the default; about 62 GiB plus a 48 GiB n-gram table), it runs
  llama.cpp GGUFs of the same model, naming Unsloth's `UD-IQ4_XS` and `UD-Q4_K_XL`, and says a GGUF converts to `.hgn` losslessly. It
  refuses Q4_1, Q2_K, Q3_K and the IQ2 and IQ1 families by name (it does not name IQ3_XXS). `gufo-pi` on the Strix Halo box runs
  `UD-Q4_K_XL`, so the same weights can be fed to both engines. That is what the Strata comparison lacked.
- **Its own limits:** one GPU and one model family; no response store; `n > 1` and several JSON-schema keywords unsupported; quality
  not measured against BF16 at scale; the BIOS graphics carve-out must be set to a minimum; a shared machine can stall badly under
  memory pressure; GPU and NPU work at once can hang the machine unless the fabric clock is held. Its licence note says throughput
  varies about 2x with prompt type (about 20 tok/s on prose, 42 on code).

## What it could tell us

- **A second engine for Flash-Next on the machine we already benchmark gufo on.** Our Strix Halo box runs Flash-Next under gufo
  with the MTP draft. A different engine on the same hardware, same weights, same client, is a one-variable comparison, and halogen
  can load the same GGUF.
- **Whether NPU search tools help an agent finish stories,** which nobody here has measured.

## What would make it a fair test (and what would not)

- **The weights.** Feed halogen the same GGUF `gufo-pi` runs (`UD-Q4_K_XL`), not its own `.hgn` default, so a difference is the
  engine's. Check the conversion by comparing answers on a fixed prompt set before any run. A comparison on its own `.hgn` checkpoint
  would repeat the Strata mistake.
- **The client.** Our benchmark drives plain pi with its defaults. This harness adds tools (`codebase_search`, a guard, `decide`) and
  a compaction sidecar, so a run with them on is a different client and cannot be compared with `gufo-pi`. A fair engine comparison
  needs plain pi against halogen with the sidecars off; the sidecars are their own experiment.
- **One variable at a time**, as with [gufo with OpenCode](gufo-opencode.md): pin the engine build (the page says its image tag is
  pinned to the last validated version), keep model, sampling and context as in `gufo-pi`, change only the engine.
- **Memory.** Its own `.hgn` files total about 110 GiB; a GGUF is smaller. Whichever it loads, check there is room beside the agent,
  browsers and test servers, and that the BIOS carve-out and ROCm version match what it asks for, before anything else.

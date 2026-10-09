# aic0d3r's Strix Halo harness (the "halogen" engine and NPU sidecars)

**Status:** open question (9 Oct 2026). Added at the owner's request as "Strata + NPU sidecars for AMD".
**Read it once, from its page only** (<https://github.com/aic0d3r/qwen38-strix-halo-harness>); nothing installed or run.
**A correction to the request's label:** the page never mentions Strata. The engine it recommends is called **halogen**
("the NPU+GPU engine stack"), a different engine from the Strata we have been running. Whether the two are related is not
stated; it needs asking or reading its other pages before this note can be filed under Strata.
**Needs before it is a candidate:** an answer to what halogen is, which weights it loads, and whether a plain `pi` can be
pointed at it without the NPU tools (see "What would make it a fair test").

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

## Is halogen open source? The page does not say

The harness is MIT-licensed; that covers its scripts, not the engine. For halogen the page gives **no source repository, no maker
(it says only "Upstream"), no registry for the image, no licence and no description of the `.hgn` format**. It is distributed as a
Docker image the launcher pulls by tag (`HALOGEN_IMAGE_TAG`), and its weights come from a Hugging Face account (`peonist-ai`: one
repository for the model, four for the NPU models). That fits a closed binary but does not say so. The owner's recollection is that
it is closed source; **unconfirmed**.

If it is closed: we could not read its quantisation, sampler or draft logic, so every figure would need to say the engine could not
be inspected; we could pin only by image digest (a tag can move) and would record it; and the weights confound that cost us
the Strata comparison could not be ruled out by reading code. Benchmarking a closed engine is allowed here; the result simply
carries that limit.

## What it could tell us

- **A second engine for Flash-Next on the machine we already benchmark gufo on.** Our Strix Halo box runs Flash-Next under gufo
  with the MTP draft. A different engine on the same hardware, same model family, same client, would be a one-variable comparison,
  if the weights match.
- **Whether NPU search tools help an agent finish stories,** which nobody here has measured.

## What would make it a fair test (and what would not)

- **The weights.** A `.hgn` checkpoint is its own format and its quantisation is not stated, so it may not be the weights our gufo
  and llama.cpp runs use. A comparison across different weights tells us about the weights as much as the engine, which is the
  mistake made with Strata. Find out what it is before any run.
- **The client.** Our benchmark drives plain pi with its defaults. This harness adds tools (`codebase_search`, a guard, `decide`) and
  a compaction sidecar, so a run with them on is a different client and cannot be compared with `gufo-pi`. A fair engine comparison
  needs plain pi against halogen with the sidecars off; the sidecars are their own experiment.
- **One variable at a time**, as with [gufo with OpenCode](gufo-opencode.md): pin the engine build (the page says its image tag is
  pinned to the last validated version), keep model, sampling and context as in `gufo-pi`, change only the engine.
- **Memory.** About 124 GB of model files against a 128 GB machine that also runs the agent, browsers and test servers: check
  there is room before anything else.

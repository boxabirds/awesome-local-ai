# MiMo-V2.6-Qwen-9B · macOS · 16GB Apple silicon · MTPLX + OpenCode

Xiaomi's coding-and-agents fine-tune of Qwen3.5-9B, served locally by MTPLX with
multi-token-prediction speculative decoding, driven by OpenCode or Pi. This
repo's only 16 GB combination.

**Recommended on M3/M4/M5 with 16 GB+. Runs on M1/M2, but MTPLX does not offer
it there** (BF16 vision tower + BF16 draft head, and M1/M2 have no native BF16;
the slowdown is unmeasured).

> **Tested on a MacBook Air M2 16 GB (2026-09-24): not workable for agentic
> coding.** The context window is 20,480 tokens, set by 16 GB of memory rather
> than by the chip, so an M3/M4 16 GB gets the same window. In a real pi session
> it prefilled at **~55 tok/s** and decoded at **~5 tok/s** (3.7–6.1): `create a
> fibonacci function in python` took **5 min 43 s over three turns** and used a
> quarter of the window, and the first reply took 1½ minutes. The first install
> attempt froze the Mac. Full numbers: [the test report](../../../../../../../docs/20260924-mimo-9b-macbook-air-m2-16gb.md).

| | |
|---|---|
| Model | Xiaomi's coding/agent fine-tune of Qwen3.5-9B |
| MTPLX offers it on | M3, M4, M5 |
| Precision of float tensors | BF16 (vision tower, draft head) |
| Vision | vision tower in the pack |
| Measured by this repo | install, a pi session and its speeds, on a MacBook Air M2 16 GB ([report](../../../../../../../docs/20260924-mimo-9b-macbook-air-m2-16gb.md)) |

> **Provenance.** One test by this repo, on a MacBook Air M2 16 GB: install, a
> short pi session, and its prefill and decode speeds
> ([report](../../../../../../../docs/20260924-mimo-9b-macbook-air-m2-16gb.md)). Those figures are an M2's; MTPLX recommends
> this pack for M3+. Everything else on this page is quoted from the MTPLX
> 2.12.0 release notes (2026-09-24) or read from the pack's own
> `mtplx_runtime.json`, `README.md` and `chat_template.jinja` on Hugging Face,
> and the published memory figure was taken by the MTPLX author on an M5 Max.
> No M3+ tok/s figure exists. Lines that go beyond the published facts are
> labelled `EXTRAPOLATED`.

> **M1 / M2: MTPLX does not offer this pack.** See
> [M1 and M2 Macs](#m1-and-m2-macs) before you install on one.

## Who this is for

**You want this if** you have a 16 GB Apple silicon Mac, ideally M3 or newer,
and want a local coding model that fits it at all.

**You should know first:**

- **Tested on a MacBook Air M2 16 GB, it is not workable for agentic coding**
  ([report](../../../../../../../docs/20260924-mimo-9b-macbook-air-m2-16gb.md)). Treat this combination as a way to try a
  local model on a small Mac, not as a coding setup.
- **The context window is 20,480 tokens.** That is MTPLX's own memory plan for
  this pack on 16 GB. Coding agents compact often at this size; see
  [The 20,480-token window](#the-20480-token-window).
- **The pack's own card recommends 18 GB+ for agent clients such as
  OpenCode.** 16 GB is the floor for the model, not a comfortable size for an
  agent.
- **On M1/M2 it runs without native BF16**, and is not what MTPLX would pick
  for those chips.

**Assumed knowledge**: a terminal, and that `~/.local/bin` is on your `PATH`.

## The model

| | |
|---|---|
| Upstream | [XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B), by **Xiaomi MiMo**, MIT licence. A fine-tune of [Qwen/Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) (Apache 2.0) for coding and agent work |
| Pack | [`Youssofal/MiMo-V2.6-Qwen-9B-MTPLX-Optimized-Speed`](https://huggingface.co/Youssofal/MiMo-V2.6-Qwen-9B-MTPLX-Optimized-Speed), 8.70 GB |
| Quantisation | 6-bit, group size 64 |
| Vision tower | Xiaomi's, kept in BF16 |
| Draft head | borrowed from Qwen3.5-9B (BF16), not trained for MiMo |
| Served id | `mtplx-mimo-v26-qwen-9b-optimized-speed` |
| Requires | MTPLX ≥ 2.12.0 |

### Xiaomi's benchmark claims

These are **Xiaomi's numbers, from Xiaomi's model card**, as reproduced on the
pack's card. This repo has not run any of them.

| Benchmark | Qwen3.5-9B | MiMo-V2.6-Distill-Qwen-9B |
|---|---:|---:|
| SWE Pro | 32.0 | 44.6 |
| Terminal Bench 2.1 | 27.0 | 37.1 |
| Toolathlon-Verified | 25.9 | 35.2 |
| SWE Verified | 60.0 | 61.1 |

Note the spread: large claimed gains on SWE Pro, Terminal Bench and Toolathlon,
and roughly level on SWE Verified.

## Requirements

| Requirement | Why | Bypass |
|---|---|---|
| Apple silicon, M3 or newer preferred | MLX and Metal; M1/M2 lack native BF16 (see below) | none needed on M1/M2, but read the caveat |
| ≥ 8,909 MiB GPU-addressable | the published 8.70 GiB peak; a floor, not a promise (**EXTRAPOLATED**) | `ALLOW_LOW_VRAM=1` |
| MTPLX ≥ 2.12.0 | the pack declares it; older MTPLX does not know it | none |
| `uv` | MTPLX installs as a `uv tool` | install `uv` first |
| ~9 GB free disk | the model pack | none |
| OpenCode or Pi | the client | `npm install -g opencode-ai` |

## Install

`./install.sh` defaults to the `qwen` family, which has nothing for a 16 GB
Mac, so a bare `./install.sh --yes` installs nothing there. Name this one:

```bash
./install.sh mimo            # best fit within the mimo family
# or explicitly:
./install-mimo-2.6-9b-macos-16GB-mtplx-opencode.sh
```

(A bare `./install.sh` on a terminal shows a menu of every family, where this
one is listed as compatible on a 16 GB Mac.)

**The installer upgrades MTPLX if it is older than 2.12.0** (`uv tool upgrade
mtplx`). If something else on the machine depends on the installed MTPLX
version, do not run it until that is finished.

| Variable | Effect |
|---|---|
| `SKIP_SMOKE_TEST=1` | install everything but the model load |
| `INSTALL_SERVICE=1` | also install a launchd agent (off by default; on 16 GB, parking 8.7 GB at login is rarely wanted) |
| `ALLOW_LOW_VRAM=1` | proceed below the floor |
| `CLIENT=pi` / `--client pi` | make Pi the default client |

## M1 and M2 Macs

What MTPLX 2.12.0 does, from its catalog source:

- This pack's catalog entry is recommended for the **modern tier only**
  (M3, M4, M5). M1 and M2 are the **legacy tier**.
- The reason is BF16. M1/M2 GPUs have no native BF16; MTPLX's FP16 packs exist
  so that "M1 and M2 Macs (no native bf16) run the identical model at full
  speed". This pack keeps its vision tower and draft head in BF16, and **no
  FP16 sibling exists**, so M1 and M2 are not offered it.
- "Not offered" means **not listed or recommended** by the catalog. Nothing
  seen blocks pulling the pack by its repo id and serving it, which is exactly
  what this installer does (`mtplx pull <repo>`, then `mtplx serve --model`).
- On M1/M2 its BF16 tensors run without native BF16 support, so **expect it to
  be slower than on M3+**. The size of that slowdown has not been measured by
  anyone. On a MacBook Air M2 16 GB it installs, serves and answers pi, at
  ~55 tok/s prefill and ~5 tok/s decode ([report](../../../../../../../docs/20260924-mimo-9b-macbook-air-m2-16gb.md)); with no
  M3 figure to compare, how much of that is the missing BF16 is unknown.

## Usage

### Profiles

| Profile | ctx | depth | effort | max tokens | Notes |
|---|---|---|---|---|---|
| `coding` | 20480 | 2 | default | 8192 | MTPLX's 16 GB plan. **Nothing measured on 16 GB** |

`need_mib` is 8,909: the published 8.70 GiB peak at a 15K-token context,
applied to a 20K profile. **EXTRAPOLATED** — the extra ~5K tokens of KV cache
is not counted, so it is a floor.

### Overrides

| Variable | Default | Meaning |
|---|---|---|
| `PROFILE` | `coding` | the only row |
| `PORT` | `8010` | server port |
| `HOST` | `127.0.0.1` | bind address; anything non-loopback keeps API-key auth on |
| `CTX` | `20480` | context window; setting it disables the memory pre-flight. Above 20,480 you override MTPLX's own 16 GB plan, and MTPLX 2.12.0 admits an explicit window with a warning rather than refusing it: expect swap |
| `DEPTH` | `2` | MTP draft depth; the pack allows up to 3, untested |
| `THINKING` | `1` | `0` passes `--reasoning off` and turns thinking off |
| `MAX_RESPONSE_TOKENS` | `8192` | ceiling on one answer, thinking included |
| `REASONING_EFFORT` | `default` | has no effect on this model; other values are rejected |

### One-command session

```bash
./start.sh --opencode        # or: mtplx-mimo-v26-qwen-9b-opencode
./start.sh --pi              # or: mtplx-mimo-v26-qwen-9b-pi
```

Starts the server on demand, launches the client against it, and stops the
server five minutes after you stop using it.

### Connecting a coding agent by hand

OpenAI-compatible at `http://127.0.0.1:8010/v1`, model id
`mtplx-mimo-v26-qwen-9b-optimized-speed`, any API key. Set the client's context
limit to **20480** and its output limit to **8192**.

## Important behaviours

### The 20,480-token window

MTPLX plans 20,480 tokens for this pack on 16 GB (45,056 on 18 GB, 192,512 on
24 GB). For a coding agent that is small: its system prompt, tool schemas and a
couple of file reads can fill it, so **expect frequent compaction** and keep
tasks narrow.

`CONTEXT_LIMIT=20480` and `OUTPUT_LIMIT=8192` go into the client's provider
config, written by the session command (`./start.sh --opencode`, `--pi`) the
first time each client is launched, under provider `mtplx-mimo`: a name of its
own, because both adapters leave an existing provider untouched, so a shared
`mtplx` entry from another MTPLX combination would keep this model out.

**Why 8192 for output** (a choice, not a measurement): thinking is on and its
tokens count against the cap, so much less risks empty replies; much more and
the 12,288 left for prompt, tools and history shrinks further.

**OpenCode.** The provider block sets `limit.context: 20480` and
`limit.output: 8192`, which is what OpenCode compacts against. How much
headroom OpenCode holds back when it decides to compact was **not verified**
against the installed OpenCode for this page.

**Pi — you must configure this yourself.** Pi compacts when
`contextTokens > contextWindow - reserveTokens`, and its default
`reserveTokens` is 16,384. At a 20,480 window that means compaction past ~4K
tokens — nearly every turn — and its default `keepRecentTokens` (20,000) is the
entire window, so a compaction can free almost nothing. The installer writes
only Pi's `models.json`, not its settings. Add a per-model override to
`~/.pi/agent/settings.json`:

```json
{
  "compaction": {
    "modelOverrides": {
      "mtplx-mimo/mtplx-mimo-v26-qwen-9b-optimized-speed": {
        "reserveTokens": 8192,
        "keepRecentTokens": 4096
      }
    }
  }
}
```

Those values are a starting point matched to `OUTPUT_LIMIT`, **not a tested
setting**. Pi's `reserveTokens` also sets the summary's output budget, so do
not set it near zero.

### Reasoning effort does nothing here

The pack's `chat_template.jinja` reads `enable_thinking` and nothing else, so
there is no effort level to set. The launcher passes no `--reasoning-effort`
and rejects any value other than `default`. Use `THINKING=0` to turn thinking
off.

### The draft head is borrowed

The MTP head is Qwen3.5-9B's, not one trained for MiMo. Published acceptance on
MiMo (MTPLX release notes, long game prompt, thinking on): **78.5%** at the
first draft position, **56.5%** at the second. Default depth 2. What that
translates to in tok/s on any machine has not been published.

### Vision

The pack carries Xiaomi's vision tower in BF16. This repo's client configs
declare text input only, and the installer's summary line "Vision: not
available in this pack -- text only" is wrong for this pack: it is a shared
line in `lib/mtplx.sh` written for the Qwen3.8 packs.

### Sampler

Temperature 0.6, top-p 0.95, top-k 20: Xiaomi's settings, as shipped in the
pack. Xiaomi publishes no separate instruct sampler, so `THINKING=0` uses the
same values.

### Security

Binds `127.0.0.1` with `--no-auth`, which MTPLX applies to loopback binds only.

## Performance

Measured on a **MacBook Air M2 16 GB** (M2, 10-core GPU, macOS 26.6.2, MTPLX
2.12.0, pi 0.86.0), one pi session, `create a fibonacci function in python`.
Prefill is derived: total time minus output ÷ decode rate, over the tokens pi
did not reuse from cache ([how, and the rest of the data](../../../../../../../docs/20260924-mimo-9b-macbook-air-m2-16gb.md)).

| # | prompt | cached | prefilled | prefill tok/s | output | decode tok/s | total s |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3,231 | 0 | 3,231 | 55.1 | 118 | 3.69 | 90.7 |
| 2 | 4,649 | 3,231 | 1,418 | 55.0 | 606 | 4.78 | 152.6 |
| 3 | 5,280 | 4,649 | 631 | 30.5 | 481 | 6.06 | 100.1 |

```
Prefill        50.2 tok/s overall (5,280 tokens in 105.1 s); 55 tok/s cold
Decode         5.06 tok/s overall (1,205 tokens in 238.2 s); 3.7-6.1 per request
Model load     4.9-5.4 s (weights already on disk), server ready in 15 s
Memory         MTPLX plan: 12.0 GiB engine budget, 8.1 GiB weights, 0.67 GiB KV
               ~1.9 GB left for the rest of the machine under load; no swap

Published (MTPLX 2.12.0 release notes, M5 Max, not a 16 GB Mac):
  Peak memory              8.70 GiB at a 15K-token context
  Draft acceptance         78.5 % (pos 1), 56.5 % (pos 2)
  Default MTP depth        2
```

These are an M2's numbers, without native BF16. An M3+ figure is still the most
useful thing this combination could get, and would not change the 20,480-token
window.

## What this combination installs

```
~/.local/share/mtplx-mimo-v26-qwen-9b/
    install.env  profiles.tsv  help.txt  client.sh  client-*.sh
~/.local/bin/
    local-ai-mtplx-server               shared by all MTPLX combinations
    local-ai-session                    shared by all combinations
    mtplx-mimo-v26-qwen-9b-server       2-line shim
    mtplx-mimo-v26-qwen-9b-opencode     2-line shim
    mtplx-mimo-v26-qwen-9b-pi           2-line shim
~/.mtplx/models/Youssofal--MiMo-V2.6-Qwen-9B-MTPLX-Optimized-Speed/
                                        the pack, in MTPLX's own cache
```

Nothing installed contains an absolute path or your username.

## Troubleshooting

**Compacts every turn in Pi** — the default `reserveTokens` does not fit a 20K
window; add the override above.

**Empty replies** — thinking consumed `max_tokens`. Raise
`MAX_RESPONSE_TOKENS` (costs history room) or use `THINKING=0`.

**"REASONING_EFFORT ... is not supported"** — expected; this model has no
effort levels.

**The machine swaps** — 16 GB is tight for an 8.7 GB pack plus an agent,
a browser and an editor. Close what you can.

**"something is already serving on :8010"** — `mtplx stop --port 8010`, or use
`PORT=<other>`.

## Credit and licence

- Model: **Xiaomi MiMo** —
  [MiMo-V2.6-Distill-Qwen-9B](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B),
  MIT licence.
- Base model: [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B), Apache 2.0;
  also the source of the draft head.
- MTPLX pack and runtime: [MTPLX](https://mtplx.com), pack by Youssofal.

# Qwen3.5-9B FP16 · macOS · 16GB Apple silicon · MTPLX + OpenCode

The base Qwen3.5-9B, in MTPLX's FP16 build, served locally with
multi-token-prediction speculative decoding, driven by OpenCode or Pi. One of
this repo's two 16 GB combinations.

**Recommended for M1/M2 16 GB Macs: it is MTPLX's own pick for them.** On M3+,
prefer MTPLX's BF16 build of this model, or the coding-tuned
[MiMo V2.6 Qwen 9B](../../../../../../mimo/2.6/9b/macos/16GB/mtplx-opencode/README.md).

| | This (Qwen 3.5 9B FP16) | [MiMo V2.6 Qwen 9B](../../../../../../mimo/2.6/9b/macos/16GB/mtplx-opencode/README.md) |
|---|---|---|
| Model | the base Qwen3.5-9B | Xiaomi's coding/agent fine-tune of Qwen3.5-9B |
| MTPLX offers it on | M1, M2 | M3, M4, M5 |
| Precision of float tensors | FP16, so M1/M2 run it at full speed | BF16 (vision tower, draft head) |
| Vision | text only | vision tower in the pack |
| Measured by this repo | nothing | nothing |

> **Provenance: nothing here was measured by this repo.** No 16 GB machine was
> used. Figures are quoted from MTPLX 2.12.0's model catalog
> (`mtplx/model_catalog.py`) or read from the pack's own `mtplx_runtime.json`,
> `README.md` and `chat_template.jinja` on Hugging Face (metadata only, no
> weights downloaded). Lines that go beyond those sources are labelled
> `EXTRAPOLATED` — including the context window.

## Who this is for

**You want this if** you have an M1 or M2 Mac with 16 GB and want the model
MTPLX itself would choose for it.

**You should know first:**

- **The context window is 20,480 tokens, and that figure is EXTRAPOLATED.** See
  [The window](#the-window).
- **Coding agents compact often at this size.**
- **It is the base model**, not a coding fine-tune.

**Assumed knowledge**: a terminal, and that `~/.local/bin` is on your `PATH`.

## The model

| | |
|---|---|
| Upstream | [Qwen/Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B), by the Qwen team, Apache 2.0 |
| Pack | [`Youssofal/Qwen3.5-9B-MTPLX-Optimized-Speed-FP16`](https://huggingface.co/Youssofal/Qwen3.5-9B-MTPLX-Optimized-Speed-FP16), 7,783,301,181 bytes |
| Build | the Qwen 3.5 9B Optimized Speed pack (6-bit trunk) with packed quantised tensors kept as they are and every BF16 float tensor, draft head included, cast to FP16 |
| Why FP16 | M1/M2 GPUs have no native BF16. MTPLX's catalog: the FP16 siblings let "M1 and M2 Macs (no native bf16) run the identical model at full speed" |
| Served id | `mtplx-qwen35-9b-optimized-speed-fp16` |
| Catalog peak | 10.5 GiB (`peak_memory_gib`) |
| MTP depth | 2 (the pack's `recommended_mtp_depth`) |
| Requires | MTPLX ≥ 2.12.0 (see below) |

**Why the path says `9b-fp16`:** the contributor doc allows a variant name in
the size segment where a bare size is not enough (`flash-next` is the
precedent). MTPLX ships two 9B packs of this model for different chips, so the
precision is part of what makes this combination distinct.

**Why MTPLX ≥ 2.12.0:** the pack is not new (it declares `mtplx_version`
0.3.8, and 2.11.3's catalog already lists it). 2.12.0 is the floor because its
memory planner has a tight-machine rule for 16 GB-class Macs that 2.11.3's
does not, and it is the catalog this page was checked against. Lower versions
were not tested. **The installer upgrades MTPLX if it is older.**

## Requirements

| Requirement | Why | Bypass |
|---|---|---|
| Apple silicon; M1/M2 is the intended audience | the FP16 build exists for chips without native BF16 | — |
| ≥ 7,423 MiB GPU-addressable | the pack's weights; a floor, not a promise (**EXTRAPOLATED**) | `ALLOW_LOW_VRAM=1` |
| MTPLX ≥ 2.12.0 | see above | none |
| `uv` | MTPLX installs as a `uv tool` | install `uv` first |
| ~8 GB free disk | the model pack | none |
| OpenCode or Pi | the client | `npm install -g opencode-ai` |

## Install

```bash
./install.sh                 # the qwen-family pick on any Mac below the 64GB tier
# or explicitly:
./install-qwen-3.5-9b-fp16-macos-16GB-mtplx-opencode.sh
```

Selection reads memory, not chip generation, so an M3+ 16 GB Mac is offered
this one by `./install.sh` too. It runs there, but it is not what MTPLX would
choose on M3+ — see the table at the top.

| Variable | Effect |
|---|---|
| `SKIP_SMOKE_TEST=1` | install everything but the model load |
| `INSTALL_SERVICE=1` | also install a launchd agent (off by default) |
| `ALLOW_LOW_VRAM=1` | proceed below the floor |
| `CLIENT=pi` / `--client pi` | make Pi the default client |

## Usage

### Profiles

| Profile | ctx | depth | effort | max tokens | Notes |
|---|---|---|---|---|---|
| `coding` | 20480 | 2 | default | 8192 | **EXTRAPOLATED** window. Nothing measured on 16 GB |

`need_mib` is 10,752: the catalog's 10.5 GiB peak. On a 16 GB Mac with a browser
open, the launcher's free-memory pre-flight may warn on every start; it waits
5 s and continues.

### Overrides

| Variable | Default | Meaning |
|---|---|---|
| `PROFILE` | `coding` | the only row |
| `PORT` | `8010` | server port |
| `HOST` | `127.0.0.1` | bind address; anything non-loopback keeps API-key auth on |
| `CTX` | `20480` | context window; setting it disables the pre-flight. If you lower it, lower the client's context limit to match |
| `DEPTH` | `2` | MTP draft depth; the pack allows up to 3, untested |
| `THINKING` | `1` | `0` passes `--reasoning off` and turns thinking off |
| `MAX_RESPONSE_TOKENS` | `8192` | ceiling on one answer, thinking included |
| `REASONING_EFFORT` | `default` | has no effect on this model; other values are rejected |

### One-command session

```bash
./start.sh --opencode        # or: mtplx-qwen35-9b-fp16-opencode
./start.sh --pi              # or: mtplx-qwen35-9b-fp16-pi
```

### Connecting a coding agent by hand

OpenAI-compatible at `http://127.0.0.1:8010/v1`, model id
`mtplx-qwen35-9b-optimized-speed-fp16`, any API key. Context limit **20480**,
output limit **8192**.

## Important behaviours

### The window

No source states the window MTPLX plans for **this** pack on 16 GB. The MTPLX
2.12.0 release notes give 20,480 tokens on 16 GB for its BF16 sibling, which
shares its geometry; this repo uses that figure. It is **EXTRAPOLATED**, and it
could be optimistic: the catalog puts this pack's peak at 10.5 GiB against 10.0
for the sibling.

It matters because the launcher always passes `--context-window`, and MTPLX
2.12.0 treats an explicit window as authoritative: it warns that the window
overcommits rather than refusing. **On first run, read the server's
`Memory plan` startup lines.** If they report a smaller fit, set `CTX` to it
and lower the client's context limit to match.

### Agents on a ~20K window

A coding agent's system prompt, tool schemas and a couple of file reads can
fill 20,480 tokens, so **expect frequent compaction** and keep tasks narrow.
`CONTEXT_LIMIT=20480` and `OUTPUT_LIMIT=8192` go into the client's provider
config under provider `mtplx-qwen35-9b` (a name of its own, because both
adapters leave an existing provider untouched), written by the session command
the first time each client is launched.

**Why 8192 for output** (a choice, not a measurement): thinking tokens count
against the cap, so much less risks empty replies; much more and the 12,288
left for prompt, tools and history shrinks further.

**OpenCode.** `limit.context: 20480`, `limit.output: 8192`, which is what
OpenCode compacts against. How much headroom OpenCode holds back was **not
verified**.

**Pi — you must configure this yourself.** Pi compacts when
`contextTokens > contextWindow - reserveTokens`, default `reserveTokens`
16,384: at a 20,480 window that is past ~4K tokens, nearly every turn, and the
default `keepRecentTokens` (20,000) is the whole window. Add to
`~/.pi/agent/settings.json`:

```json
{
  "compaction": {
    "modelOverrides": {
      "mtplx-qwen35-9b/mtplx-qwen35-9b-optimized-speed-fp16": {
        "reserveTokens": 8192,
        "keepRecentTokens": 4096
      }
    }
  }
}
```

A starting point matched to `OUTPUT_LIMIT`, **not a tested setting**.

### Reasoning effort does nothing here

The pack's chat template reads `enable_thinking` and has no effort variable.
The launcher passes no `--reasoning-effort` and rejects any other value. Use
`THINKING=0` to turn thinking off.

### Sampler

Temperature 0.6, top-p 0.95, top-k 20, as shipped in the pack's
`mtplx_runtime.json`. `THINKING=0` uses the same values.

### Security

Binds `127.0.0.1` with `--no-auth`, which MTPLX applies to loopback binds only.

## Performance

```
NOT MEASURED -- by this repo, on any machine.
```

The pack's card has a tok/s table, but it is the **source (BF16) artifact's**
regression baseline on unstated hardware, not this FP16 build and not a 16 GB
Mac, so it is not quoted here as a figure for this combination. A measured row
from an M1 or M2 16 GB is the most useful contribution this page can get.

## What this combination installs

```
~/.local/share/mtplx-qwen35-9b-fp16/
    install.env  profiles.tsv  help.txt  client.sh  client-*.sh
~/.local/bin/
    local-ai-mtplx-server               shared by all MTPLX combinations
    local-ai-session                    shared by all combinations
    mtplx-qwen35-9b-fp16-server         2-line shim
    mtplx-qwen35-9b-fp16-opencode       2-line shim
    mtplx-qwen35-9b-fp16-pi             2-line shim
~/.mtplx/models/Youssofal--Qwen3.5-9B-MTPLX-Optimized-Speed-FP16/
                                        the pack, in MTPLX's own cache
```

## Troubleshooting

**Startup says the window overcommits** — lower `CTX` to the fit it reports,
and the client's context limit with it.

**Compacts every turn in Pi** — add the override above.

**Empty replies** — thinking consumed `max_tokens`; raise
`MAX_RESPONSE_TOKENS` or use `THINKING=0`.

**The machine swaps** — 16 GB is tight for a 10.5 GiB peak plus an agent, a
browser and an editor.

## Credit and licence

- Model: [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) by the Qwen team,
  Apache 2.0.
- MTPLX pack and FP16 conversion: [MTPLX](https://mtplx.com), pack by
  Youssofal.

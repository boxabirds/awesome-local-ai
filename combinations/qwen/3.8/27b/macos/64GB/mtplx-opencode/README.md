# Qwen3.8-27B · macOS · 64GB Apple silicon · MTPLX + OpenCode

A dense 27B served locally with native MTP speculative decoding, driven by
OpenCode. The smaller of this repo's two macOS combinations.

> **Provenance.** Every measurement behind this combination was taken on a
> **128 GB** Apple M5 Max. No 64 GB machine was used. The pack wires 27.9 GB
> and fits a 64 GB Mac's Metal budget with room, so the throughput figures
> should carry across — but "should" is not "measured". Lines that depend on
> the 64 GB claim are labelled `EXTRAPOLATED` wherever they appear. See
> [benchmarks/README.md](benchmarks/README.md).

## Who this is for

**You want this if** you have a 64 GB (or larger) Apple silicon Mac and want a
capable local coding model that leaves most of the machine free.

**You do not want this if** you have 128 GB — take
[Flash-Next](../../../../flash-next/macos/128GB/mtplx-opencode/README.md) instead,
which measured roughly 1.9x faster on the same hardware. `./install.sh` will
pick that for you automatically.

**Assumed knowledge**: a terminal, and that `~/.local/bin` is on your `PATH`.

## Requirements

| Requirement | Why | Bypass |
|---|---|---|
| Apple silicon | MLX and Metal | none |
| ≥ 38,000 MiB GPU-addressable | 27.9 GB of weights plus a KV cache | `ALLOW_LOW_VRAM=1` |
| `uv` | MTPLX installs as a `uv tool` | install `uv` first |
| ~30 GB free disk | the model pack | none |
| OpenCode | the client | `npm install -g opencode-ai` |

## Install

```bash
./install.sh                 # selects this on a 64-96 GB Mac
# or explicitly:
./install-qwen-3.8-27b-macos-64GB-mtplx-opencode.sh
```

**Re-running is safe and cheap.** A pack that is already cached and valid is
left alone, with no network call — measured at 1.7 s against a 30 GB pack. An
interrupted download resumes with a delta update rather than starting over.

| Variable | Effect |
|---|---|
| `SKIP_SMOKE_TEST=1` | install everything but the model load |
| `INSTALL_SERVICE=1` | also install a launchd agent (off by default) |
| `ALLOW_LOW_VRAM=1` | proceed on a machine below the measured floor |

## Usage

### Profiles

| Profile | ctx | depth | effort | max tokens | Notes |
|---|---|---|---|---|---|
| `coding` | 131072 | 3 | low | 32768 | default; the measured configuration |
| `fast` | 65536 | 3 | low | 32768 | **EXTRAPOLATED** sizing — half the context for headroom |

### Overrides

| Variable | Default | Meaning |
|---|---|---|
| `PROFILE` | `coding` | which row above |
| `PORT` | `8010` | server port |
| `HOST` | `127.0.0.1` | bind address; anything non-loopback keeps API-key auth on |
| `CTX` | from profile | context window; setting it disables the memory pre-flight |
| `DEPTH` | `3` | MTP draft depth |
| `REASONING_EFFORT` | `low` | `auto low medium high xhigh`; unsupported values rejected up front |
| `THINKING` | `1` | `0` switches to the instruct sampler as a matched pair |
| `MAX_RESPONSE_TOKENS` | `32768` | ceiling on one answer |

### One-command OpenCode session (recommended)

```bash
./start.sh
```

Starts the server on demand, launches OpenCode against it, and stops the server
five minutes after you stop using it.

### Connecting a coding agent by hand

OpenAI-compatible at `http://127.0.0.1:8010/v1`, model id
`mtplx-qwen38-27b-optimized-quality`, any API key. Set `limit.context` to
**131072** client-side.

## Important behaviours

### The context ceiling is 131072, not the advertised 262144

Measured on this pack: a session run out to 201,779 tokens returned zero-token
responses, and decode had already fallen from ~35 tok/s at 27k to ~11–18 at
200k. The server enforces the ceiling; only the client's `limit.context` makes
OpenCode compact before it gets there.

### Reasoning effort is a server flag, not a request field

OpenCode strips `reasoning_effort` and `chat_template_kwargs` from an agent's
options block. Use `REASONING_EFFORT=` on the server command; check with
`curl -s http://127.0.0.1:8010/health`.

### Two headline numbers, both true

`mtplx tune` reports **53.59 tok/s** at depth 3, 3.145x over a 17.04 tok/s
autoregressive baseline — a short greedy generation on a warm prefix, which is
the right way to isolate the speculative-decoding speedup.

A real agent session at ~53k median context gives **26.2 tok/s decode, 21.8
effective**. That is what the work feels like, and it is the figure this repo
quotes.

### The sampler differs from Flash-Next

Temperature 0.6 here, 1.0 there, per each pack's own `mtplx_runtime.json`.
They are different architectures. Sharing one launch path across both — as the
scratchpad these combinations came from did — silently ran one of them wrong.

### Security

Binds `127.0.0.1` with `--no-auth`, which MTPLX applies to loopback binds only.

## Performance

See [benchmarks/README.md](benchmarks/README.md) for provenance and caveats.

```
MEASURED on a 128 GB M5 Max, NOT on a 64 GB machine.

Decode (median)      26.2 tok/s        MTP vs AR @  1k ctx   42.7 / 17.0
Effective (median)   21.8 tok/s        MTP vs AR @ 32k ctx   34.6 / 15.7
TTFT (median)         2.78 s           depth sweep best D3   53.59 (3.145x)
Draft acceptance      ~78 %
```

## What this combination installs

```
~/.local/share/mtplx-qwen38-27b/
    install.env  profiles.tsv  help.txt  client.sh
~/.local/bin/
    local-ai-mtplx-server           shared by all MTPLX combinations
    local-ai-session                shared by all combinations
    mtplx-qwen38-27b-server         2-line shim
    mtplx-qwen38-27b-opencode       2-line shim
~/.mtplx/models/Youssofal--Qwen3.8-27B-MTPLX-Optimized-Quality/
                                    the pack, in MTPLX's own cache
```

Nothing installed contains an absolute path or your username.

## Troubleshooting

**"something is already serving on :8010"** — `mtplx stop --port 8010`, or use
`PORT=<other>`.

**Empty replies** — raise `MAX_RESPONSE_TOKENS`; thinking mode consumes it.

**Zero-token responses** — the session ran past ~200k context. Start a new one.

**Slow decode above ~100k** — expected; decode falls off with context.

## Further reading

- [docs/discovery-macos-mtplx.md](../../../../../../../docs/discovery-macos-mtplx.md)
- [Flash-Next](../../../../flash-next/macos/128GB/mtplx-opencode/README.md) — the other arm of the A/B

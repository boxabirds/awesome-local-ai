# Qwen3.8-Flash-Next · macOS · 128GB Apple silicon · MTPLX + OpenCode

A 512-expert MoE served locally at ~50 tok/s decode, with native MTP
speculative decoding, driven by OpenCode.

## Who this is for

**You want this if** you have a 128 GB Apple silicon Mac, you want the fastest
local coding model this repo has measured, and you can give up ~77 GB of
unified memory while it runs.

**You do not want this if** your Mac has less than 128 GB — the pack wires
77.3 GB and will not fit; use
[the 27B combination](../../../../27b/macos/64GB/mtplx-opencode/README.md)
instead. Also not if you need vision: neither MTPLX pack in this repo ships a
projector.

**Assumed knowledge**: a terminal, and that `~/.local/bin` is on your `PATH`.

## Requirements

| Requirement | Why | Bypass |
|---|---|---|
| Apple silicon | MLX and Metal; Intel Macs have no usable GPU path | none |
| ≥ 92,000 MiB GPU-addressable | 77.3 GB of weights, measured | `ALLOW_LOW_VRAM=1` (it will not fit) |
| macOS with Metal | `recommendedMaxWorkingSetSize` is the real ceiling | none |
| `uv` | MTPLX installs as a `uv tool` | install `uv` first |
| ~115 GB free disk | 77.3 GB weights + a 29.8 GB n-gram table | none |
| OpenCode | the client | `npm install -g opencode-ai` |

## Install

```bash
./install.sh                 # selects this on a 128 GB Mac
# or explicitly:
./install-qwen-3.8-flash-next-macos-128GB-mtplx-opencode.sh
```

The installer qualifies the OS, qualifies Metal's working set, installs or
upgrades MTPLX, ensures the model pack, writes the runtime, and smoke-tests
that MTP is actually live. **Re-running it is safe and cheap**: a pack that is
already cached and valid is left alone and no network call is made.

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
| `long` | 131072 | 3 | medium | 32768 | more deliberation per turn, slower in wall-clock |

### Overrides

| Variable | Default | Meaning |
|---|---|---|
| `PROFILE` | `coding` | which row above |
| `PORT` | `8010` | server port |
| `HOST` | `127.0.0.1` | bind address; anything non-loopback keeps API-key auth on |
| `CTX` | from profile | context window; setting it disables the memory pre-flight |
| `DEPTH` | `3` | MTP draft depth |
| `REASONING_EFFORT` | `low` | `auto low medium high xhigh`; unsupported values are rejected up front |
| `THINKING` | `1` | `0` switches to the instruct sampler as a matched pair |
| `MAX_RESPONSE_TOKENS` | `32768` | ceiling on one answer |

### One-command OpenCode session (recommended)

```bash
./start.sh
```

Starts the server if one is not already up, launches OpenCode against it, and
shuts the server down five minutes after you stop using it — so 77 GB is not
parked in memory all day.

### Connecting a coding agent by hand

The server is OpenAI-compatible at `http://127.0.0.1:8010/v1`, model id
`mtplx-flash-next-optimized-speed`, any API key. Set `limit.context` to
**131072** on the client side — see below, this matters.

## Important behaviours

### The context ceiling is 131072, not the advertised 262144

Measured: a session run out to 202k returned zero-token responses, and decode
had already fallen from ~35 tok/s at 27k to ~11–18 at 200k.

The server enforces its ceiling, but only the **client's** `limit.context`
makes OpenCode compact its history before reaching it. Set one without the
other and you get a wall instead of compaction.

### Reasoning effort is a server flag, not a request field

OpenCode strips `reasoning_effort` and `chat_template_kwargs` from an agent's
options block, so setting it client-side does nothing at all. Use
`REASONING_EFFORT=` on the server command and confirm with:

```bash
curl -s http://127.0.0.1:8010/health | python3 -m json.tool | grep -i reason
```

### Speculative decoding (MTP)

Native, depth 3. Draft acceptance is ~60% — lower than the 27B's ~78% — and it
is still roughly 1.9x faster overall, because MoE memory traffic dominates.
The installer asserts `mtp_enabled` via `/health` rather than assuming it: with
MTP silently off you get about a third of the speed and no warning.

### Security

Binds `127.0.0.1` with `--no-auth`, which MTPLX applies to loopback binds only.
A non-loopback `HOST` still requires an API key, so this cannot become an
unauthenticated network service by accident.

## Performance

See [benchmarks/README.md](benchmarks/README.md) for provenance and caveats.

```
Decode (median)                49.8 tok/s
Effective (median)             38.8 tok/s
TTFT (median)                   2.0 s
Session-bank restore (median)  98.8 %

vs the 27B, matched thermal + context band:
  20-45k   2.16x     45-75k   1.65x     75-130k  1.98x
```

## What this combination installs

```
~/.local/share/mtplx-qwen38-flash-next/
    install.env       the manifest the runtime reads
    profiles.tsv      copied from this combination
    help.txt          copied from this combination
    client.sh         copied from lib/clients/opencode.sh
~/.local/bin/
    local-ai-mtplx-server        shared by all MTPLX combinations
    local-ai-session             shared by all combinations
    mtplx-qwen38-flash-next-server     2-line shim
    mtplx-qwen38-flash-next-opencode   2-line shim
~/.mtplx/models/Youssofal--Qwen3.8-Flash-Next-MTPLX-Optimized-Speed/
                      the pack, in MTPLX's own cache
```

Nothing installed contains an absolute path or your username; the runtime
resolves everything from `$HOME`.

## Troubleshooting

**"something is already serving on :8010"** — another MTPLX server has the
port, and is probably also holding the memory. `mtplx stop --port 8010`, or
`PORT=<other>`.

**Empty replies** — raise `MAX_RESPONSE_TOKENS`; thinking mode consumes it.

**Zero-token responses** — the session ran past ~200k context. Start a new one.

**The machine starts swapping** — 77.3 GB needs room. Check what else is
resident; the launcher's pre-flight warns but does not block.

**Effort seems ignored** — it is set server-side; see above.

## Further reading

- [docs/discovery-macos-mtplx.md](../../../../../../../docs/discovery-macos-mtplx.md) — why these settings are what they are
- [benchmarks/README.md](benchmarks/README.md) — every number, traced to its harness

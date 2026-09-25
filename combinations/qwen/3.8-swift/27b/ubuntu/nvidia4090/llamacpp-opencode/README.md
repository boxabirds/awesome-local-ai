# Swift Qwen3.8-27B · Ubuntu · 24GB NVIDIA · llama.cpp + OpenCode

**Combination:** `qwen/3.8-swift/27b/ubuntu/nvidia4090/llamacpp-opencode`
**Install:** `./install-qwen-3.8-swift-27b-ubuntu-nvidia4090-llamacpp-opencode.sh` (from the repo root)

Swift-Qwen3.8-27B on a 24GB NVIDIA GPU as a local OpenAI-compatible API — with
speculative decoding, the model's native vision tower, and a 128k context
window. It is the **fast-of-the-two** Qwen3.8-27B here: a retrained model that
thinks less, so each reasoning-effort level costs fewer tokens and less wall
time than the [baseline](../../../../../../../combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md)
for the same task.

```bash
git clone https://github.com/boxabirds/awesome-local-ai.git
cd awesome-local-ai
./install-qwen-3.8-swift-27b-ubuntu-nvidia4090-llamacpp-opencode.sh   # ~20 min first run (build + ~17 GB)
swift-qwen38-27b-opencode                                       # server on demand + OpenCode
```

**The measured case for it** (same binary, config and prompts as the baseline,
RTX 4090): 1.37–1.51× faster end-to-end across the low/medium/xhigh sweep, with
23–39% fewer reasoning chars ([full A/B, method and caveats](../../../../../../../docs/20260921-swift-qwen38-27b-ab.md)).
It also drops the 1.57 GiB MTP sidecar — Swift bakes its MTP head (Q8_0) into
the model file — so it has ~1.5 GiB more room for context than the baseline.

Every figure below that is a Swift measurement says so. Where a number is
carried over from the baseline (the profile VRAM bounds) or is a vendor prior
(the quality benchmarks), it says so too.

---

## Who this is for

**You want this if you are:**

- Running **coding agents locally** and want the **least deliberation per
  answer** — Swift produces meaningfully fewer reasoning tokens than the
  baseline, so routine edits come back faster.
- Someone with **exactly this hardware**: a 24GB NVIDIA card on Ubuntu. The
  installer is deliberately narrow and refuses to run outside it.
- Already happy with the baseline's setup and just want the **faster sibling**
  for the same task.

**You do not want this if:**

- Your work leans on **maximum reasoning for hard quantitative problems** —
  the vendor's own evaluation shows Swift trading a little on math (AIME −4.7,
  HMMT −3.3, on BF16/INT4, not reproduced here). The baseline is the safer
  default there.
- Your GPU has **less than 24GB**, you are on a **non-Ubuntu** OS, or you need
  **multi-GPU / high concurrency** — same as the baseline; see its README.
- You need **bit-exact reproducibility with the baseline** — the two are
  different models; expect different (usually shorter) outputs.

**Assumed knowledge:** comfortable with a terminal and `systemd`.

---

## Requirements

Identical to the baseline:

| | Requirement | Bypass |
|---|---|---|
| OS | Ubuntu (22.04 validated) | `ALLOW_UNSUPPORTED_OS=1` |
| GPU | NVIDIA CUDA, **≥24GB VRAM** | `ALLOW_LOW_VRAM=1` |
| Driver | ≥550 (580 validated) | — |
| CUDA | 12.x toolkit (12.3 validated) | — |
| Disk | ~40 GB (~17 GB model, ~2 GB build) | — |
| RAM | 16 GB+ | — |

Validated on: RTX 4090 24GB, Ubuntu 22.04.5, driver 580.159.03, CUDA 12.3,
`llama-server` commit `972d231`.

---

## Install

The installer is **idempotent** — re-running only upgrades what is outdated. It:

1. Qualifies OS, GPU, VRAM, driver, CUDA
2. Installs missing apt packages (falls back to pip `cmake`/`ninja` if no sudo)
3. Builds llama.cpp with CUDA for your GPU's arch (auto-detected)
4. Downloads the model and the vision projector (~17 GB) — **no MTP sidecar**;
   Swift's head is in the model file
5. Writes the install manifest, the `swift-qwen38-27b-*` commands and a systemd unit
6. **Smoke-tests**: loads the model, generates, and checks the log for the
   built-in MTP engaging

> If you already ran the A/B (`benchmarks/perf/swift-ab.sh`), the model and mmproj
> are already in `~/.local/share/swift-qwen38-27b/models/` and the install will
> reuse them — no re-download.

You will see `MTP head missing (speculative decoding disabled)` during the
model step. **That is expected** — it reports the absence of a sidecar file this
model never had. Spec decoding is still on (confirm in the log, below).

| Install-time variable | Effect |
|---|---|
| `QUANT=Q3_K_M` | Pick a smaller quant (estimates only, see baseline) |
| `SKIP_SMOKE_TEST=1` | Skip the model load at the end |
| `SKIP_BACKEND_UPDATE=1` | Keep the llama.cpp checkout you already have |
| `ALLOW_LOW_VRAM=1` / `ALLOW_UNSUPPORTED_OS=1` | Bypass the hardware gates |

---

## Usage

```bash
swift-qwen38-27b-opencode               # recommended: server on demand + OpenCode
swift-qwen38-27b-server                 # just the server: coding profile, 128k context
swift-qwen38-27b-server --help          # all profiles, with caveats
```

Point any OpenAI client at `http://127.0.0.1:8080/v1`; the model id is
**`qwen3.8-swift-27b`**.

### Profiles

Select with `PROFILE=<name>`. **`need_mib` is a conservative bound from the
baseline, not a Swift measurement** — Swift is ~1.5 GiB lighter (no sidecar),
so real headroom is better than shown. Re-measure to tighten
([how](benchmarks/README.md)).

| Profile | Context | KV | Vision | need (bound) | Use for |
|---|---|---|---|---|---|
| **`coding`** *(default)* | 128k | q4_0 | — | 21,905 MiB | Coding agents |
| `balanced` | 96k | q8_0 | — | 22,635 MiB | Max KV fidelity |
| `vision` | 96k | q4_0 | ✓ | 22,140 MiB | Images + long context |
| `vision-max` | 128k | q4_0 | ✓ | 23,040 MiB ⚠ | Foreground only |
| `max` | 160k | q4_0 | — | 22,805 MiB ⚠ | Foreground only |

⚠ Against the *bound*. Real Swift usage is ~1.5 GiB lower, but re-measure
before pointing systemd at the tight ones.

The machine-readable version is [`profiles.tsv`](profiles.tsv) — the launcher
reads it at run time.

### Overrides

```bash
PORT=8081 swift-qwen38-27b-server                      # different port
CTX=65536 KV_TYPE=q8_0 swift-qwen38-27b-server          # hand-tuned
VISION=1 swift-qwen38-27b-server                       # vision on any profile
swift-qwen38-27b-server --spec-draft-n-max 4           # passthrough to llama-server
```

| Variable | Default | Meaning |
|---|---|---|
| `PROFILE` | `coding` | Profile name |
| `PORT` / `HOST` | `8080` / `127.0.0.1` | Bind address |
| `CTX` / `KV_TYPE` | per profile | Context / KV type (`q4_0`\|`q8_0`\|`f16`) |
| `VISION` | per profile | `0` \| `1` |
| `NP` / `UB` | `1` / `256` | Parallel slots / micro-batch |
| `THINKING` / `THINKING_BUDGET` | `1` / unset | Reasoning on/off, or capped |
| `REASONING_EFFORT` | `low` | `low` \| `medium` \| `xhigh` \| `default` |
| `MODEL_ALIAS` | `qwen3.8-swift-27b` | Model id at `/v1/models` |
| `SWIFT_QWEN38_ROOT` | `$HOME/.local/share/swift-qwen38-27b` | Install location |

Unrecognised arguments pass straight through to `llama-server`. The launcher
contains no machine-specific paths (resolved from `$HOME` at run time).

### One-command OpenCode session (recommended)

`swift-qwen38-27b-opencode` starts the server on demand, launches OpenCode
against it, and shuts the server down once you stop using it — so a 17 GB model
is not sitting on your GPU all day. Same lifecycle as the baseline: `--status`,
`--stop`, `--server-only`, `-- <args>`; a 5-minute idle timer; a second
terminal reuses the running server.

### Connecting a coding agent

The server is OpenAI-compatible at `http://127.0.0.1:8080/v1`, model id
**`qwen3.8-swift-27b`**. The Pi and OpenCode hand-configs are identical to the
baseline's except the model id — see
[the baseline README](../../../../../../../combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md#connecting-a-coding-agent-by-hand)
for the full `models.json` / `opencode.json` blocks, or pick `--client pi` at
install time to have it written for you.

> **Set a generous output limit.** Thinking mode bills reasoning against
> `max_tokens`; too small a budget returns empty content.

---

## Important behaviours

### It thinks less (the whole point)

Measured here — 5 prompts, greedy, one run ([raw](benchmarks/swift.tsv)):

| Effort | Reasoning chars | Completion tokens | Wall |
|---|---:|---:|---:|
| **`low`** *(default)* | 3,035 | 2,346 | 23.4 s |
| `medium` | 4,442 | 2,905 | 28.3 s |
| `xhigh` | 5,967 | 2,235 | 24.7 s |

Versus the same run on the baseline ([raw](benchmarks/base.tsv)): low 4,366 /
medium 5,789 / xhigh 9,717 reasoning chars. So Swift cuts deliberation by
30.5% / 23.3% / 38.6% respectively, and even its **xhigh is cheaper (in tokens
and wall) than the baseline's medium.** The cut grows with effort and Swift's
effort ladder is flatter — raising effort is much cheaper than on the baseline.

This is a **throughput/deliberation** result. It does not establish that Swift
is *as good* on every task — the vendor reports a small math/quant regression
(AIME −4.7, HMMT −3.3) that is a BF16/INT4 prior, not reproduced here. For
coding and general agent traffic the local result is unambiguous.

### Reasoning effort defaults to `low`, not the template's `xhigh`

Same as the baseline: the template defaults to `xhigh` when unset; this
combination ships `low` and lets you raise it per run or per request
(`reasoning_effort` in the body). `THINKING_BUDGET` is the hard cap.

### Speculative decoding (built-in MTP)

Swift carries its MTP head **inside the GGUF** (Q8_0). The launcher engages it
with `SPEC_BUILTIN=1` — just `--spec-type draft-mtp --spec-draft-n-max 3`, no
`-md` sidecar. Measured **0.62–0.86 draft acceptance**, mean accepted length
**2.87–3.58** (higher than the baseline's Q4_0 sidecar — the in-file Q8_0 head
accepts longer draft runs per step).

To confirm it is live: grep the server log for `creating MTP draft context` and
`draft acceptance`. If either is absent, speculative decoding is silently off.

### Thinking mode consumes `max_tokens`

Same as the baseline: thinking is on by default and bills against `max_tokens`;
a too-small budget returns empty content with `finish_reason: "length"`. Give
agents a generous `max_tokens`.

### Security

Binds to `127.0.0.1` with **no authentication**. `HOST=0.0.0.0` exposes an
unauthenticated model server to your whole network.

---

## Performance

| Metric | Value | Source |
|---|---|---|
| End-to-end speedup vs baseline | 1.37–1.51× (1.42× across sweep) | measured, A/B |
| Reasoning cut vs baseline | 23–39% fewer chars (32% across sweep) | measured, A/B |
| MTP (built-in) acceptance | 0.62–0.86, mean len 2.87–3.58 | measured |
| Profile VRAM | bound from baseline, ~1.5 GiB conservative | carried — re-measure |
| Quality vs baseline | coding within noise; math −4.7 (AIME) | **vendor prior, not reproduced** |

Full method and the reconciliation against the baseline's older reference in
[docs/20260921-swift-qwen38-27b-ab.md](../../../../../../../docs/20260921-swift-qwen38-27b-ab.md).

---

## What this combination installs

```
~/.local/share/swift-qwen38-27b/
  llama.cpp/                       source + CUDA build
  models/                          Swift Q4_K_M + mmproj (no MTP sidecar)
  install.env                      manifest read by the runtime
  profiles.tsv, help.txt           copied from this directory
  client.sh                        copied from lib/clients/<client>.sh
  smoke.log

~/.local/bin/
  local-ai-server                  generic launcher (shared by all combinations)
  local-ai-session                 generic lifecycle manager (shared)
  swift-qwen38-27b-server          2-line shim -> local-ai-server
  swift-qwen38-27b-opencode        2-line shim -> local-ai-session
  llama-server, llama-cli          symlinks into the build

~/.config/systemd/user/swift-qwen38-27b.service
~/.local/state/swift-qwen38-27b/   pids, client registrations, logs
```

---

## Troubleshooting

**`MTP head missing` at install** — expected; Swift's MTP is in-file, not a
file. Spec decoding is still on.

**Generation feels slow** — MTP may be inactive. Grep the log for `creating MTP
draft context` + `draft acceptance`; absent means it is off.

**CUDA OOM on startup** — something else is using the GPU, or you picked a
profile whose *bound* is too high for your free memory. The launcher pre-flights
and names the offending processes; try `PROFILE=coding` (the bound still leaves
Swift ~1.5 GiB of real slack).

**Empty responses** — `max_tokens` too small; the reasoning block consumed it.

**Want the math/quant-strong model** — use the
[baseline](../../../../../../../combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md).

---

## Further reading

- **[docs/20260921-swift-qwen38-27b-ab.md](../../../../../../../docs/20260921-swift-qwen38-27b-ab.md)** —
  the A/B that justifies this combination: method, table, spec-acceptance
  comparison, caveats, and the baseline reconciliation.
- **[benchmarks/](benchmarks/)** — the raw per-effort data (`base.tsv`,
  `swift.tsv`) and how to re-measure the profile VRAM.
- **[the baseline combination](../../../../../../../combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md)** —
  the full measurement methodology (discovery.md), KV-type kernels, and the
  client hand-configs.

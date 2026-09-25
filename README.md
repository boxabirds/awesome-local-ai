# awesome-local-ai

One-command installers for running capable models **locally**, as an
OpenAI-compatible API with a coding agent already wired up.

Every combination is a *tested pairing* of model, hardware and stack. Every
performance and memory number in this repo was **measured on real hardware**,
not estimated — and where a figure is extrapolated, it says so.

```bash
git clone https://github.com/boxabirds/awesome-local-ai.git
cd awesome-local-ai
./install.sh             # picks the combination that suits this machine
./start.sh               # run the server; it stays up until you stop it
./start.sh --opencode    # or launch OpenCode against it, and let the server idle out
./start.sh --pi          # or Pi (pi.dev) instead
```

`install.sh` probes the host and reads the combinations tree, whose path
segments already encode the OS and memory tier each combination was measured
against. It shows what it chose and what else would have fit, then hands over
to that combination's own installer — which still qualifies the hardware with
measured thresholds and refuses with numbers if it falls short. Selection
narrows; qualification decides.

On an interactive terminal a bare `./install.sh` first offers a menu of what
fits this machine to choose from; pass a selector (or `--list`, `--dry-run` or
`--yes`) and it skips straight to the automatic pick.

```bash
./install.sh --list      # what fits this machine, and why the rest do not
./install.sh --dry-run   # show the choice, install nothing
./install.sh qwen/3.8/27b/macos/64GB/mtplx-opencode   # or choose yourself
```

`start.sh` reads the manifests the installer left behind, so it runs whatever
this machine actually has — no arguments needed for the common case, and a
clear prompt to choose when more than one combination is installed. (`run.sh`
is kept as an alias.)

---

## Combinations

Pick the row that matches your hardware and run its script from the repo root.
The installer refuses to run on hardware it was not measured on, rather than
half-installing.

| Model | OS | Memory | Stack | Context | Install | Details |
|---|---|---|---|---|---|---|
| Qwen3.8-27B | Ubuntu 22.04 | RTX 4090 (24GB) | llama.cpp + OpenCode | 128k | [`install-qwen-3.8-27b-ubuntu-nvidia4090-llamacpp-opencode.sh`](install-qwen-3.8-27b-ubuntu-nvidia4090-llamacpp-opencode.sh) | [README](combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md) |
| Swift-Qwen3.8-27B | Ubuntu 22.04 | RTX 4090 (24GB) | llama.cpp + OpenCode | 128k | [`install-qwen-3.8-swift-27b-ubuntu-nvidia4090-llamacpp-opencode.sh`](install-qwen-3.8-swift-27b-ubuntu-nvidia4090-llamacpp-opencode.sh) | [README](combinations/qwen/3.8-swift/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md) |
| Qwen3.8-27B | macOS 26 | 64GB Apple silicon ¹ | MTPLX + OpenCode | 128k | [`install-qwen-3.8-27b-macos-64GB-mtplx-opencode.sh`](install-qwen-3.8-27b-macos-64GB-mtplx-opencode.sh) | [README](combinations/qwen/3.8/27b/macos/64GB/mtplx-opencode/README.md) |
| Qwen3.8-Flash-Next | macOS 26 | 128GB Apple silicon | MTPLX + OpenCode | 128k | [`install-qwen-3.8-flash-next-macos-128GB-mtplx-opencode.sh`](install-qwen-3.8-flash-next-macos-128GB-mtplx-opencode.sh) | [README](combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/README.md) |
| Qwen3.8-Flash-Next mixed 4/8-bit ⁶ | macOS 26.2+ | 128GB Apple silicon | mlx-serve + OpenCode | 128k | [`install-qwen-3.8-flash-next-macos-128GB-mlxserve-opencode.sh`](install-qwen-3.8-flash-next-macos-128GB-mlxserve-opencode.sh) | [README](combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-opencode/README.md) |
| Qwen3.8-Flash-Next ⁷ | Ubuntu 26.04 | Strix Halo 128GB (Ryzen AI Max+ 395) | llama.cpp *(MTP PR; Vulkan or ROCm)* + pi | 128k | [`install-qwen-3.8-flash-next-ubuntu-strix-halo-128GB-llamacpp-pi.sh`](install-qwen-3.8-flash-next-ubuntu-strix-halo-128GB-llamacpp-pi.sh) | [README](combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi/README.md) |
| Ternary Bonsai 2 27B ² | Ubuntu 22.04 | RTX 4090 (24GB) | llama.cpp *(fork)* + OpenCode | 128k | [`install-bonsai-2-27b-ubuntu-nvidia4090-llamacpp-opencode.sh`](install-bonsai-2-27b-ubuntu-nvidia4090-llamacpp-opencode.sh) | [README](combinations/bonsai/2/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md) |
| MiMo-V2.6-Qwen-9B ³ | macOS 26 | 16GB Apple silicon, M3+ ⁴ | MTPLX + OpenCode | **20k**: too small for agentic coding ([tested](docs/20260924-mimo-9b-macbook-air-m2-16gb.md)) | [`install-mimo-2.6-9b-macos-16GB-mtplx-opencode.sh`](install-mimo-2.6-9b-macos-16GB-mtplx-opencode.sh) | [README](combinations/mimo/2.6/9b/macos/16GB/mtplx-opencode/README.md) |
| Qwen3.8-27B EXL3 3.0bpw ⁵ | Ubuntu (Docker) | RTX 3090 (24GB, sm_86) | SGLang *(container)* + OpenCode | 262k | [`install-qwen-3.8-27b-ubuntu-nvidia3090-sglang-opencode.sh`](install-qwen-3.8-27b-ubuntu-nvidia3090-sglang-opencode.sh) | [README](combinations/qwen/3.8/27b/ubuntu/nvidia3090/sglang-opencode/README.md) |
| Qwen3.6-35B-A3B EXL3 3.0bpw ⁵ | Ubuntu (Docker) | RTX 3090 (24GB, sm_86) | SGLang *(container)* + OpenCode | 262k | [`install-qwen-3.6-35b-a3b-ubuntu-nvidia3090-sglang-opencode.sh`](install-qwen-3.6-35b-a3b-ubuntu-nvidia3090-sglang-opencode.sh) | [README](combinations/qwen/3.6/35b-a3b/ubuntu/nvidia3090/sglang-opencode/README.md) |

² **The Bonsai row does not use upstream llama.cpp.** Bonsai 2 is Qwen3.8-27B
re-quantised to ternary weights (~1.72 bits/weight, 6.7 GB), and its GGUF types
sit past upstream's `GGML_TYPE_COUNT` — stock llama.cpp refuses the file. That
combination tracks the [PrismML fork](https://github.com/PrismML-Eng/llama.cpp)
instead, which is the one place in this repo where a combination does not float
on upstream. Measured on the same 4090 as the Qwen row: 2.1x the decode rate at
depth 0, 1.6x at 128k, 1.3x the prefill, in 6.7 GB instead of 16.7 — and no
speculative decoding exists for it. Full numbers and the trade-offs:
[its benchmarks README](combinations/bonsai/2/27b/ubuntu/nvidia4090/llamacpp-opencode/benchmarks/README.md).

¹ **The 64GB row is extrapolated, not measured.** Both macOS combinations were
measured on a 128 GB M5 Max. The 27B pack wires 27.9 GB and fits a 64 GB
machine, but nobody has run it on one; every line that depends on that claim
says so. See its [benchmarks README](combinations/qwen/3.8/27b/macos/64GB/mtplx-opencode/benchmarks/README.md).

³ **16 GB is not enough for agentic coding. Tested on a MacBook Air M2 16 GB,
the MiMo row is fundamentally unworkable** ([report](docs/20260924-mimo-9b-macbook-air-m2-16gb.md)). The context window
is **20,480 tokens**, which MTPLX's memory plan sets from the 16 GB (8.1 GiB of
weights and 3.25 GiB of runtime leave 0.67 GiB for KV); the model supports
262,144, and a faster chip gets the same window. With pi's reply reserve that
leaves 12,288 tokens for everything else, and pi's first request (its system
prompt and tools plus a one-line ask) is 3,231. Reading story 1 of this repo's vidi benchmark alone takes ~14,800.
In a real pi session it prefilled at **~55 tok/s** and decoded at **~5 tok/s**
(3.7–6.1): a request for a Fibonacci function took 5 min 43 s over three turns.
The first install attempt froze the Mac (the memory check warned, then carried
on). Those speeds are an M2's, without native BF16 (see ⁴). Use a 16 GB Mac as
the client for a model served by a bigger machine instead.

⁴ **Chip generation, not just memory.** MTPLX offers MiMo V2.6 Qwen 9B (a
coding/agent fine-tune by Xiaomi MiMo, BF16 vision tower and draft head) on
M3/M4/M5 only; it runs on M1/M2 but without native BF16, and the slowdown is
unmeasured. `./install.sh` never picks it by default; name it:
`./install.sh mimo`.

⁵ **The two SGLang rows are unmeasured by this repo.** They transcribe a
merged recipe, [0xSero/local-ai-registry PR #83](https://github.com/0xSero/local-ai-registry/pull/83),
whose numbers the recipe author measured on a *bare* RTX 3090: 262k context,
MTP on, ~99 (27B) and ~252 (35B-A3B) tok/s prose decode. Nobody has run them
through these installers yet. They run SGLang from a digest-pinned container
image whose kernels are built only for sm_86; an RTX 4090 or 5090 is untested
(the installer warns). Both are 3.0 bits per weight, so their speed is not a
like-for-like comparison with the 4-bit-class llama.cpp rows. `./install.sh`
never picks them on its own; name them to install them.

⁶ **The mlx-serve row is unmeasured by this repo.** It serves the model
author's own pack ([ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit](https://huggingface.co/ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit))
with [mlx-serve](https://github.com/ddalcu/mlx-serve) 26.9.5+. Its memory
figures are estimates from file sizes (~70 GiB of weights, ~75 GiB at 128k);
its speeds are the author's (M4 Max: ~60 tok/s serial, 78 with MTP). Tool
calling is supported per mlx-serve's source and is checked by the smoke test,
not yet observed here. Run it only with no other model server up — the
launcher refuses otherwise. `./install.sh` never picks it over the measured
MTPLX row.

⁷ **The Strix Halo row is unmeasured by this repo, so far.** It was written for
a Minisforum MS-S1 MAX (Ryzen AI Max+ 395, 128 GB) ahead of its first run, and
its [measurement plan](combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi/benchmarks/README.md)
is what turns it into a measured row. It needs Ubuntu 26.04 and the GPU's GTT
limit raised from the kernel default of about half of RAM (`amd-ttm --set 120`,
then reboot); the installer checks both and refuses with the fix. Stock
llama.cpp cannot load this model's MTP draft head, so it builds the pull
request that adds it ([#28243](https://github.com/ggml-org/llama.cpp/pull/28243)),
for Vulkan or ROCm. Published figures from another Strix Halo box are ~17 tok/s
decode without MTP and 32–56 at 8k with it, on a different fork and head. It ranks below any measured row for the same machine; today it
is the only Strix Halo row, so `./install.sh` offers it there.

**Want one that isn't here?** See
[docs/adding-a-combination.md](docs/adding-a-combination.md). A new combination
that reuses the existing adapters costs four files and no shell logic.

---

## What a combination gives you

Some of this is shared by every row; some belongs to exactly one. The
difference matters — "a combination gives you vision" was true when there was
one combination and is false now — so it is marked.

**Every combination:**

- **A context window tuned to its memory tier** — see the Context column: 128k
  on most rows, 20k on the 16 GB row (all a 16 GB Mac can hold next to the
  weights, and [too small for agentic coding](docs/20260924-mimo-9b-macbook-air-m2-16gb.md)), 262k on the SGLang rows (the
  recipe author's bare-card setup). What each window costs differs per row.
- **An OpenAI-compatible endpoint with tool calling**, and OpenCode already
  pointed at it.
- **On-demand lifecycle**: the server starts when your agent needs it and shuts
  down 5 minutes after you stop, so the weights are not parked in memory all day.
- **A smoke test that means something**: loads the model and generates over the
  API, rather than checking a file exists.
- **Speed claims that are checked, not assumed**: where a row's headline rate
  depends on speculative decoding, the installer proves the drafter is live
  before calling the install good. One row has no drafter at all, and says so
  rather than inheriting the claim.

**Qwen3.8-27B — Ubuntu 22.04 / RTX 4090 (24GB):**

- **~92 tok/s generation** against ~44 with MTP off, on one consumer GPU — and
  the installer asserts draft acceptance appeared in the log.
- **Vision.** Qwen3.8's vision tower is native to the model; GGUF conversion
  emits it as a separate `mmproj` file that llama.cpp loads only when asked.
  Loading it costs 32k of context on a 24GB card (128k → 96k), which is why it
  is off outside the `vision` profiles — a VRAM trade, not a missing capability.

**Swift-Qwen3.8-27B — Ubuntu 22.04 / RTX 4090 (24GB):**

- **The fast-of-the-two on identical hardware.** Measured against the baseline
  above on the same 4090, same binary and prompts: 1.37–1.51× faster end-to-end
  across the low/medium/xhigh sweep, with 23–39% fewer reasoning chars
  ([A/B report](docs/20260921-swift-qwen38-27b-ab.md)). A retrained Qwen3.8-27B
  that thinks less, so routine agent turns come back sooner.
- **MTP head baked into the weights.** Swift's draft head is Q8_0 inside the
  GGUF (no separate 1.57 GiB sidecar, no `-md`), run at `--spec-draft-n-max 3`
  — which also leaves ~1.5 GiB more room for context than the baseline.
- **The cut is deliberation, not capability.** The A/B measures speed and token
  count, not answer quality — the report says so, and it is the honest limit of
  this comparison.

**Ternary Bonsai 2 27B — Ubuntu 22.04 / RTX 4090 (24GB):**

- **92.2 tok/s generation with no drafter at all**, and 3,016 tok/s prefill:
  the decode rate the Qwen row needs MTP to reach, from 6.7 GB of weights
  instead of 16.7.
- **No speculative decoding.** None ships for this model, and pointing the Qwen
  MTP head at it was measured a net loss — 0.62 draft acceptance, 95.8 → 92.6
  tok/s. The installer's draft-acceptance assertion does not apply to this row,
  because there is nothing to assert.
- **Vision that costs no context.** The `vision` profile still holds 128k and
  adds ~850 MiB, because at 10.7 GB the card was never the constraint — 13.4 GB
  is still free at 128k.
- **About a quarter of the agentic coding ability, gone.** The publisher's
  own whitepaper puts Bonsai 2 at 52.8 on Terminal-Bench 2.1 and 60.8 on
  SWE-bench Verified, against 69.7 and 80.6 for full-precision Qwen3.8-27B.
  Its 14-benchmark average hides this; the speed numbers above are real, and
  so is this price. Quoted in full in
  [the combination README](combinations/bonsai/2/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md#the-agentic-coding-gap).
- **A fork, not upstream** — see the footnote above.

**Qwen3.8-Flash-Next — macOS 26 / 128GB Apple silicon:**

- **49.8 tok/s decode, 38.8 tok/s effective**, measured across 65 scored
  requests from a real OpenCode session rather than a synthetic loop.
- **Vision ships, unmeasured.** Both MTPLX packs carry their vision tower
  (`model-vision.safetensors`, plus `vision_config` and the preprocessor
  sidecars), and MTPLX serves images from 2.10.0 — the minimum both macOS
  rows pin. No vision profile and no numbers on this path: nobody has run it.

---

## How the repo is laid out

```
install.sh                    picks the combination that suits this machine
start.sh                      runs whatever is installed, discovered from its manifest
install-<combination>.sh      root pointer scripts — ~8 lines, no logic
lib/                          ALL the logic, shared by every combination
combinations/<family>/<version>/<size>/<os>/<memory>/<stack>/
                              config.sh, profiles.tsv, help.txt, README.md
benchmarks/                   the harnesses behind every measured number
tools/dbench/                 runs those harnesses on remote machines (server + client, Rust)
tests/                        the checks that need no hardware
docs/                         measurements, methodology, contributor guide
samples/                      things models built here, kept as worked examples
```

The point of the split is that **nothing is duplicated between combinations**.
A combination is data — a config file, a table of measured profiles, and its
help text. Adding one does not add shell code:

```
install-qwen-3.8-27b-ubuntu-nvidia4090-llamacpp-opencode.sh   ← 8 lines
  └─ lib/bootstrap.sh          resolves the config, orders the install
       ├─ lib/os.sh            OS qualification
       ├─ lib/deps.sh          packages and build tools
       ├─ lib/accel/cuda.sh    device qualification + build flags   ← swap per accelerator
       ├─ lib/llamacpp.sh      clone, update, build                 ← swap per backend
       ├─ lib/hf.sh            weights
       ├─ lib/model.sh         asset download
       ├─ lib/launcher.sh      writes the manifest + command shims
       ├─ lib/smoke.sh         proves it works
       └─ lib/summary.sh       the closing report
```

At run time the same idea holds. **One** launcher and **one** lifecycle manager
serve every combination:

| Installed as | From | Shared? |
|---|---|---|
| `~/.local/bin/local-ai-<backend>-server` | `lib/runtime/server-<backend>.sh` | yes, all combinations on that backend |
| `~/.local/bin/local-ai-session` | `lib/runtime/session.sh` | yes, all combinations |
| `~/.local/bin/qwen38-27b-server` | generated | 2-line shim |
| `~/.local/bin/qwen38-27b-opencode` | generated | 2-line shim |

Everything that varies — model filenames, profiles, safe KV types, sampling
presets, client details — is read at run time from a small manifest
(`install.env`) written next to the weights. The shipped scripts contain **no
machine-specific paths**: they resolve from `$HOME`, so the same file works for
any user on any machine and can be pasted into a bug report without leaking a
username.

Three extension points, each one file with a small documented contract:

- **Accelerator** — `lib/accel/<name>.sh` (`cuda`, `metal`)
- **Backend** — `lib/<name>.sh` (`llamacpp`, `mtplx`, `sglang`, `mlxserve`)
- **Client** — `lib/clients/<name>.sh` (`opencode`, `pi`) — the client is an orthogonal axis: every one is installed and you pick at run time (`./start.sh --pi`), while `CLIENT` in a combination's `config.sh` only names the default

---

## Docs

- **[docs/discovery.md](docs/discovery.md)** — the full investigation behind
  the Qwen3.8-27B tuning: why only 16 of 65 layers hold a KV cache, why
  `-ub 256` matters more than any KV setting, the complete measurement table
  with every OOM, and reproduction steps. Read it before changing quant,
  context or speculative-decoding settings.
- **[docs/discovery-macos-mtplx.md](docs/discovery-macos-mtplx.md)** — the
  macOS investigation: why the context ceiling is 131072 and not the advertised
  262144, why reasoning effort is a server flag (OpenCode silently drops the
  client-side field), why Metal's working set and not the machine's RAM is the
  memory that constrains a model, and a prediction that turned out wrong.
- **[docs/adding-a-combination.md](docs/adding-a-combination.md)** — the
  contract for contributing a combination, accelerator, backend or client.
- **[tests/](tests/)** — `./tests/run-tests.sh`. Selection across simulated
  machine classes, the download-integrity checks, and bash 3.2 / BSD
  portability. No hardware needed, so it runs anywhere.
- **[benchmarks/](benchmarks/)** — speed benchmarks ([perf/](benchmarks/perf/)), the Vidi build benchmark ([vidi/](benchmarks/vidi/)) and its reference stacks ([reference/](benchmarks/reference/)): the harnesses behind the numbers, so they can
  be re-derived rather than taken on trust. Results are stored with the
  combination they were measured on.
- **[tools/dbench/](tools/dbench/)**: runs a benchmark harness remotely, on any number of machines, driven from any machine. `dbench serve` goes on each benchmark box; the client, from anywhere, submits, watches, cancels and reads events. Each node carries on by itself (restarts, recovery after reboot), and results arrive through git. The design is in [docs/20260924-distributed-bench-design.md](docs/20260924-distributed-bench-design.md).
- **[tools/vidi-gallery/](tools/vidi-gallery/)**: one local page to review every Vidi build: held-out scores, judging and cost side by side, and any run's final build opened in its own window, labelled with its setup and run.
- **[benchmarks/vidi/](benchmarks/vidi/)**: the Vidi build benchmark: a coding setup builds a real spec story by story, scored by a **held-out** suite. The spec and held-out suite are in a **private** repo; ask the owner for access to run it on your own hardware (a 3090, a DGX and so on). Details are in its README.
- **[samples/](samples/)** — a 3D game written end-to-end by the local model
  through OpenCode, in thinking and non-thinking variants. A worked example of
  what this setup produces, not maintained software.

---

## Security

Servers bind to `127.0.0.1` with **no authentication**. `HOST=0.0.0.0` exposes
a model server to your entire network. Put a reverse proxy with auth in front
if you need remote access.

`dbench serve` should bind to a LAN or Tailscale address. It requires a bearer token on every endpoint except `/v1/health`, and it only runs jobs made of named, validated parts, never a command string it was sent. The benchmark packs it runs are still code from this repo, so anyone who can push here can run code on your nodes.

The MTPLX launcher passes `--no-auth` only when the bind address is a loopback
one; MTPLX itself still requires an API key on any other interface, so a
non-local bind cannot end up unauthenticated by accident.

---

## License

This repository is Apache 2.0 (see [LICENSE](LICENSE)).

Model weights are licensed separately by their publishers — Qwen3.8-27B is
Apache 2.0 per the [Qwen model card](https://huggingface.co/Qwen/Qwen3.8-27B),
and llama.cpp is MIT. MTPLX is a third-party Mac-only inference server by
Youssouf Al Toukhi, installed from PyPI at install time and licensed by its
author. This repo contains no weights; the installers download them from
Hugging Face at install time.

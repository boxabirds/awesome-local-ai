# awesome-local-ai

One-command installers for running capable models **locally**, as an
OpenAI-compatible API with a coding agent already wired up.

Every combination is a *tested pairing* of model, hardware and stack. Every
performance and memory number in this repo was **measured on real hardware**,
not estimated — and where a figure is extrapolated, it says so.

```bash
git clone https://github.com/boxabirds/awesome-local-ai.git
cd awesome-local-ai
./install-qwen-3.8-27b-ubuntu-24GB-llamacpp-opencode.sh
./run.sh                 # server starts on demand, stops when you're done
```

`run.sh` reads the manifests the installer left behind, so it runs whatever
this machine actually has — no arguments needed for the common case, and a
clear prompt to choose when more than one combination is installed.

---

## Combinations

Pick the row that matches your hardware and run its script from the repo root.
The installer refuses to run on hardware it was not measured on, rather than
half-installing.

| Model | OS | Memory | Stack | Install | Details |
|---|---|---|---|---|---|
| Qwen3.8-27B | Ubuntu 22.04 | 24GB NVIDIA | llama.cpp + OpenCode | [`install-qwen-3.8-27b-ubuntu-24GB-llamacpp-opencode.sh`](install-qwen-3.8-27b-ubuntu-24GB-llamacpp-opencode.sh) | [README](combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/README.md) |

**Want one that isn't here?** See
[docs/adding-a-combination.md](docs/adding-a-combination.md). A new combination
that reuses the existing adapters costs four files and no shell logic. macOS
(including the `mtplx` stack) is documented there as an explicit, unclaimed
piece of work — with the exact contracts to implement.

---

## What a combination gives you

Using the one combination that exists today as the example:

- **128k context** on a single 24GB consumer GPU — enough to hold a real repo.
- **~92 tok/s generation**, roughly double, via MTP speculative decoding —
  and the installer *asserts* speculative decoding is actually live rather
  than assuming it.
- **Tool calling and vision** from one local endpoint.
- **On-demand lifecycle**: the server starts when your agent needs it and shuts
  down 5 minutes after you stop, so 22 GB is not parked on your GPU all day.
- **A smoke test that means something**: loads the model, generates over the
  API, and checks draft acceptance appeared in the log.

---

## How the repo is laid out

```
install-<combination>.sh      root pointer scripts — ~8 lines, no logic
run.sh                        runs whatever is installed, discovered from its manifest
lib/                          ALL the logic, shared by every combination
combinations/<family>/<version>/<size>/<os>/<memory>/<stack>/
                              config.sh, profiles.tsv, help.txt, README.md
benchmarks/                   the harnesses behind every measured number
docs/                         measurements, methodology, contributor guide
samples/                      things models built here, kept as worked examples
```

The point of the split is that **nothing is duplicated between combinations**.
A combination is data — a config file, a table of measured profiles, and its
help text. Adding one does not add shell code:

```
install-qwen-3.8-27b-ubuntu-24GB-llamacpp-opencode.sh   ← 8 lines
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
| `~/.local/bin/local-ai-server` | `lib/runtime/server.sh` | yes, all combinations |
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

- **Accelerator** — `lib/accel/<name>.sh` (`cuda` today; `metal` is spec'd, unwritten)
- **Backend** — `lib/<name>.sh` (`llamacpp` today)
- **Client** — `lib/clients/<name>.sh` (`opencode` today, ~50 lines)

---

## Docs

- **[docs/discovery.md](docs/discovery.md)** — the full investigation behind
  the Qwen3.8-27B tuning: why only 16 of 65 layers hold a KV cache, why
  `-ub 256` matters more than any KV setting, the complete measurement table
  with every OOM, and reproduction steps. Read it before changing quant,
  context or speculative-decoding settings.
- **[docs/adding-a-combination.md](docs/adding-a-combination.md)** — the
  contract for contributing a combination, accelerator, backend or client.
- **[benchmarks/](benchmarks/)** — the harnesses behind the numbers, so they can
  be re-derived rather than taken on trust. Results are stored with the
  combination they were measured on.
- **[samples/](samples/)** — a 3D game written end-to-end by the local model
  through OpenCode, in thinking and non-thinking variants. A worked example of
  what this setup produces, not maintained software.

---

## Security

Servers bind to `127.0.0.1` with **no authentication**. `HOST=0.0.0.0` exposes
an unauthenticated model server to your entire network. Put a reverse proxy
with auth in front if you need remote access.

---

## License

This repository is Apache 2.0 (see [LICENSE](LICENSE)).

Model weights are licensed separately by their publishers — Qwen3.8-27B is
Apache 2.0 per the [Qwen model card](https://huggingface.co/Qwen/Qwen3.8-27B),
and llama.cpp is MIT. This repo contains no weights; the installers download
them from Hugging Face at install time.

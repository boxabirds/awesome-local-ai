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
./start.sh               # server starts on demand, stops when you're done
```

`install.sh` probes the host and reads the combinations tree, whose path
segments already encode the OS and memory tier each combination was measured
against. It shows what it chose and what else would have fit, then hands over
to that combination's own installer — which still qualifies the hardware with
measured thresholds and refuses with numbers if it falls short. Selection
narrows; qualification decides.

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

| Model | OS | Memory | Stack | Install | Details |
|---|---|---|---|---|---|
| Qwen3.8-27B | Ubuntu 22.04 | 24GB NVIDIA | llama.cpp + OpenCode | [`install-qwen-3.8-27b-ubuntu-24GB-llamacpp-opencode.sh`](install-qwen-3.8-27b-ubuntu-24GB-llamacpp-opencode.sh) | [README](combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/README.md) |
| Qwen3.8-27B | macOS 26 | 64GB Apple silicon ¹ | MTPLX + OpenCode | [`install-qwen-3.8-27b-macos-64GB-mtplx-opencode.sh`](install-qwen-3.8-27b-macos-64GB-mtplx-opencode.sh) | [README](combinations/qwen/3.8/27b/macos/64GB/mtplx-opencode/README.md) |
| Qwen3.8-Flash-Next | macOS 26 | 128GB Apple silicon | MTPLX + OpenCode | [`install-qwen-3.8-flash-next-macos-128GB-mtplx-opencode.sh`](install-qwen-3.8-flash-next-macos-128GB-mtplx-opencode.sh) | [README](combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/README.md) |

¹ **The 64GB row is extrapolated, not measured.** Both macOS combinations were
measured on a 128 GB M5 Max. The 27B pack wires 27.9 GB and fits a 64 GB
machine, but nobody has run it on one; every line that depends on that claim
says so. See its [benchmarks README](combinations/qwen/3.8/27b/macos/64GB/mtplx-opencode/benchmarks/README.md).

**Want one that isn't here?** See
[docs/adding-a-combination.md](docs/adding-a-combination.md). A new combination
that reuses the existing adapters costs four files and no shell logic.

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
install.sh                    picks the combination that suits this machine
start.sh                      runs whatever is installed, discovered from its manifest
install-<combination>.sh      root pointer scripts — ~8 lines, no logic
lib/                          ALL the logic, shared by every combination
combinations/<family>/<version>/<size>/<os>/<memory>/<stack>/
                              config.sh, profiles.tsv, help.txt, README.md
benchmarks/                   the harnesses behind every measured number
tests/                        the checks that need no hardware
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
- **Backend** — `lib/<name>.sh` (`llamacpp`, `mtplx`)
- **Client** — `lib/clients/<name>.sh` (`opencode` today, ~50 lines)

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
- **[benchmarks/](benchmarks/)** — the harnesses behind the numbers, so they can
  be re-derived rather than taken on trust. Results are stored with the
  combination they were measured on.
- **[samples/](samples/)** — a 3D game written end-to-end by the local model
  through OpenCode, in thinking and non-thinking variants. A worked example of
  what this setup produces, not maintained software.

---

## Security

Servers bind to `127.0.0.1` with **no authentication**. `HOST=0.0.0.0` exposes
a model server to your entire network. Put a reverse proxy with auth in front
if you need remote access.

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

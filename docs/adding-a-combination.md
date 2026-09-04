# Adding a combination

A *combination* is one tested pairing of **model family / version / size / OS /
memory budget / stack**. This document is the contract: follow it and a new
combination costs a config file, a profile table and a help file — no new shell
logic.

> **The rule that matters:** if you find yourself copying a function out of
> `lib/`, stop. Either the thing you are copying belongs in `lib/` behind a
> variable, or it belongs in one of the three extension points below
> (accelerator, backend, client). Duplicated logic across combinations is the
> failure mode this layout exists to prevent.

---

## The layout

```
install-<combination>.sh              root pointer, ~8 lines, no logic
lib/                                  ALL the logic, shared by every combination
  bootstrap.sh                        engine: resolves config, orders the steps
  common.sh  os.sh  deps.sh  hf.sh    cross-cutting concerns
  model.sh  launcher.sh  service.sh
  smoke.sh   summary.sh
  select.sh                           host probe + combination selection (install.sh)
  llamacpp.sh  mtplx.sh               backend adapters     (BACKEND=...)
  accel/cuda.sh  accel/metal.sh       accelerator adapters (ACCEL=...)
  clients/opencode.sh                 client adapter       (CLIENT=opencode)
  runtime/server-<backend>.sh         launcher, installed as local-ai-<backend>-server
  runtime/session.sh                  generic lifecycle mgr, installed as local-ai-session
combinations/<family>/<version>/<size>/<os>/<memory>/<stack>/
  config.sh                           DATA ONLY
  profiles.tsv                        the measured profile table
  help.txt                            prose for `--help`
  README.md                           the combination's own documentation
```

The **path segments** are, in order:

| Segment | Meaning | Examples |
|---|---|---|
| family | model family, lowercase | `qwen`, `llama`, `gemma` |
| version | family version | `3.8`, `4`, `3` |
| size | parameter count, or a variant name when there is no clean size | `27b`, `8b`, `flash-next` |
| os | operating system, lowercase | `ubuntu`, `macos` |
| memory | the memory budget that constrains the model — VRAM on a discrete GPU, unified memory on Apple silicon | `24GB`, `64GB`, `128GB` |
| stack | inference backend + client, hyphenated | `llamacpp-opencode`, `mtplx-opencode` |

The root script's filename is those segments joined with `-`:

```
combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/
        ->  install-qwen-3.8-27b-ubuntu-24GB-llamacpp-opencode.sh
```

Not every combination needs every segment to be distinct — a model that has one
size only still gets a size directory, so the tree stays uniform and scriptable.

---

## Adding a combination that reuses the existing adapters

If your combination is llama.cpp + CUDA + OpenCode on a Linux distro, you write
**no shell logic at all**. Four files:

### 1. `combinations/<path>/config.sh`

Data only. Copy
[`combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/config.sh`](../combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/config.sh)
and change the values. Required variables (`lib/bootstrap.sh` enforces these):

| Variable | What it is |
|---|---|
| `INSTALL_ID` | install dir name, command prefix, service name — must be unique across combinations |
| `DISPLAY_NAME`, `MODEL_DISPLAY_NAME` | human-facing names |
| `TARGET_OS` (+ `TARGET_OS_VERSION`) | which OS qualification path to take |
| `ACCEL` | selects `lib/accel/<ACCEL>.sh` |
| `BACKEND` | selects `lib/<BACKEND>.sh` |
| `CLIENT` | selects `lib/clients/<CLIENT>.sh` |
| `SYSTEM_PACKAGES` | array of packages for the OS's package manager |
| `MODEL_SUBDIR`, `MODEL_ASSETS` | where weights live and what to fetch |
| `MODEL_ALIAS_DEFAULT` | the stable id advertised at `/v1/models` |
| `DEFAULT_PROFILE`, `SAFE_KV_TYPES`, `SAMPLING_THINKING` | serving defaults |
| `REASONING_EFFORT_DEFAULT`, `REASONING_EFFORTS` | *(optional)* default effort level, and the levels the model's template accepts. Check the template before setting these — Qwen3.8's defaults to `xhigh` when the field is unset and **raises** on a level it does not know, so an unvalidated value breaks every request |
| `DEFAULT_PROVIDER`, `CONTEXT_LIMIT`, `OUTPUT_LIMIT` | client config values |

`MODEL_ASSETS` is one `repo|filename|role|approx-size` record per line. Role
`model` is required; `mmproj` (vision) and `mtp` (speculative decoding) are
recognised by the runtime, and a failed download of either degrades rather than
aborts.

Three optional hooks let a combination contribute prose without touching `lib/`:
`low_memory_advice`, `combination_performance`, `combination_troubleshooting`.

### 2. `combinations/<path>/profiles.tsv`

`name|ctx|kv_type|vision|np|ub|need_mib|summary`, one profile per line, `#` for
comments. `need_mib` is the server-only memory footprint; the launcher
pre-flights against it and, if the device is short, names the largest profile
that would still fit.

The launcher reads this file **at run time**. Editing it changes the profiles
without touching a line of code — but only put measured numbers in it (see
[Honesty](#honesty) below).

### 3. `combinations/<path>/help.txt`

Whatever `<install-id>-server --help` should print after the auto-generated
profile table. Caveats, KV-type warnings, gotchas, examples.

### 4. `install-<combination>.sh` at the repo root

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="<family>/<version>/<size>/<os>/<memory>/<stack>"
. "${REPO_ROOT}/lib/bootstrap.sh"
```

That is the whole script. `chmod +x` it and add a row to the catalogue table in
the root `README.md`.

---

## Adding a new accelerator, backend or client

These are the three extension points. Each is one file implementing a small
contract; nothing else in `lib/` needs to change.

### Accelerator — `lib/accel/<name>.sh`

Selected by `ACCEL=<name>`. Must define:

| Symbol | Contract |
|---|---|
| `qualify_accel` | detect the device, refuse if it is too small, set `ACCEL_DESC`, `ACCEL_ARCH`, `ACCEL_MEM_MIB` |
| `accel_cmake_args` | print one cmake flag per line for the backend build |
| `accel_build_key` | print a short string; when it changes, the backend rebuilds |
| `accel_probe_binary <path>` | return 0 if the built binary actually sees the device |

`lib/accel/cuda.sh` is the reference. A Metal adapter would print
`-DGGML_METAL=ON`, key on the chip generation, and probe with
`--list-devices | grep -qi metal`.

The launcher (`lib/runtime/server.sh`) also branches on `ACCEL` for its
free-memory pre-flight, since `nvidia-smi` has no cross-platform equivalent.
Add a branch there if your accelerator can report free memory.

### Backend — `lib/<name>.sh`

Selected by `BACKEND=<name>`. Must define:

| Symbol | Contract |
|---|---|
| `ensure_backend` | install or build the serving binary; called from `lib/bootstrap.sh`'s `main()` |
| `backend_profile_table <tsv>` | render this backend's `profiles.tsv` columns for `--help` and the summary |
| `<name>_sha` | a version string for the closing report |
| `PROFILE_SCHEMA` | the column layout of its `profiles.tsv` |
| `BACKEND_REQUIRED_VARS` | extra config variables this backend needs from a combination |

Optional, each defaulting to the llama.cpp-shaped behaviour when absent:

| Symbol | Contract |
|---|---|
| `backend_fetch_model` | obtain the weights; define it when the backend owns its own model cache. Must be idempotent — see below |
| `backend_smoke_context <port>` | report the context the server actually served |
| `backend_smoke_assert <log> <port>` | prove speculative decoding is live |
| `BACKEND_NEEDS_BUILD_TOOLS`, `BACKEND_NEEDS_HF` | set to `0` for a backend that ships prebuilt and fetches its own weights |

A backend that is not llama.cpp also needs its own runtime launcher at
`lib/runtime/server-<name>.sh`: `server-llamacpp.sh` builds a `llama-server`
command line specifically. `lib/launcher.sh` installs whichever one the
combination selects as `local-ai-<backend>-server`. Model it on the existing
one: read `install.env` and `profiles.tsv`, resolve everything from `$HOME`,
bake no absolute paths.

### Client — `lib/clients/<name>.sh`

Selected by `CLIENT=<name>`. Must define:

| Symbol | Contract |
|---|---|
| `CLIENT_DISPLAY_NAME` | name shown in messages |
| `client_ensure_installed` | exit with an install hint if the binary is absent |
| `client_write_config` | write the provider config; **never** clobber an existing one |
| `client_matches_pid <pid>` | does this pid look like the client? (used by the idle reaper) |
| `client_exec "$@"` | `exec` the client against the local server |

`lib/clients/opencode.sh` is ~50 lines and is the reference. The whole
lifecycle — locking, client registry, idle watcher, config-drift warning — is
shared in `lib/runtime/session.sh` and you get it for free.

---

## Adding a macOS combination

Two exist: `qwen/3.8/27b/macos/64GB/mtplx-opencode` and
`qwen/3.8/flash-next/macos/128GB/mtplx-opencode`. What that took, so the next
one is cheaper:

**`lib/accel/metal.sh`** implements the four-symbol contract. The part worth
copying is how `ACCEL_MEM_MIB` is derived. On Apple silicon it is *not*
`hw.memsize`: memory is unified, but Metal's `recommendedMaxWorkingSetSize` is
the real ceiling — 110,100 MiB on a 128 GB M5 Max, not 131,072. It asks MLX for
that figure, falls back to `iogpu.wired_limit_mb` when it has been set
explicitly, and only then to a **labelled** 75%-of-RAM estimate. Reporting RAM
would let a combination qualify and then die part-way through loading.

**`lib/mtplx.sh`** is the second backend, which forced the indirection this
document previously said to add when one arrived:

| Symbol | Why it exists |
|---|---|
| `ensure_backend` | `bootstrap.sh` no longer calls `ensure_llama_cpp` directly |
| `backend_fetch_model` | llama.cpp pulls named files; MTPLX pulls whole model packs into its own cache |
| `backend_profile_table` | another backend has no KV type and no vision flag to print |
| `backend_smoke_context` | where the served context is advertised differs |
| `backend_smoke_assert` | proof that speculative decoding is live differs |
| `BACKEND_NEEDS_BUILD_TOOLS`, `BACKEND_NEEDS_HF` | MTPLX ships prebuilt from PyPI: nothing to compile, no `hf` CLI |
| `BACKEND_REQUIRED_VARS` | `MODEL_SUBDIR`+`MODEL_ASSETS` for one, `MODEL_REPO` for the other |
| `PROFILE_SCHEMA` | the backend owns its `profiles.tsv` column layout |

**`lib/runtime/server-mtplx.sh`** is its runtime launcher.
`lib/runtime/server.sh` was renamed to `server-llamacpp.sh`; `lib/launcher.sh`
installs `lib/runtime/server-<backend>.sh` as `local-ai-<backend>-server` and
points the shim at it. A backend that is not llama.cpp needs its own, because
the old one emits `llama-server` flags and nothing else.

**`lib/service.sh`** gained `_service_launchd`. It is opt-in behind
`INSTALL_SERVICE=1`: on macOS the on-demand session manager covers most use,
and parking 28–115 GB of weights in RAM at login rarely is what anyone wants.
launchd has no equivalent of systemd's `%h`, so that plist is the one generated
file that must contain an absolute home path.

### What broke, that had only ever run on Ubuntu

Each of these was a real failure on a Mac, not a theoretical one:

| Construct | Problem |
|---|---|
| `find -printf` | BSD find: `unknown primary or operator`. Replaced by `list_combinations` in `lib/common.sh` |
| `mapfile` | bash 4+; stock macOS `/bin/bash` is 3.2.57 |
| `setsid` | does not exist. Two call sites; both now go through `detached()` |
| `hf download --include <file>` | assumes single-file GGUF; MTPLX packs are sharded directories of 30–115 GB |
| `[[ -n "$X" ]] && y=…` | returns 1 when `X` is empty, which `set -e` treats as fatal. Harmless while every combination shipped an mmproj |

`tests/syntax-test.sh` guards all of these, and it is what found the second
`setsid` after the first was fixed by hand.

### profiles.tsv has more than one shape

The columns belong to the backend, and the layout is declared on line 1 of
every file and recorded in the manifest as `PROFILE_SCHEMA`:

```
llamacpp   name|ctx|kv_type|vision|np|ub|need_mib|summary
mtplx      name|ctx|mtp_depth|effort|max_tokens|need_mib|summary
```

`need_mib` means the same thing in both — the server-only footprint the
launcher pre-flights against — but say in the header what it does and does not
include. The MTPLX rows count measured wired weights and *not* the KV cache,
which was never separately instrumented, so they are a floor and the file says
so.

### Weights must be idempotent to fetch

At 115 GB this stops being a nicety. `backend_fetch_model` must do nothing when
the pack is already present and valid, resume when it is partial, and only then
download. For MTPLX that is `mtplx models --json` to classify, `--update` to
resume with a delta, and `pull` otherwise.

One trap: `mtplx models --json` validates the runtime contract and the MTP
sidecar but **not** the weight shards. A pack holding only
`model.safetensors.index.json` and the tokenizer is reported as missing nothing
but the sidecar — which is exactly what an interrupted download looks like. So
`lib/mtplx.sh` walks the index's weight map itself. If you add a backend with
its own cache, assume its validator is necessary and not sufficient until you
have tested it against a half-finished download.

## Honesty

This repo's whole value is that its numbers are real. Two rules:

- **Measured numbers only.** Every figure in a `profiles.tsv`, a `help.txt` or
  a combination `README.md` must come from a run you did on that hardware. If a
  number is extrapolated, the line it appears on must say so — the existing
  16GB quant table is the pattern to copy.
- **Refuse rather than half-install.** If the hardware does not qualify, exit
  with numbers and a suggested alternative. A partial install that OOMs 20 GB
  into a download is worse than a clear refusal.

---

## Testing a new combination

```bash
./tests/run-tests.sh                                   # syntax, portability, selection
./install.sh --list                                    # does selection see it?
./install.sh --dry-run                                 # would it be chosen here?
SKIP_SMOKE_TEST=1 ./install-<combination>.sh           # everything but the model load
./install-<combination>.sh                             # full run, asserts generation
SKIP_SMOKE_TEST=1 ./install-<combination>.sh           # again: must be a no-op
<install-id>-server --help                             # profile table renders
./start.sh --list                                      # is it discoverable?
<install-id>-<client> --server-only && <install-id>-<client> --status
<install-id>-<client> --stop
```

Run the installer **twice**. The second run is the one that catches a
combination that re-downloads weights it already has, and re-running is the
supported way to regenerate the runtime after a config change.

`SKIP_BACKEND_UPDATE=1` keeps the backend checkout you already have, which
makes iterating on config changes fast.

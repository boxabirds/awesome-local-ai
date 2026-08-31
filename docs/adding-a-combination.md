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
  llamacpp.sh                         backend adapter      (BACKEND=llamacpp)
  accel/cuda.sh                       accelerator adapter  (ACCEL=cuda)
  clients/opencode.sh                 client adapter       (CLIENT=opencode)
  runtime/server.sh                   generic launcher, installed as local-ai-server
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

Selected by `BACKEND=<name>`. Must define `ensure_<something>` called from
`lib/bootstrap.sh`'s `main()`, plus whatever the summary needs. Today
`bootstrap.sh` calls `ensure_llama_cpp` directly; a second backend means giving
that call a level of indirection (`ensure_backend`) — do that when the second
backend arrives, not before.

A backend that is not llama.cpp will also need its own runtime launcher.
`lib/runtime/server.sh` builds a `llama-server` command line specifically.

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

## Adding a macOS combination (e.g. mtplx)

Nobody has contributed a macOS combination yet. The Ubuntu combination's
numbers are meaningless on Apple silicon and must not be copied across. Here is
the specific work:

1. **`lib/accel/metal.sh`** — implement the four-symbol accelerator contract
   above. `ACCEL_MEM_MIB` on Apple silicon is unified memory; note that macOS
   caps what the GPU may allocate (`iogpu.wired_limit_mb`), so the usable
   budget is *not* the whole machine's RAM. Whatever you decide, the `24GB` /
   `64GB` / `128GB` path segment must mean the same thing to a reader as it
   does on Linux: the memory budget that constrains the model.

2. **`lib/os.sh`** already has a `macos` branch (`_qualify_macos`), and
   `lib/deps.sh` already has a Homebrew path (`_deps_brew`). Both are written
   but **untested** — expect to fix them on first run.

3. **`lib/service.sh`** has no launchd path. Either add `_service_launchd` or
   accept that macOS gets no always-on service; the on-demand session manager
   covers most use anyway.

4. **The stack.** `mtplx` is a Mac-only vertical stack by Youssouf Al Toukhi.
   If it is not llama.cpp underneath it needs its own `lib/mtplx.sh` backend
   adapter and its own runtime launcher — `lib/runtime/server.sh` emits
   `llama-server` flags and nothing else. Model the launcher on that file:
   read `install.env` and `profiles.tsv`, resolve everything from `$HOME`, bake
   no absolute paths.

5. **Measure before you publish.** Fill `profiles.tsv` and `help.txt` from a
   run on real hardware, one row per configuration you actually loaded.

Expected paths, for consistency:

```
combinations/qwen/3.8/27b/macos/64GB/mtplx-opencode/    -> install-qwen-3.8-27b-macos-64GB-mtplx-opencode.sh
combinations/qwen/3.8/27b/macos/128GB/mtplx-opencode/   -> install-qwen-3.8-27b-macos-128GB-mtplx-opencode.sh
combinations/qwen/3.8/flash-next/macos/64GB/mtplx-opencode/
```

---

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
bash -n install-<combination>.sh lib/*.sh lib/*/*.sh   # syntax
SKIP_SMOKE_TEST=1 ./install-<combination>.sh           # everything but the model load
./install-<combination>.sh                             # full run, asserts generation
<install-id>-server --help                             # profile table renders
<install-id>-<client> --server-only && <install-id>-<client> --status
<install-id>-<client> --stop
```

`SKIP_BACKEND_UPDATE=1` keeps the backend checkout you already have, which
makes iterating on config changes fast.

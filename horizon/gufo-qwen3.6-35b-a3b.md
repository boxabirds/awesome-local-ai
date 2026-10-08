# gufo fork: Qwen3.6-35B-A3B Q6dense (a new combination)

**Status:** candidate (6 Oct 2026) — **it builds.** `cmake --build --preset release` completes 95 of 95 with two
host-side fixes recorded below, and produces a 248 MB `gufo` binary that runs, has no missing libraries, and
whose `serve llm --help` confirms the model is in it ("Qwen3.6 uses its native MTP"). Built at `--parallel 2`
beside a live benchmark without disturbing it: memory ended at 16.1 GiB available and swap unmoved at 1,351 MiB,
exactly where it started, and the watchdog never fired. The owner has asked for the combination and a series on
the Strix Halo box once it is free.

**A source build reports no version, so it must be pinned by commit.** The binary says
`gufo version development (unknown)` — no release number and no hash. `lib/gufo.sh` refuses a mis-pinned image by
matching the engine's own version string against `GUFO_VERSION`; a source build gives it nothing to match. The
combination must record **the git commit it was built from** (`d7e938e`, 3 Oct 2026) in the install manifest and
check that instead.

The tool-call gate is **cleared**: the fork's merge base with upstream is `2026-10-02T11:08:42Z`, which is gufo
0.5.0 to the minute, so it carries PR #373 — the fix for our issue 304 — and its engine base is the *same
version this repository already pins* for the Flash-Next gufo runs. That is a much smaller confound than a fork
of unknown vintage.

What replaces it as the gate: **the fork publishes no runtime image.** It has no releases, no image-publishing
workflow of its own (upstream's image is built in the separate `gufo-org/toolboxes` repository), and its own
quickstart points at upstream's `gufo-runtime:latest`, which does not contain this model. Every gufo run here
uses a digest-pinned image and builds nothing on the host (`GPU_API="none"`). This combination cannot.

**Kind:** a new combination, not an engine bump. The model, the quantisation and the engine build all differ
from `qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi`, so nothing about it is a variable change to an
existing stack. Proposed path `combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-q6dense-pi` — the
quant belongs in the combination, as with `llamacpp-iq3xxs-pi`; the name is not settled.

## What it is

[NinjaPear/gufo-Qwen3.6-35B-A3B-Q6dense](https://github.com/NinjaPear/gufo-Qwen3.6-35B-A3B-Q6dense) is a fork of
the gufo engine that adds support for Qwen 3.6 35B-A3B. It is an engine fork, not a weights repository: the
weights are [ligamentexceed/Qwen3.6-35B-A3B-Q6dense-GGUF](https://huggingface.co/ligamentexceed/Qwen3.6-35B-A3B-Q6dense-GGUF).

**Read the author's own description of it before anything else** (the repository's description field, verbatim):

> "This is a fork of gufo to support Qwen 3.6 35B A3B for workloads that prioritizes speed over intelligence."

The person who built it says it trades intelligence for speed. That is a claim about this stack from the one
party who has run it most, and it is the hypothesis our pack would test rather than a reason not to test it —
but any result should be read next to it, and a poor score would be the author's own expectation, not a
surprise.

**What the fork actually changes.** Two commits ahead of upstream, forty behind, "diverged" (GitHub compare,
6 Oct 2026). The two commits are not branding: they add `src/models/qwen36_35b_a3b/` — config, engine, weights,
CPU ops, ROCm/HIP kernels including a `gfx1151` MoE wave64 path and a vendored `mmq` quantised-matmul set, MTP
cost/policy/sampling headers — with fourteen test files under `tests/models/qwen36_35b_a3b/` and a
`llama_parity.py`. It is a substantial piece of kernel work by one author, with its own tests.

**"Q6dense" does not mean the model is dense.** It is still a mixture of experts, and the card says the routing
is retained. The suffix names which half of the weights got Q6:

| Weights | Quantisation, as the card states it |
|---|---|
| Trunk **dense** weights: attention, DeltaNet, shared expert, output head | Q6_K |
| Routed experts | Unsloth UD-Q4_K_XL (gate/up Q4_K, down Q5_K; a few layers Q5_K/Q6_K) |

So it reads as "Q6 on the dense part", not "a dense model". 36B parameters, 22,388,168,960 bytes (~22.4 GB) by
the card, and it includes the model's native MTP (multi-token prediction) block.

The fork's own published figures, on its own hardware and not measured by us: "3000 tok/s prefill; 120 tok/s
decode" in its title, and a table reading 3,095.44 tok/s prefill and up to 190.67 tok/s decode for a single
user. **These are not the reason to run it.** Throughput is not what this benchmark ranks, and a figure from
someone else's machine settles nothing about held-out tests passed.

## Why it is interesting

3B active parameters. Every local combination benchmarked so far carries far more weight per token, and the open
question this stack would answer is not how fast it is but whether a model this sparse can do multi-hour agentic
coding work at all — whether it holds a contract across a compaction, reads a specification rather than
recalling it, and lands a story. If it scores respectably, the cost of a useful local coding agent falls a long
way. If it does not, that is worth knowing with the same evidence.

Qwen 3.6 35B-A3B has **never been benchmarked in this repository**. One combination exists for it,
`combinations/qwen/3.6/35b-a3b/ubuntu/nvidia3090/sglang-opencode`, and it has no runs: no `metrics.json` under
it and nothing in the warehouse (checked 6 Oct 2026). It also uses the OpenCode client, so even if it had runs
they would not compare with the vidi `pi` series.

## Where it could run

The Strix Halo box. The fork targets exactly that hardware — its README describes gufo as built for "the AMD
Strix Halo hardware: Ryzen AI MAX+ 395 systems with Radeon 8060S (`gfx1151`), up to 128 GiB of unified memory" —
and it is the only machine here that runs gufo at all. 22.4 GB of weights is no constraint on 128 GB.

It would be compared with the gufo Flash-Next series (`v2-gufo05-r1`…`-r5`) on the same machine and pack, with
the confounds below stated every time.

## Checks before a run

1. ~~**What is the fork's base version, and does it carry the tool-call fix?**~~ **Done, 6 Oct 2026.** The merge
   base with `gufo-org/gufo` is `2026-10-02T11:08:42Z` — gufo 0.5.0, which closed our issue 304 (PR #373), and
   the version this repository already pins. The fix is in.
2. **It has to be built from source, on the Strix Halo box.** No image exists (above). Nothing in this
   repository builds an engine from source on a host — every combination either pulls an image or installs a
   released binary — so this needs a new install path, not just a `config.sh`.

   **Progress, 6 Oct 2026, while `v2-gufo05-r5` was still running** (all of it read-only or additive, none of it
   touching the live run):

   - Cloned and pinned at `d7e938e` (3 Oct 2026, the fork's HEAD) in `~/build/gufo-q36` on the machine.
   - `cmake --preset release` **fails**, on `find_package(ICU)`. Configure cost 42 MiB of memory, so the
     preparation is free; it is the compile that needs care.
   - The machine has cmake, ninja, g++ 15.2.0 and Ubuntu's `hipcc` (HIP 7.1.52801, clang 21.1.8). It has **no
     `/opt/rocm` and no AMD ROCm repository**: the HIP tooling is Ubuntu's own packaging. The fork says its
     "currently qualified toolchain is GCC 15.3 and ROCm 7.2.3", so both are a little below what it qualifies.
   - **Eleven development packages are missing**, including every ROCm one. AMD's names (`hipblas-dev` etc.) are
     not in the machine's sources, but Ubuntu 26.04 ships all of them as `lib…-dev`, so no third-party
     repository is needed:

     ```sh
     sudo apt install --no-install-recommends pkg-config libicu-dev libpng-dev libjpeg-dev libwebp-dev \
       ffmpeg libhipblas-dev libhipblaslt-dev librocblas-dev libhipcub-dev librocprim-dev librocwmma-dev
     ```

     `apt-get install -s` for exactly that set: **107 new packages, 0 removals, 0 upgrades, and nothing matching
     amdgpu, dkms, linux-image, linux-modules, mesa or libdrm.** Purely additive, so it cannot disturb a gufo
     container that is mid-run. Disk is no constraint (1.6 TB free).
   - It needs `sudo`, which on this machine asks for a password, so **the install is the owner's to run.** That,
     and not the machine being busy, is what blocks the build.

   **The twelfth package is broken, and the fix needs no root.** With all twelve installed, `cmake --preset
   release` succeeds (OpenMP 4.5 found) and the compile runs to 145 of 254 before failing — **not in the Qwen3.6
   code, which built, including its gfx1151 MoE wave64 kernels**, but in `deepseek_v4_flash`, on:

   ```
   /usr/include/rocwmma/rocwmma.hpp:29: fatal error: 'internal/accessors.hpp' file not found
   ```

   Ubuntu 26.04's `librocwmma-dev` ships five headers and **omits the entire `internal/` directory** that
   `rocwmma.hpp` includes on its first line, so the package cannot compile anything. rocWMMA is used only by
   DeepSeek V4 Flash — `grep -rl rocwmma src/` hits that model alone — but `CMakeLists.txt` adds it
   unconditionally under `ENGINE_ENABLE_HIP`, so it cannot simply be skipped.

   rocWMMA is header-only, so the fix is to put a complete tree ahead of `/usr/include`, with no root and no
   patch to the fork:

   ```sh
   git clone --depth 1 --branch rocm-7.1.0 https://github.com/ROCm/rocWMMA.git ~/build/rocWMMA
   mkdir -p ~/build/rocwmma-include/rocwmma
   cp -r ~/build/rocWMMA/library/include/rocwmma/. ~/build/rocwmma-include/rocwmma/
   cp /usr/include/rocwmma/rocwmma-version.hpp ~/build/rocwmma-include/rocwmma/   # generated, not in the source
   export CPATH="$HOME/build/rocwmma-include${CPATH:+:$CPATH}"
   ```

   The source tree holds exactly Ubuntu's four headers plus `internal/`; the version header is the one piece
   Ubuntu generates, which is why it is copied across rather than taken from the clone. `~/build/q36-build.sh`
   on the machine does this and carries the memory watchdog below.

   **Then it links against the wrong libstdc++.** With rocWMMA fixed, all 109 of 110 objects compile and the
   final link fails:

   ```
   ld.bfd: libgufo_core.a(prompt_encoder.hip.o): undefined reference to
     `std::__detail::__notify_impl(void const*, bool, std::__detail::__wait_args_base const&)'
   ```

   The machine has **both GCC 15 and GCC 16**. `g++` is 15.2.0, so CMake's C++ compiler, and the link line
   (`-L/usr/lib/gcc/x86_64-linux-gnu/15`, same `-rpath`), are GCC 15. But clang — which compiles the HIP objects
   — takes the *newest* GCC it finds for its libstdc++, so the `.hip.o` files were built against GCC **16**'s
   headers (`include/c++/16/bits/atomic_wait.h` is in the error path). `std::__detail::__notify_impl` is a GCC 16
   symbol that the 15 runtime does not export.

   Pin clang to the same GCC as everything else, which is also the one the fork qualifies:

   ```sh
   cmake --preset release -DCMAKE_INSTALL_PREFIX="$HOME/.local" \
     -DCMAKE_HIP_FLAGS="--gcc-install-dir=/usr/lib/gcc/x86_64-linux-gnu/15"
   ```

   The presets set no HIP flags of their own, so this is additive; it does force every HIP object to rebuild.

   **The compile is the part to pace.** The fork's own instruction is `--parallel 4`, not a full-width build.
   With a run live the machine had 14.7 GiB available of 122 and 1.35 GB of swap already in use, while the
   harness's machine guard stops a story below 8% free (about 9.8 GiB) or after 4 GB of swap growth. So a
   full-width build must not be run beside a story; `--parallel 2` with a watch on `available` is the way to do
   it during one, and a free machine makes the question moot.
3. **Licences.** Qwen 3.6's own terms, and the weights'. The fork states MIT for the original gufo code and says
   model weights retain their publishers' terms without naming them. Not checked.
4. **The engine answers, with tools.** The short check from the smoke-run rule: the server starts, answers a
   request, returns a structured tool call, reuses a prompt. Ten minutes, not a story.
5. **A tool call with raw newlines**, specifically. Upstream kept finding tool-call defects *after* 0.5.0, and
   the fork has none of those fixes: of the forty commits it is behind, at least six are server tool-call fixes
   (`#393` parse tool output using the admitted request format, `#396` JSON string ownership during tool
   recovery, `#397` end DeepSeek tool output after the call block, `#400` keep tool-call framing out of
   assistant content, `#404` reuse replayed tool turns with union and typed arguments, `#441` keep tool calls in
   native model syntax) and about five more are cache fixes. Our own `toolcall_text_resumes` signature is the
   thing to watch, and a clean smoke story does not clear it — the defect bites on particular tool payloads.
6. **Context.** Nothing read so far states a context limit for this build; its own docs say it "uses the
   model's native context by default" with `--context N` per session. The pack needs 128k; confirm it before a
   series, because a short window invalidates the comparison rather than losing a story.
7. Then one unrecorded partial rerun of a story that exercises the pattern, as [gufo 0.5](gufo-0.5.md) did, and
   only then a recorded series.

## Confounds

Four things differ at once from the gufo Flash-Next runs, which is why this is a combination and not a variant:

- **The model**: Qwen 3.6, not 3.8 — an older generation, and 35B total against Flash-Next's 125B.
- **Active parameters**: 3B active against Flash-Next's.
- **The quantisation**: mixed Q6_K trunk with 4-bit routed experts, against the 4-bit Flash-Next pack.
- **The engine**: the same 0.5.0 base, but built from source rather than the pinned image, and without the
  forty commits upstream has added since — including six tool-call fixes and about five cache fixes.

MTP is also on by the fork's own description ("Q6dense with native MTP"), which moves timing on its own.

A result here therefore says something about *this stack*, and nothing on its own about Qwen 3.6, about sparse
MoE in general, or about the fork's engine work. Reading it as any of those would be the mistake.

**Last checked:** 6 Oct 2026 (the fork's README and repository metadata, the GitHub compare against upstream,
its weights card, and this repository's own combinations and warehouse). **Recheck when:** a from-source build
is attempted on the Strix Halo box — which moves this to candidate (it built, with a version string) or to
blocked (it did not, with the error).

## Why this series stops at three runs, not five

The owner's rule of thumb (8 Oct 2026): five runs per stack are for when the spread across three is wide enough that three
would not separate it from another stack. Here it is not wide. The scores of record, `scores[vidi-v2.0-pre2].passed` of 75:

| Run | Score of record |
|---|---|
| `v2-q36fork-b-r1` | 1 |
| `v2-q36fork-b-r2` | 0 |
| `v2-q36fork-b-r3` | running; story 3 scored 0 of 7 on the live score |

Two finished runs differ by one test out of 75, and the third is tracking the same way. Two more runs would not move the
fork any closer to the other stacks, whose scores are in the 60s and 70s. `r4` and `r5` were cancelled (queued, never
started) on 8 Oct.

**What this does not show.** A narrow spread at the floor says the result is stable. It does not say why it is at the
floor: a model that cannot do the work and an engine or harness fault that stops it from being tested would both look
like this. **Recheck when:** `r3` finishes. If its score of record is outside 0 to 2, the argument for stopping at three
no longer holds and the series should be extended.

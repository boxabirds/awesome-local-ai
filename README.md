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
./install.sh --no-web-testing   # skip the browsers for web testing
```

Coding agents test web apps in a real browser, so every install also sets up
Playwright's Chromium, on by default. It goes where Playwright looks for it
(`~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright` on Linux),
the same place whichever combination you install. Browsers you already have
there, or under `PLAYWRIGHT_BROWSERS_PATH`, are reused rather than downloaded
again, and the install launches Chromium once to prove it works.

`start.sh` reads the manifests the installer left behind, so it runs whatever
this machine actually has — no arguments needed for the common case, and a
clear prompt to choose when more than one combination is installed. (`run.sh`
is kept as an alias.)

The repo has two halves. The installers above give you a working setup. The
[benchmark](#benchmarks-how-well-does-a-setup-build-real-software) measures how
well each setup builds real software: a coding agent implements a full spec
story by story, and a held-out test suite it never sees scores the result. The
[machines and tools](#the-bench-machines-and-their-tools) section covers how runs
are driven across several machines and how their energy is measured, and
[horizon/](#horizon-what-we-might-try-next) tracks the engines and models we
might add next, and the ones ruled out. If you have a DGX Spark, an RTX 3090 or a
Gorgon Halo machine, see [Contributing](#contributing).

---

## Combinations

Pick the row that matches your hardware and run its script from the repo root.
The installer refuses to run on hardware it was not measured on, rather than
half-installing.

| Model | OS | Memory | Stack | Context | Install | Details |
|---|---|---|---|---|---|---|
| Qwen3.8-27B | Ubuntu 22.04 | RTX 4090 (24GB) | llama.cpp + pi | 128k | [`install-qwen-3.8-27b-ubuntu-nvidia4090-llamacpp-pi.sh`](install-qwen-3.8-27b-ubuntu-nvidia4090-llamacpp-pi.sh) | [README](combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/README.md) |
| Swift 1.0 Qwen3.8-27B | Ubuntu 22.04 | RTX 4090 (24GB) | llama.cpp + pi | 128k | [`install-qwen-3.8-swift-27b-ubuntu-nvidia4090-llamacpp-pi.sh`](install-qwen-3.8-swift-27b-ubuntu-nvidia4090-llamacpp-pi.sh) | [README](combinations/qwen/3.8-swift/27b/ubuntu/nvidia4090/llamacpp-pi/README.md) |
| Swift 1.5 Qwen3.8-27B | Ubuntu 22.04 | RTX 4090 (24GB) | llama.cpp + pi | 128k | [`install-qwen-3.8-swift-1.5-27b-ubuntu-nvidia4090-llamacpp-pi.sh`](install-qwen-3.8-swift-1.5-27b-ubuntu-nvidia4090-llamacpp-pi.sh) | [README](combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/README.md) |
| Qwen3.8-27B | macOS 26 | 64GB Apple silicon ¹ | MTPLX + OpenCode | 128k | [`install-qwen-3.8-27b-macos-64GB-mtplx-opencode.sh`](install-qwen-3.8-27b-macos-64GB-mtplx-opencode.sh) | [README](combinations/qwen/3.8/27b/macos/64GB/mtplx-opencode/README.md) |
| Qwen3.8-Flash-Next ⁵ | macOS 26 | 128GB Apple silicon | MTPLX + pi | 128k | [`install-qwen-3.8-flash-next-macos-128GB-mtplx-pi.sh`](install-qwen-3.8-flash-next-macos-128GB-mtplx-pi.sh) | [README](combinations/qwen/3.8/flash-next/macos/128GB/mtplx-pi/README.md) |
| Qwen3.8-Flash-Next mixed 4/8-bit ⁶ | macOS 26.2+ | 128GB Apple silicon | mlx-serve + pi | 128k | [`install-qwen-3.8-flash-next-macos-128GB-mlxserve-pi.sh`](install-qwen-3.8-flash-next-macos-128GB-mlxserve-pi.sh) | [README](combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi/README.md) |
| Qwen3.8-Flash-Next UD-IQ4_XS ¹⁰ | macOS 26 | 128GB Apple silicon | llama.cpp *(MTP branch, Metal)* + pi | 128k | [`install-qwen-3.8-flash-next-macos-128GB-llamacpp-pi.sh`](install-qwen-3.8-flash-next-macos-128GB-llamacpp-pi.sh) | [README](combinations/qwen/3.8/flash-next/macos/128GB/llamacpp-pi/README.md) |
| Qwen3.8-Flash-Next ⁷ | Ubuntu 26.04 | Strix Halo 128GB (Ryzen AI Max+ 395) | llama.cpp *(MTP PR; Vulkan or ROCm)* + pi | 128k | [`install-qwen-3.8-flash-next-ubuntu-strix-halo-128GB-llamacpp-pi.sh`](install-qwen-3.8-flash-next-ubuntu-strix-halo-128GB-llamacpp-pi.sh) | [README](combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi/README.md) |
| Qwen3.8-Flash-Next UD-Q4_K_XL ⁸ | Ubuntu 26.04 | Strix Halo 128GB (Ryzen AI Max+ 395) | gufo *(Podman, ROCm in the image)* + pi | 128k | [`install-qwen-3.8-flash-next-ubuntu-strix-halo-128GB-gufo-pi.sh`](install-qwen-3.8-flash-next-ubuntu-strix-halo-128GB-gufo-pi.sh) | [README](combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/README.md) |
| Ternary Bonsai 2 27B ² | Ubuntu 22.04 | RTX 4090 (24GB) | llama.cpp *(fork)* + OpenCode | 128k | [`install-bonsai-2-27b-ubuntu-nvidia4090-llamacpp-opencode.sh`](install-bonsai-2-27b-ubuntu-nvidia4090-llamacpp-opencode.sh) | [README](combinations/bonsai/2/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md) |
| MiMo-V2.6-Qwen-9B ³ | macOS 26 | 16GB Apple silicon, M3+ ⁴ | MTPLX + OpenCode | **20k**: too small for agentic coding ([tested](docs/20260924-mimo-9b-m2-16gb.md)) | [`install-mimo-2.6-9b-macos-16GB-mtplx-opencode.sh`](install-mimo-2.6-9b-macos-16GB-mtplx-opencode.sh) | [README](combinations/mimo/2.6/9b/macos/16GB/mtplx-opencode/README.md) |
| Qwen3.8-27B EXL3 3.0bpw ⁹ | Ubuntu (Docker) | RTX 3090 (24GB, sm_86) | SGLang *(container)* + OpenCode | 262k | [`install-qwen-3.8-27b-ubuntu-nvidia3090-sglang-opencode.sh`](install-qwen-3.8-27b-ubuntu-nvidia3090-sglang-opencode.sh) | [README](combinations/qwen/3.8/27b/ubuntu/nvidia3090/sglang-opencode/README.md) |
| Qwen3.6-35B-A3B EXL3 3.0bpw ⁹ | Ubuntu (Docker) | RTX 3090 (24GB, sm_86) | SGLang *(container)* + OpenCode | 262k | [`install-qwen-3.6-35b-a3b-ubuntu-nvidia3090-sglang-opencode.sh`](install-qwen-3.6-35b-a3b-ubuntu-nvidia3090-sglang-opencode.sh) | [README](combinations/qwen/3.6/35b-a3b/ubuntu/nvidia3090/sglang-opencode/README.md) |

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
the MiMo row is fundamentally unworkable** ([report](docs/20260924-mimo-9b-m2-16gb.md)). The context window
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

⁵ **Not recommended at present (27 Sep 2026).** MTPLX 2.12.0 refuses or overruns memory at the
agent's context compaction in long sessions: repeated Mac freezes, and stories that collapse after
refused compactions. See the [combination README](combinations/qwen/3.8/flash-next/macos/128GB/mtplx-pi/README.md).
On this Mac, use llama.cpp + pi (`combinations/qwen/3.8/flash-next/macos/128GB/llamacpp-pi`).

⁴ **Chip generation, not just memory.** MTPLX offers MiMo V2.6 Qwen 9B (a
coding/agent fine-tune by Xiaomi MiMo, BF16 vision tower and draft head) on
M3/M4/M5 only; it runs on M1/M2 but without native BF16, and the slowdown is
unmeasured. `./install.sh` never picks it by default; name it:
`./install.sh mimo`.

⁹ **The two SGLang rows are unmeasured by this repo.** They transcribe a
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
is the only Strix Halo row `./install.sh` picks by itself (⁸ opts out).

⁸ **The gufo row serves the same model with [gufo](https://github.com/gufo-org/gufo)**,
a single-model engine for this chip, from its container image (Podman; the
image brings its own ROCm). Measured on the same Minisforum box with the same
UD-Q4_K_XL weights, it reads prompts 4–7× faster than the llama.cpp row
(1,266 vs 302 tok/s at 32k, 1,228 vs 172 at 120k), which is what caps the
llama.cpp row's agent runs. Whether its code is as good is what its benchmark
runs measure. It never installs unasked: `./install.sh` lists it but does not
pick it.

¹⁰ **The macOS llama.cpp row is the Strix Halo llama.cpp stack moved to Apple
silicon**: the same branch, commit, weights, MTP settings and context, with Metal
instead of Vulkan, so llama.cpp and the Mac's MLX engines can be compared on one
machine. Not measured yet: its one benchmark run is paused after story 1. It is
the row footnote ⁵ recommends over MTPLX.

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
  weights, and [too small for agentic coding](docs/20260924-mimo-9b-m2-16gb.md)), 262k on the SGLang rows (the
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

**Swift 1.0 Qwen3.8-27B — Ubuntu 22.04 / RTX 4090 (24GB):**

- **The fast-of-the-two on identical hardware.** Measured against the baseline
  above on the same 4090, same binary and prompts: 1.37–1.51× faster end-to-end
  across the low/medium/xhigh sweep, with 23–39% fewer reasoning chars
  ([A/B report](docs/20260921-swift-qwen38-27b-ab.md)). A retrained Qwen3.8-27B
  that thinks less, so routine agent turns come back sooner.
- **MTP head baked into the weights.** Swift's draft head is Q8_0 inside the
  GGUF (no separate 1.57 GiB sidecar, no `-md`), measured at
  `--spec-draft-n-max 3` and now run at 4 (the mean accepted draft ran above 3)
  — which also leaves ~1.5 GiB more room for context than the baseline.
- **The cut is deliberation, not capability.** The A/B measures speed and token
  count, not answer quality — the report says so, and it is the honest limit of
  this comparison.

**Swift 1.5 Qwen3.8-27B — Ubuntu 22.04 / RTX 4090 (24GB):**

- **UkisAI's second retrain, a different model from 1.0**, served exactly like
  1.0 so the two compare directly. The vendor claims it is stronger on coding
  and agentic work; this repo has not measured that yet.
- **Same layout, lighter file:** the same MTP head position as 1.0, but its
  projection is Q4_0 rather than Q8_0, and the file is 0.54 GiB smaller. The
  install measured draft acceptance 0.80 on its smoke prompt; real-session
  acceptance is not measured yet.

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

## Benchmarks: how well does a setup build real software?

Tokens per second say little on their own: a fast setup that writes broken code is not a good
setup. The spec benchmark ([benchmarks/spec-bench/](benchmarks/spec-bench/)) measures what a
setup actually produces. A coding agent (pi or OpenCode, on one combination) implements a real
specification one story at a time, each story with a PRD, a technical design and ordered tasks,
and every story is recorded: time, model calls, tokens, commits and the agent's own tests.

**New here? Start with the [guide to how the benchmark works](benchmarks/docs/guide/index.html).** It is an interactive
walkthrough of the concepts, the entities and how they relate, the components, and the key flows from submitting a job
to a number on a page, with the findings from analysing every recorded conversation attached as concrete examples. It is
a single HTML page: open the file in a browser after cloning (GitHub shows HTML files as source, not as a page).

**Spec packs:**

| Pack | What it builds | Spec | Held-out suite |
|---|---|---|---|
| [Vidi](benchmarks/vidi/) | a Miro-style collaborative whiteboard: 17 stories; the `canvas` scope builds 11 (pan and zoom, sticky notes, live sync, saving, share links, selection, undo, text, shapes and arrows, pen, images) | public | private |
| [Todoodle](benchmarks/todoodle/) | a to-do app with link-based workspaces, tasks and projects: 11 stories | public | private |

Specs are public. Held-out suites live in a private repo (`awesome-local-ai-bench-private`): they are
what protects the scores from contamination, since a model that has seen the spec still has to pass
tests it has never seen. They also stay out of the agent's reach: the harness's sandbox hides it while the agent
works. Everything else is public: the harness, the run records, the code each run wrote, and the
scores. To run a pack on your own hardware, ask the repo owner for access.

**Three stages, each owned by someone different:**

| Stage | Who | What happens | Output |
|---|---|---|---|
| **Build** | the agent, on a bench machine | story by story: work, run the agent's own gate tests, commit; the harness guards the machine (below) | the run record under `combinations/<combination>/benchmarks/<pack>/<run>/`, including every story's code |
| **Score** | the held-out suite | after the run, the app as it was after each story is tested with a pinned suite version (`rescore.py`), in parallel within the host's limits; failing checks run three times and the majority counts | per-story pass/fail, regressions, repairs and flaky tests in the run's `rescore/<suite-version>/` |
| **Judge** | a person | watches a recording of each test and marks whether the app did what the path describes; compared with the suite's verdicts, this gives a confusion matrix that shows where the suite is too strict or too lenient | verdicts in the private repo |

Scoring is automatic and repeatable; judging validates the scoring. The review page for judging
is in [tools/vidi-gallery/](tools/vidi-gallery/) (to be generalised to every pack). Separately,
[blinded AI graders](benchmarks/spec-bench/harness/judge.md) can compare two builds' code quality
without knowing which setup made which.

**The rules** are in [EVALUATION-POLICY.md](benchmarks/spec-bench/EVALUATION-POLICY.md): every
held-out test checks something the spec states; a failure counts against the agent only if it could
have found it with what it had; the agent gets no feedback from the held-out tests; a setup step
that fails on an undocumented alternate flow falls back to the documented one and is counted once;
specs carry no operational requirements such as rate limits. Every field a run records is in
[TELEMETRY.md](benchmarks/spec-bench/TELEMETRY.md).

**Versions.** A result names its spec version, its held-out suite version and the harness commit,
and results are compared only within one version. Vidi is moving from v1.3 to v2: the v2 spec is in
use for new builds, and every stack is being rebuilt on it.

**Reference stacks.** The same packs run with a frontier model (Opus 5.5 through Claude Code) under
[benchmarks/reference/](benchmarks/reference/), as the yardstick for local setups.

**Protecting the machine.** A run shares its machine with the model server. The harness stops a
story if memory runs short, makes the agent's processes the kernel's first choice if memory runs out,
and on Linux runs the agent in its own cgroup so that nothing it starts can outlive it: a cut-off
tool call loses what it started, and each story ends with the scope emptied
([tools/agent-containment/](tools/agent-containment/PROPOSAL.md)). One story can also be run on
its own from another run's code (a "partial rerun"), as a separately labelled diagnostic.

---

## The bench machines and their tools

| Hardware | Runs |
|---|---|
| Minisforum MS-S1 MAX: Strix Halo (Ryzen AI Max+ 395), 128 GB, Ubuntu | llama.cpp (Vulkan) and gufo, Qwen3.8 Flash-Next |
| i9-13900F, 64 GB, RTX 4090 (24 GB), Ubuntu, and Windows 11 on the same disk | llama.cpp (CUDA): Qwen3.8 27B, Swift 1.0 and 1.5; Windows-only engines |
| Apple M5 Max, 128 GB, macOS | mlx-serve and llama.cpp (Metal), Qwen3.8 Flash-Next |

- **[tools/dbench/](tools/dbench/)** runs benchmark jobs on any number of machines, driven from any
  machine: `dbench serve` on each box keeps a queue, restarts and recovers after a reboot; the client
  submits, watches, cancels and reads events. Results arrive through git. Design:
  [docs/20260924-distributed-bench-design.md](docs/20260924-distributed-bench-design.md).
- **[tools/benchmarker/](tools/benchmarker/)** is one page with the live status of every run: where it is
  in build, score and judge, from dbench and the pushed run records, with links to each record, its
  scores and the review page. A small React app; runs anywhere with a clone and Node 24.
- **[tools/power-collector/](tools/power-collector/)** records each machine's power every 2 seconds
  (a Tapo energy-monitoring plug at the wall, the Mac's own telemetry, NVIDIA board power, Apple
  Silicon die temperatures) so energy can be tied to a story or a single model request.
- **[tools/windows-bench-host/](tools/windows-bench-host/)** turns a Windows PC with an NVIDIA GPU
  (a gaming PC is fine) into a bench machine in one script: Tailscale, an SSH server, WSL2 for the
  Linux harness, and firewall rules that admit only Tailscale addresses.
- **[tools/vidi-gallery/](tools/vidi-gallery/)** shows every build's scores, judging and cost on one
  page, opens any build in its own window, and hosts the story-by-story review with a player for
  each test's recording.
- **[tools/agent-containment/](tools/agent-containment/PROPOSAL.md)**: why and how the harness keeps
  every process the agent starts in a cgroup it owns.
- **[benchmarks/gufo-eval/](benchmarks/gufo-eval/)** captures a real agent session's requests and
  replays them against an engine, for engine comparisons without a full run.

---

## Horizon: what we might try next

[horizon/](horizon/) has one note per engine, model or setting we have looked at and not (yet) turned
into a combination: what it is, where it would run, its status (candidate, gated, blocked, queued,
parked, eliminated) with the reason, the checks it must pass before a run, what would confound a
comparison, and when to look again. Blocked and eliminated ones stay there with their reasons (a
known bug, a machine it can't fit), so nothing is tried twice for a reason already known. It is
re-read periodically against each note's "recheck when".

---

## Contributing

### Wanted: results on hardware we don't have

The bench machines are an RTX 4090, a Strix Halo and an M5 Max. These are the gaps we most want filled:

- **NVIDIA DGX Spark.** A different memory design from anything here: 128 GB shared between CPU and GPU.
- **RTX 3090.** The most common 24 GB card for local models. The two SGLang rows above were written for
  it from someone else's recipe and have never been run through these installers; a 3090 owner can turn
  them into measured rows, and run the Qwen3.8-27B llama.cpp rows for comparison with the 4090.
- **AMD Gorgon Halo (the 495 series) builds**, running the stacks our Strix Halo (Ryzen AI Max+ 395)
  box runs (llama.cpp with Vulkan or ROCm, gufo), so the two generations can be compared on the same
  models.

Anything else with a combination worth measuring is welcome too; [horizon/](horizon/) lists engines and
models we would like to see tried.

### Ways to contribute

1. **Add a combination**: a model, machine and stack that installs and serves correctly.
   [docs/adding-a-combination.md](docs/adding-a-combination.md) is the contract; one that reuses the
   existing adapters is four files and no shell logic. Every number in it must be measured, or say
   that it isn't.
2. **Run the benchmark on your hardware.** Ask the repo owner (Julian Harris) for access to the private
   repo with the held-out suites, clone it next to this one, run `setup-node.sh`, then `run.sh` or
   dbench. Your run records (story by story, with the code the agent wrote) come back as a pull request
   under your combination's `benchmarks/` folder. Three runs per stack, so run-to-run spread is visible.
3. **Judge.** Watch the recordings of held-out tests and mark whether each scored pass or fail was
   right. That is what tells us how far the scores can be trusted.
4. **Suggest or rule out.** A note in [horizon/](horizon/) for an engine or model worth trying, or
   evidence that one should be blocked. Bugs in other projects that we hit are drafted in
   [issues/external/](issues/external/).

### Why there is a held-out suite

A coding agent builds the app from the spec, and its own tests pass because it wrote them. A score
needs tests the agent has never seen: the held-out suite checks, in a real browser, that each story
does what the spec says. It also protects the scores from contamination. A model that has read the
spec (it is public, and in the agent's prompt anyway) still has to build an app that passes tests it
has never seen. So the suites live in a private repo, the harness's sandbox hides them from the agent,
and no result feeds anything from them back to the agent.

People with access can read the tests, so a few rules keep results honest:

- **Configurations are public** and contain **no task-specific instructions**: nothing in a
  combination's settings, prompts or client configuration may name a pack or its features. A general
  coding-agent setup is fine.
- **Settings are fixed before the scored runs.** Try settings on anything but the held-out suite (the
  agent's own tests, short smoke runs); then declare them and do three runs. A stack's result is its
  runs together, not its best one.
- **Every scored run is kept**, including the ones that did badly, so a result can be read with the
  number of attempts behind it.
- **Don't copy held-out tests** or anything derived from them into public places, issues or prompts.
- Suites are **rotated**: a new version from time to time, and results are compared within a version.

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
  spec-bench/                 the spec benchmark: harness, evaluation policy, telemetry
  vidi/  todoodle/            spec packs (held-out parts in the private repo)
  reference/                  the same packs run with a frontier model
tools/dbench/                 runs those harnesses on remote machines (server + client, Rust)
tools/benchmarker/            live status of every run: build, score, judge
tools/power-collector/        power and temperature every 2 s, per machine
tools/vidi-gallery/           scores, judging and the review page for every build
tools/windows-bench-host/     one-time setup for a Windows GPU PC as a bench machine
tools/agent-containment/      why the agent runs in a cgroup the harness owns
horizon/                      engines and models we might try, and the ones ruled out
issues/external/              bug reports for other projects, drafted before filing
tests/                        the checks that need no hardware
docs/                         measurements, methodology, contributor guide
samples/                      things models built here, kept as worked examples
```

The point of the split is that **nothing is duplicated between combinations**.
A combination is data — a config file, a table of measured profiles, and its
help text. Adding one does not add shell code:

```
install-qwen-3.8-27b-ubuntu-nvidia4090-llamacpp-pi.sh   ← 8 lines
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
- **The benchmark, the machines and horizon** have their own sections above;
  [EVALUATION-POLICY.md](benchmarks/spec-bench/EVALUATION-POLICY.md) and
  [TELEMETRY.md](benchmarks/spec-bench/TELEMETRY.md) are the rules and the record format.
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

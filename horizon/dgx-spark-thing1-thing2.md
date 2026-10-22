# DGX Sparks thing1 and thing2 (hardware)

**Status:** new hardware (22 Oct 2026). Per the owner: two nodes, both 128 GB, reachable over ssh (thing1 now, thing2 "in a few hours"). Not yet benchmark nodes: whether either runs `dbench serve`, has an install, or has the link configured is **not checked**, and I have not logged in to either.
**What it is:** two NVIDIA DGX Spark units, named thing1 and thing2, joined by the Spark's ConnectX-7 link ("the special connector"). Earlier notes counted them as "one or two Sparks, if bought" ([concurrency](concurrency.md)) or "two, owner's" ([DeepSeek V4.1-Flash-1017 VQ](deepseek-v4.1-flash-1017-vq.md)); this note is the one place for what the hardware changes.

## What a Spark is, and what that means for candidates

From NVIDIA's pages as summarised in `benchmarks/inference-server-concurrency/dgx-spark.md` (read 11 Oct 2026; advertised, not measured by us):

- 128 GB LPDDR5x unified memory, 273 GB/s: the memory class of the Strix Halo box, so single-stream decode of a big MoE should be in the same class. The difference is NVIDIA compute and the CUDA stack.
- GB10, **Arm (aarch64) CPU with a Blackwell GPU (sm_121)**. Anything x86-only or built for sm_75-sm_120 does not run as shipped. This is the first filter for every candidate below: [Strata's NVFP4 fork](strata.md) lists x86-64 and up to sm_120 only.
- ConnectX-7 with two QSFP ports. NVIDIA's multi-node playbook runs vLLM in a container on both units. A third party measured the 200 Gb/s link at about 111 GB/s in practice (single source). Linked, the pair **fits bigger models; it is not measured to be faster** (NVIDIA's own two-Spark Qwen3 235B figure is 11.7 tok/s decode).
- Usable memory is less than 128 GB per unit once the OS, the agent, browsers and test servers are counted; a Spark can freeze when memory runs out (Mia's recipe says so).

## Two ways to use the pair, which are different experiments

1. **Two independent nodes**, one combination each (or the same combination twice for runs in parallel). No interconnect involved; doubles throughput of a series. This is how every single-unit candidate is read.
2. **One linked node (tensor parallel, TP=2)** for a model that does not fit in 128 GB. Only [Mia's DeepSeek-V4.1-Flash-1017 recipe](deepseek-v4.1-flash-1017-two-sparks-mia.md) and NVIDIA's vLLM playbook were found; SGLang on two Sparks had one forum report of a crash and no confirmed recipe.

The two are not interchangeable: results from a linked node are not comparable with a single unit's, and the link adds a network confound.

## Candidates this hardware could carry

| Candidate | Single unit | Linked pair |
|---|---|---|
| [Ornith 1.5 122B](ornith-1.5-122b.md) | EXL3 4-bit on TensorFold (about 69 GiB), or other formats | not needed |
| [Flint](flint.md) | SGLang lists DGX Spark; about 24 GB | not needed |
| [DeepSeek on two Sparks (Mia)](deepseek-v4.1-flash-1017-two-sparks-mia.md) | no | 2.9 bpw EXL3 (196 GiB), TP=2 |
| [DeepSeek V4.1-Flash-1017 VQ](deepseek-v4.1-flash-1017-vq.md) | one unit, 1.6-bit | no |
| [Strata + IQ3_S](strata.md) | unchecked on aarch64 | no |
| [Inco Splash](inco-splash.md) | no (Apple silicon only) | no |
| [Concurrency](concurrency.md) | two independent servers | n/a |

## Before any Spark is a node

1. `dbench serve` installed and running as a service (an aarch64 build of dbench; not checked). ssh access exists already.
2. The harness's dependencies on Arm Linux: bubblewrap sandbox (`tools/agent-sandbox`), pi, Node, Playwright with an Arm Chromium build, the held-out suite's install. Any failure here has nothing to do with the model.
3. Which unit runs which job, and whether the link is configured for pair work: decide before the first run, since a TP=2 job occupies both.

4. Disk free on each unit: the two-Spark DeepSeek recipe needs about 530 GB on the head and about 310 GB on the worker, with the Engram tables on local disk. Not checked.

**Last checked:** 22 Oct 2026, from the owner's message and the pages cited above. **Recheck when:** thing2 is reachable; either unit runs `dbench serve`; a harness check on Arm Linux has run.

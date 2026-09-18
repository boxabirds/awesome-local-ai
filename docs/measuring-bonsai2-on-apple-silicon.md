# Measuring Bonsai 2 27B on Apple silicon

There is no macOS combination for Bonsai 2 in this repo yet, because nobody has
measured one. This page is the kit for producing the numbers one would need.
Run it, paste the output into an issue or a PR, and the combination can be
written with measured values instead of extrapolated ones.

**Why it is not already here.** The repo's rule is that every figure in a
`profiles.tsv` comes from a run on that hardware
([docs/adding-a-combination.md](adding-a-combination.md#honesty)). The 64GB
macOS Qwen row is the cautionary example: it is extrapolated, and every line
that depends on it says so.

## What others have reported on 16 GB

Third-party reports, none of them measured by this repo and **none of them
Bonsai 2** — every one is the previous ternary generation or the 1-bit family.
They establish that a 27B ternary model fits in 16 GB, not how Bonsai 2 behaves
there.

| machine | cooling | model | runtime | generation |
|---|---|---|---|---|
| MacBook Pro M1 16GB | fan | Ternary-Bonsai-27B 2-bit | MLX | 16.3 tok/s |
| MacBook Air M3 16GB | **fanless** | Ternary-Bonsai-27B 2-bit | MLX | 9.1 avg, 5.8 by trial 5 |
| MacBook Air M3 16GB | **fanless** | Bonsai-27B 1-bit | MLX | 18.3 tok/s |
| Mac mini M4 16GB | fan | Bonsai-27B 1-bit | MLX | reported to run |

Sources: [M1 write-up](https://dev.to/lbobylev/bonsai-27b-2-bit-on-a-macbook-m1-big-model-small-memory-mixed-results-5b3o),
[Bonsai-demo PR #164](https://github.com/PrismML-Eng/Bonsai-demo/pull/164) (M3 Air, unmerged at time of writing).

**The fanless rows are the ones to read carefully.** PR #164's five consecutive
trials of the 27B ternary model on the M3 Air run
`10.964, 11.013, 9.829, 7.991, 5.800` — a 47% fall while the benchmark is still
running. The headline "9.119 average" describes neither the cold rate (~11) nor
the sustained one (~6). The fan-cooled M1 reports no throttling at all.

So on a fanless Air, expect the first minute to flatter the machine, and treat
any single average as suspect.

## Why those numbers are still not good enough

- **None of them is Bonsai 2.** It is a different build at 5.9-7.2 GB against
  the v1 2-bit's 8.5 GB, and no 16 GB Apple result exists for it at all.
- **Metal's working set, not the machine's RAM, is the ceiling.** On Apple
  silicon `recommendedMaxWorkingSetSize` is what constrains a model — see
  `lib/accel/metal.sh`. On a 16 GB machine that is well under 16 GB. The M3 Air
  run peaked at 8.83 GB for the 2-bit 27B, which is most of that budget.
- **The M1 write-up's verdict was mixed**: "Qwen3 14B 4-bit was about 1.9 times
  faster" and more reliable on a deterministic calculation task, where Bonsai
  returned an empty list. Worth reproducing before recommending the combination
  to anyone.

## Which backend a macOS combination would use — not MTPLX

Both existing macOS combinations use `BACKEND=mtplx`, and **MTPLX cannot serve
Bonsai 2**. It is not a matter of configuration:

- it serves its own pack format from its own repos (`MODEL_REPO`, e.g.
  `Youssofal/Qwen3.8-27B-MTPLX-Optimized-Quality`) and fetches them itself
  (`BACKEND_NEEDS_HF=0`), so there is nowhere to hand it a GGUF;
- it verifies an MTP head is present (`mtplx inspect --require-mtp`), and
  Bonsai 2 ships no drafter of any kind;
- it has no ternary kernels and no Hadamard activation transform, which is the
  thing that makes these weights readable at all.

That leaves two candidates, and the measurement decides between them:

**1. `llamacpp` + `metal` + the fork — costs a config file.** Since
`lib/llamacpp.sh` takes `LLAMA_REPO_URL`/`LLAMA_BRANCH` and `lib/accel/metal.sh`
already implements `accel_cmake_args` for a compiled backend, this pairing needs
**no new shell logic** — the same four files any combination needs. The Metal
kernels for `PQ2_0` and `PTQ1_0` are in the fork per the publisher's backend
table.

**2. MLX via PrismML's MLX fork — costs a new backend module.** On the previous
ternary generation MLX was nearly twice as fast as llama.cpp Metal on the *same*
M1 Pro: **15.0 vs 8.4 tok/s**. If that gap holds on Bonsai 2, option 1 is
leaving half the machine's performance unused, and `lib/mlx-prism.sh` plus
`lib/runtime/server-mlx-prism.sh` would be worth writing (see
[adding-a-combination.md](adding-a-combination.md#adding-a-new-accelerator-backend-or-client)).

So run **both** paths below. The point of the exercise is not only "does it
run" but "which backend should the combination declare".

## Kit

Everything lands in a scratch directory; nothing touches your system.

```bash
mkdir -p ~/bonsai2-probe && cd ~/bonsai2-probe

# 1. The fork. Stock llama.cpp CANNOT read these weights.
git clone --depth 1 --branch prism https://github.com/PrismML-Eng/llama.cpp.git
cd llama.cpp
cmake -B build -S . -DCMAKE_BUILD_TYPE=Release \
      -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
      -DLLAMA_BUILD_TOOLS=ON -DLLAMA_BUILD_SERVER=ON
cmake --build build --config Release -j"$(sysctl -n hw.ncpu)"
cd ..

# 2. Weights. PTQ1_0 is the smaller packing (5.53 GiB) and the right one to try
#    first on a 16 GB machine.
hf download prism-ml/Ternary-Bonsai-2-27B-gguf \
    --include "Ternary-Bonsai-2-27B-PTQ1_0.gguf" --local-dir models

# 3. What Metal will actually let you wire, BEFORE loading anything.
python3 -c 'import mlx.core as mx; print("recommendedMaxWorkingSetSize:",
    mx.metal.device_info()["max_recommended_working_set_size"]/1024**2, "MiB")' 2>/dev/null \
  || echo "(no mlx; sysctl iogpu.wired_limit_mb = $(sysctl -n iogpu.wired_limit_mb 2>/dev/null || echo unset))"
```

### The four measurements

```bash
BIN=~/bonsai2-probe/llama.cpp/build/bin
M=~/bonsai2-probe/models/Ternary-Bonsai-2-27B-PTQ1_0.gguf

# A. Does it load and generate at all?
$BIN/llama-cli -m "$M" -ngl 99 -fa on -c 4096 --single-turn -n 150 \
    --temp 1.0 --top-p 0.95 --top-k 20 \
    -p "Write a Python function that reverses a linked list. Code only."

# B. Throughput, and how it decays as context fills. THE table.
#    Drop depths from the list if a deeper one fails.
$BIN/llama-bench -m "$M" -p 512 -n 128 -fa 1 -ngl 99 -r 3
$BIN/llama-bench -m "$M" -n 128 -p 0 -d 0,8192,32768 -fa 1 -ngl 99 -r 2

# C. How much context actually fits. Run each; note which is the last to load.
for CTX in 8192 32768 65536 131072 262144; do
  echo "=== ctx=$CTX ==="
  $BIN/llama-server -m "$M" -ngl 99 -fa on -c $CTX \
      --cache-type-k q4_0 --cache-type-v q4_0 -np 1 \
      --host 127.0.0.1 --port 18099 & SRV=$!
  for i in $(seq 1 180); do curl -sf localhost:18099/health >/dev/null && break; sleep 1; done
  curl -sf localhost:18099/health >/dev/null \
    && echo "ctx=$CTX OK, footprint: $(ps -o rss= -p $SRV | awk '{print $1/1024" MiB RSS"}')" \
    || echo "ctx=$CTX FAILED"
  kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; sleep 3
done

# D. Which KV types keep a Metal kernel. On CUDA, q5_1 fell off a cliff
#    (28 tok/s vs 3015) with NO warning. Check whether Metal does the same.
for KV in f16 q8_0 q4_0 q5_1; do
  echo "=== kv=$KV ==="
  $BIN/llama-bench -m "$M" -p 512 -n 0 -fa 1 -ngl 99 -ctk $KV -ctv $KV -r 2
done
```

### Also worth running: the MLX path

macOS has a second option this repo does not use on CUDA — the
[MLX build](https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-mlx-2bit) via
PrismML's [MLX fork](https://github.com/PrismML-Eng/mlx). On the previous
ternary generation MLX beat llama.cpp Metal on the same M1 Pro (15.0 vs 8.4
tok/s). If that holds on the M2, a macOS combination should probably use MLX,
not llama.cpp — which would make it a **new backend module**, not a config file.

```bash
pip install mlx-lm
python -m mlx_lm.benchmark --model prism-ml/Ternary-Bonsai-2-27B-mlx-2bit -p 512 -g 128
```

## What to report

Enough for a `profiles.tsv` row and an honest `help.txt`:

| | |
|---|---|
| Machine | chip, core counts, RAM, macOS version, fanless or not |
| Working set | `recommendedMaxWorkingSetSize` |
| A | did it generate coherent text? |
| B | `llama-bench` tables verbatim, including the depth sweep |
| C | the largest context that loaded, and the first that failed |
| D | the KV table, flagging any type that collapses |
| Thermals | **five** consecutive runs of B, each one's number, not the average |

That last row matters more on a fanless Air than on any machine in this repo so
far, and no existing combination measures it. Report every trial: the M3 Air
submission above would have looked like a 9 tok/s machine if it had reported
only its mean, and like an 11 tok/s machine if it had reported only its best.

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

## What we expect, and why that is not good enough

The 24GB CUDA combination measured PTQ1_0 at **5.53 GiB of weights**, and the
publisher reports 27B Bonsai variants running on 18-24 GB Macs. A 16 GB machine
is below anything reported anywhere. Two things could go wrong and only a run
will say which:

- **Metal's working set, not the machine's RAM, is the ceiling.** On Apple
  silicon `recommendedMaxWorkingSetSize` is what constrains a model — see
  `lib/accel/metal.sh`. On a 16 GB machine that is well under 16 GB.
- **Bandwidth, not capacity, sets the speed.** The M2 Air is a base-tier chip
  with no fan. Published community numbers for the *previous* ternary 27B:
  M3 Pro (18 GB) 12.6 tok/s, M4 24 GB 12.7 tok/s via MLX, M1 Pro 32 GB 15.0
  tok/s via MLX. A base M2 should land below all of these, and sustained runs
  may thermally throttle in a fanless chassis.

Neither number is in this repo, and neither should be quoted as if it were.

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
| Thermals | whether a second consecutive run of B was slower than the first |

That last row matters more on a fanless Air than on any machine in this repo so
far, and no existing combination measures it.

# Bonsai 2 27B on Apple silicon -- probe report

Produced by `benchmarks/apple-silicon-probe.sh` from awesome-local-ai.
Every number below is from this machine. Paths are scrubbed to $HOME.

## Machine
```
chip:      Apple M2
arch:      arm64
ram_bytes: 17179869184
cpus:      8
macos:     26.6.2
model:     Mac14,2
wired_limit_mb: 0
```

## Files
```
Ternary-Bonsai-2-27B-PTQ1_0.gguf: 5.5G
```

## A. Coherence check

Prompt: reverse a linked list, code only. Thinking is on by default, so the
answer may follow a reasoning block.

```
```

_Automated heuristic: **no** Python-shaped output found -- needs a human look._

## B. Headline (pp512 / tg128)

```
ggml_metal_device_init: tensor API disabled for pre-M5 and pre-A19 devices
ggml_metal_library_init: using embedded metal library
ggml_metal_library_compile_all: compiled 'fa' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'mul_mv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'mul_mm' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'quantize' library in 0.012 sec
ggml_metal_library_compile_all: compiled 'softmax' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'norm' library in 0.012 sec
ggml_metal_library_compile_all: compiled 'unary' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'binbcast' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'reduce' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'tri' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'ssm' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'wkv' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'gated_delta_net' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'solve_tri' library in 0.012 sec
ggml_metal_library_compile_all: compiled 'rope' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'conv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'upscale' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'argsort' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'pool' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'misc' library in 0.011 sec
ggml_metal_library_compile_all: loaded 20 libraries from embedded data in 0.012 sec (max single = 0.012 sec)
ggml_metal_rsets_init: creating a residency set collection (keep_alive = 180 s)
ggml_metal_device_init: GPU name:   MTL0 (Apple M2)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple8  (1008)
ggml_metal_device_init: GPU family: MTLGPUFamilyCommon3 (3003)
ggml_metal_device_init: GPU family: MTLGPUFamilyMetal4  (5002)
ggml_metal_device_init: simdgroup reduction   = true
ggml_metal_device_init: simdgroup matrix mul. = true
ggml_metal_device_init: has unified memory    = true
ggml_metal_device_init: has bfloat            = true
ggml_metal_device_init: has tensor            = false
ggml_metal_device_init: use residency sets    = true
ggml_metal_device_init: use shared buffers    = true
ggml_metal_device_init: recommendedMaxWorkingSetSize  = 12713.12 MB
| model                          |       size |     params | backend    | threads |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | --: | --------------: | -------------------: |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           pp512 |         30.30 ± 5.65 |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           tg128 |          3.83 ± 0.28 |

build: d8f26eec7 (10683)
```

## C. Thermal soak

5 consecutive identical runs. Report every one: a fanless
chassis can lose half its rate while the benchmark is still going, and an
average hides both the cold rate and the sustained one.

Thermal pressure before the soak:
```
Note: No thermal warning level has been recorded
Note: No performance warning level has been recorded
Note: No CPU power status has been recorded
```

**run 1**
ggml_metal_device_init: tensor API disabled for pre-M5 and pre-A19 devices
ggml_metal_library_init: using embedded metal library
ggml_metal_library_compile_all: compiled 'fa' library in 0.046 sec
ggml_metal_library_compile_all: compiled 'mul_mv' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'mul_mm' library in 0.014 sec
ggml_metal_library_compile_all: compiled 'quantize' library in 0.005 sec
ggml_metal_library_compile_all: compiled 'softmax' library in 0.003 sec
ggml_metal_library_compile_all: compiled 'norm' library in 0.047 sec
ggml_metal_library_compile_all: compiled 'unary' library in 0.006 sec
ggml_metal_library_compile_all: compiled 'binbcast' library in 0.005 sec
ggml_metal_library_compile_all: compiled 'reduce' library in 0.047 sec
ggml_metal_library_compile_all: compiled 'tri' library in 0.006 sec
ggml_metal_library_compile_all: compiled 'ssm' library in 0.048 sec
ggml_metal_library_compile_all: compiled 'wkv' library in 0.005 sec
ggml_metal_library_compile_all: compiled 'gated_delta_net' library in 0.046 sec
ggml_metal_library_compile_all: compiled 'solve_tri' library in 0.047 sec
ggml_metal_library_compile_all: compiled 'rope' library in 0.047 sec
ggml_metal_library_compile_all: compiled 'conv' library in 0.047 sec
ggml_metal_library_compile_all: compiled 'upscale' library in 0.047 sec
ggml_metal_library_compile_all: compiled 'argsort' library in 0.046 sec
ggml_metal_library_compile_all: compiled 'pool' library in 0.047 sec
ggml_metal_library_compile_all: compiled 'misc' library in 0.046 sec
ggml_metal_library_compile_all: loaded 20 libraries from embedded data in 0.048 sec (max single = 0.048 sec)
ggml_metal_rsets_init: creating a residency set collection (keep_alive = 180 s)
ggml_metal_device_init: GPU name:   MTL0 (Apple M2)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple8  (1008)
ggml_metal_device_init: GPU family: MTLGPUFamilyCommon3 (3003)
ggml_metal_device_init: GPU family: MTLGPUFamilyMetal4  (5002)
ggml_metal_device_init: simdgroup reduction   = true
ggml_metal_device_init: simdgroup matrix mul. = true
ggml_metal_device_init: has unified memory    = true
ggml_metal_device_init: has bfloat            = true
ggml_metal_device_init: has tensor            = false
ggml_metal_device_init: use residency sets    = true
ggml_metal_device_init: use shared buffers    = true
ggml_metal_device_init: recommendedMaxWorkingSetSize  = 12713.12 MB
| model                          |       size |     params | backend    | threads |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | --: | --------------: | -------------------: |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           pp512 |         42.46 ± 0.00 |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           tg128 |          7.63 ± 0.00 |

build: d8f26eec7 (10683)

**run 2**
ggml_metal_device_init: tensor API disabled for pre-M5 and pre-A19 devices
ggml_metal_library_init: using embedded metal library
ggml_metal_library_compile_all: compiled 'fa' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'mul_mv' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'mul_mm' library in 0.012 sec
ggml_metal_library_compile_all: compiled 'quantize' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'softmax' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'norm' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'unary' library in 0.012 sec
ggml_metal_library_compile_all: compiled 'binbcast' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'reduce' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'tri' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'ssm' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'wkv' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'gated_delta_net' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'solve_tri' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'rope' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'conv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'upscale' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'argsort' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'pool' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'misc' library in 0.010 sec
ggml_metal_library_compile_all: loaded 20 libraries from embedded data in 0.012 sec (max single = 0.012 sec)
ggml_metal_rsets_init: creating a residency set collection (keep_alive = 180 s)
ggml_metal_device_init: GPU name:   MTL0 (Apple M2)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple8  (1008)
ggml_metal_device_init: GPU family: MTLGPUFamilyCommon3 (3003)
ggml_metal_device_init: GPU family: MTLGPUFamilyMetal4  (5002)
ggml_metal_device_init: simdgroup reduction   = true
ggml_metal_device_init: simdgroup matrix mul. = true
ggml_metal_device_init: has unified memory    = true
ggml_metal_device_init: has bfloat            = true
ggml_metal_device_init: has tensor            = false
ggml_metal_device_init: use residency sets    = true
ggml_metal_device_init: use shared buffers    = true
ggml_metal_device_init: recommendedMaxWorkingSetSize  = 12713.12 MB
| model                          |       size |     params | backend    | threads |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | --: | --------------: | -------------------: |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           pp512 |         41.21 ± 0.00 |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           tg128 |          6.33 ± 0.00 |

build: d8f26eec7 (10683)

**run 3**
ggml_metal_device_init: tensor API disabled for pre-M5 and pre-A19 devices
ggml_metal_library_init: using embedded metal library
ggml_metal_library_compile_all: compiled 'fa' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'mul_mv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'mul_mm' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'quantize' library in 0.012 sec
ggml_metal_library_compile_all: compiled 'softmax' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'norm' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'unary' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'binbcast' library in 0.012 sec
ggml_metal_library_compile_all: compiled 'reduce' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'tri' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'ssm' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'wkv' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'gated_delta_net' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'solve_tri' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'rope' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'conv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'upscale' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'argsort' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'pool' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'misc' library in 0.010 sec
ggml_metal_library_compile_all: loaded 20 libraries from embedded data in 0.012 sec (max single = 0.012 sec)
ggml_metal_rsets_init: creating a residency set collection (keep_alive = 180 s)
ggml_metal_device_init: GPU name:   MTL0 (Apple M2)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple8  (1008)
ggml_metal_device_init: GPU family: MTLGPUFamilyCommon3 (3003)
ggml_metal_device_init: GPU family: MTLGPUFamilyMetal4  (5002)
ggml_metal_device_init: simdgroup reduction   = true
ggml_metal_device_init: simdgroup matrix mul. = true
ggml_metal_device_init: has unified memory    = true
ggml_metal_device_init: has bfloat            = true
ggml_metal_device_init: has tensor            = false
ggml_metal_device_init: use residency sets    = true
ggml_metal_device_init: use shared buffers    = true
ggml_metal_device_init: recommendedMaxWorkingSetSize  = 12713.12 MB
| model                          |       size |     params | backend    | threads |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | --: | --------------: | -------------------: |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           pp512 |         26.83 ± 0.00 |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           tg128 |          3.71 ± 0.00 |

build: d8f26eec7 (10683)

**run 4**
ggml_metal_device_init: tensor API disabled for pre-M5 and pre-A19 devices
ggml_metal_library_init: using embedded metal library
ggml_metal_library_compile_all: compiled 'fa' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'mul_mv' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'mul_mm' library in 0.012 sec
ggml_metal_library_compile_all: compiled 'quantize' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'softmax' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'norm' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'unary' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'binbcast' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'reduce' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'tri' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'ssm' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'wkv' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'gated_delta_net' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'solve_tri' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'rope' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'conv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'upscale' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'argsort' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'pool' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'misc' library in 0.010 sec
ggml_metal_library_compile_all: loaded 20 libraries from embedded data in 0.012 sec (max single = 0.012 sec)
ggml_metal_rsets_init: creating a residency set collection (keep_alive = 180 s)
ggml_metal_device_init: GPU name:   MTL0 (Apple M2)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple8  (1008)
ggml_metal_device_init: GPU family: MTLGPUFamilyCommon3 (3003)
ggml_metal_device_init: GPU family: MTLGPUFamilyMetal4  (5002)
ggml_metal_device_init: simdgroup reduction   = true
ggml_metal_device_init: simdgroup matrix mul. = true
ggml_metal_device_init: has unified memory    = true
ggml_metal_device_init: has bfloat            = true
ggml_metal_device_init: has tensor            = false
ggml_metal_device_init: use residency sets    = true
ggml_metal_device_init: use shared buffers    = true
ggml_metal_device_init: recommendedMaxWorkingSetSize  = 12713.12 MB
| model                          |       size |     params | backend    | threads |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | --: | --------------: | -------------------: |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           pp512 |         26.62 ± 0.00 |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           tg128 |          4.16 ± 0.00 |

build: d8f26eec7 (10683)

**run 5**
ggml_metal_device_init: tensor API disabled for pre-M5 and pre-A19 devices
ggml_metal_library_init: using embedded metal library
ggml_metal_library_compile_all: compiled 'fa' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'mul_mv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'mul_mm' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'quantize' library in 0.012 sec
ggml_metal_library_compile_all: compiled 'softmax' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'norm' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'unary' library in 0.012 sec
ggml_metal_library_compile_all: compiled 'binbcast' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'reduce' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'tri' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'ssm' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'wkv' library in 0.012 sec
ggml_metal_library_compile_all: compiled 'gated_delta_net' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'solve_tri' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'rope' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'conv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'upscale' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'argsort' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'pool' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'misc' library in 0.011 sec
ggml_metal_library_compile_all: loaded 20 libraries from embedded data in 0.012 sec (max single = 0.012 sec)
ggml_metal_rsets_init: creating a residency set collection (keep_alive = 180 s)
ggml_metal_device_init: GPU name:   MTL0 (Apple M2)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple8  (1008)
ggml_metal_device_init: GPU family: MTLGPUFamilyCommon3 (3003)
ggml_metal_device_init: GPU family: MTLGPUFamilyMetal4  (5002)
ggml_metal_device_init: simdgroup reduction   = true
ggml_metal_device_init: simdgroup matrix mul. = true
ggml_metal_device_init: has unified memory    = true
ggml_metal_device_init: has bfloat            = true
ggml_metal_device_init: has tensor            = false
ggml_metal_device_init: use residency sets    = true
ggml_metal_device_init: use shared buffers    = true
ggml_metal_device_init: recommendedMaxWorkingSetSize  = 12713.12 MB
| model                          |       size |     params | backend    | threads |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | --: | --------------: | -------------------: |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           pp512 |         27.11 ± 0.00 |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           tg128 |          4.23 ± 0.00 |

build: d8f26eec7 (10683)

Thermal pressure after the soak:
```
Note: No thermal warning level has been recorded
Note: No performance warning level has been recorded
Note: No CPU power status has been recorded
```

### Thermal verdict

```
  run 1: 7.63 tok/s
  run 2: 6.33 tok/s
  run 3: 3.71 tok/s
  run 4: 4.16 tok/s
  run 5: 4.23 tok/s

  first 7.63 -> last 4.23  (-44.6%)
  VERDICT: throttling -- the sustained rate is NOT the headline rate.
```

## D. Context ceiling

Whether a context ALLOCATES, which is what decides the profile table. This
deliberately does not prefill: filling 128k on a Mac at ~50 tok/s prompt
rate would take the better part of an hour per row and measure decode
decay, not whether the context fits.

- ctx **8192**: OK, resident 6050 MiB
- ctx **32768**: OK, resident 6247 MiB
- ctx **65536**: OK, resident 6477 MiB
- ctx **131072**: OK, resident 6435 MiB
- ctx **262144**: OK, resident 7032 MiB

Largest context that loaded: **262144**

## E. KV cache types

On CUDA, q5_1 fell off a cliff -- 28 tok/s against 3015 -- with no warning,
a silent fallback to CPU attention. This checks whether Metal does the same.

**kv f16**
```
ggml_metal_device_init: tensor API disabled for pre-M5 and pre-A19 devices
ggml_metal_library_init: using embedded metal library
ggml_metal_library_compile_all: compiled 'fa' library in 0.033 sec
ggml_metal_library_compile_all: compiled 'mul_mv' library in 0.045 sec
ggml_metal_library_compile_all: compiled 'mul_mm' library in 0.037 sec
ggml_metal_library_compile_all: compiled 'quantize' library in 0.039 sec
ggml_metal_library_compile_all: compiled 'softmax' library in 0.003 sec
ggml_metal_library_compile_all: compiled 'norm' library in 0.046 sec
ggml_metal_library_compile_all: compiled 'unary' library in 0.003 sec
ggml_metal_library_compile_all: compiled 'binbcast' library in 0.046 sec
ggml_metal_library_compile_all: compiled 'reduce' library in 0.045 sec
ggml_metal_library_compile_all: compiled 'tri' library in 0.003 sec
ggml_metal_library_compile_all: compiled 'ssm' library in 0.046 sec
ggml_metal_library_compile_all: compiled 'wkv' library in 0.046 sec
ggml_metal_library_compile_all: compiled 'gated_delta_net' library in 0.003 sec
ggml_metal_library_compile_all: compiled 'solve_tri' library in 0.045 sec
ggml_metal_library_compile_all: compiled 'rope' library in 0.003 sec
ggml_metal_library_compile_all: compiled 'conv' library in 0.045 sec
ggml_metal_library_compile_all: compiled 'upscale' library in 0.045 sec
ggml_metal_library_compile_all: compiled 'argsort' library in 0.045 sec
ggml_metal_library_compile_all: compiled 'pool' library in 0.046 sec
ggml_metal_library_compile_all: compiled 'misc' library in 0.045 sec
ggml_metal_library_compile_all: loaded 20 libraries from embedded data in 0.046 sec (max single = 0.046 sec)
ggml_metal_rsets_init: creating a residency set collection (keep_alive = 180 s)
ggml_metal_device_init: GPU name:   MTL0 (Apple M2)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple8  (1008)
ggml_metal_device_init: GPU family: MTLGPUFamilyCommon3 (3003)
ggml_metal_device_init: GPU family: MTLGPUFamilyMetal4  (5002)
ggml_metal_device_init: simdgroup reduction   = true
ggml_metal_device_init: simdgroup matrix mul. = true
ggml_metal_device_init: has unified memory    = true
ggml_metal_device_init: has bfloat            = true
ggml_metal_device_init: has tensor            = false
ggml_metal_device_init: use residency sets    = true
ggml_metal_device_init: use shared buffers    = true
ggml_metal_device_init: recommendedMaxWorkingSetSize  = 12713.12 MB
| model                          |       size |     params | backend    | threads |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | --: | --------------: | -------------------: |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   1 |           pp512 |        24.07 ± 12.35 |

build: d8f26eec7 (10683)
```

**kv q8_0**
```
ggml_metal_device_init: tensor API disabled for pre-M5 and pre-A19 devices
ggml_metal_library_init: using embedded metal library
ggml_metal_library_compile_all: compiled 'fa' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'mul_mv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'mul_mm' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'quantize' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'softmax' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'norm' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'unary' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'binbcast' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'reduce' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'tri' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'ssm' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'wkv' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'gated_delta_net' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'solve_tri' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'rope' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'conv' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'upscale' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'argsort' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'pool' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'misc' library in 0.002 sec
ggml_metal_library_compile_all: loaded 20 libraries from embedded data in 0.012 sec (max single = 0.011 sec)
ggml_metal_rsets_init: creating a residency set collection (keep_alive = 180 s)
ggml_metal_device_init: GPU name:   MTL0 (Apple M2)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple8  (1008)
ggml_metal_device_init: GPU family: MTLGPUFamilyCommon3 (3003)
ggml_metal_device_init: GPU family: MTLGPUFamilyMetal4  (5002)
ggml_metal_device_init: simdgroup reduction   = true
ggml_metal_device_init: simdgroup matrix mul. = true
ggml_metal_device_init: has unified memory    = true
ggml_metal_device_init: has bfloat            = true
ggml_metal_device_init: has tensor            = false
ggml_metal_device_init: use residency sets    = true
ggml_metal_device_init: use shared buffers    = true
ggml_metal_device_init: recommendedMaxWorkingSetSize  = 12713.12 MB
| model                          |       size |     params | backend    | threads | type_k | type_v |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | -----: | -----: | --: | --------------: | -------------------: |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   q8_0 |   q8_0 |   1 |           pp512 |         27.01 ± 0.74 |

build: d8f26eec7 (10683)
```

**kv q4_0**
```
ggml_metal_device_init: tensor API disabled for pre-M5 and pre-A19 devices
ggml_metal_library_init: using embedded metal library
ggml_metal_library_compile_all: compiled 'fa' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'mul_mv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'mul_mm' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'quantize' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'softmax' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'norm' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'unary' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'binbcast' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'reduce' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'tri' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'ssm' library in 0.009 sec
ggml_metal_library_compile_all: compiled 'wkv' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'gated_delta_net' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'solve_tri' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'rope' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'conv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'upscale' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'argsort' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'pool' library in 0.010 sec
ggml_metal_library_compile_all: compiled 'misc' library in 0.010 sec
ggml_metal_library_compile_all: loaded 20 libraries from embedded data in 0.012 sec (max single = 0.011 sec)
ggml_metal_rsets_init: creating a residency set collection (keep_alive = 180 s)
ggml_metal_device_init: GPU name:   MTL0 (Apple M2)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple8  (1008)
ggml_metal_device_init: GPU family: MTLGPUFamilyCommon3 (3003)
ggml_metal_device_init: GPU family: MTLGPUFamilyMetal4  (5002)
ggml_metal_device_init: simdgroup reduction   = true
ggml_metal_device_init: simdgroup matrix mul. = true
ggml_metal_device_init: has unified memory    = true
ggml_metal_device_init: has bfloat            = true
ggml_metal_device_init: has tensor            = false
ggml_metal_device_init: use residency sets    = true
ggml_metal_device_init: use shared buffers    = true
ggml_metal_device_init: recommendedMaxWorkingSetSize  = 12713.12 MB
| model                          |       size |     params | backend    | threads | type_k | type_v |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | -----: | -----: | --: | --------------: | -------------------: |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   q4_0 |   q4_0 |   1 |           pp512 |         26.59 ± 0.37 |

build: d8f26eec7 (10683)
```

**kv q5_1**
```
ggml_metal_device_init: tensor API disabled for pre-M5 and pre-A19 devices
ggml_metal_library_init: using embedded metal library
ggml_metal_library_compile_all: compiled 'fa' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'mul_mv' library in 0.004 sec
ggml_metal_library_compile_all: compiled 'mul_mm' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'quantize' library in 0.001 sec
ggml_metal_library_compile_all: compiled 'softmax' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'norm' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'unary' library in 0.002 sec
ggml_metal_library_compile_all: compiled 'binbcast' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'reduce' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'tri' library in 0.003 sec
ggml_metal_library_compile_all: compiled 'ssm' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'wkv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'gated_delta_net' library in 0.003 sec
ggml_metal_library_compile_all: compiled 'solve_tri' library in 0.003 sec
ggml_metal_library_compile_all: compiled 'rope' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'conv' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'upscale' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'argsort' library in 0.003 sec
ggml_metal_library_compile_all: compiled 'pool' library in 0.011 sec
ggml_metal_library_compile_all: compiled 'misc' library in 0.003 sec
ggml_metal_library_compile_all: loaded 20 libraries from embedded data in 0.012 sec (max single = 0.011 sec)
ggml_metal_rsets_init: creating a residency set collection (keep_alive = 180 s)
ggml_metal_device_init: GPU name:   MTL0 (Apple M2)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple8  (1008)
ggml_metal_device_init: GPU family: MTLGPUFamilyCommon3 (3003)
ggml_metal_device_init: GPU family: MTLGPUFamilyMetal4  (5002)
ggml_metal_device_init: simdgroup reduction   = true
ggml_metal_device_init: simdgroup matrix mul. = true
ggml_metal_device_init: has unified memory    = true
ggml_metal_device_init: has bfloat            = true
ggml_metal_device_init: has tensor            = false
ggml_metal_device_init: use residency sets    = true
ggml_metal_device_init: use shared buffers    = true
ggml_metal_device_init: recommendedMaxWorkingSetSize  = 12713.12 MB
| model                          |       size |     params | backend    | threads | type_k | type_v |  fa |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | -----: | -----: | --: | --------------: | -------------------: |
| qwen35 27B PTQ1_0 - 1.75 bpw ternary (group 128) |   5.53 GiB |    26.90 B | MTL,BLAS   |       4 |   q5_1 |   q5_1 |   1 |           pp512 |         26.34 ± 0.19 |

build: d8f26eec7 (10683)
```

## Notes from the operator

The thermal decline and the coherence sample are both above; whoever or
whatever ran this can answer the first two from the report itself. The
third needs a person in the room.

- Was the coherence output in section A actually sensible prose/code? 
- Did anything behave oddly (stalls, beachballs, memory pressure)? 
- Did the chassis get physically hot, and was anything else running? 


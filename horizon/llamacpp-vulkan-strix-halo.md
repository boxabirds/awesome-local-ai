# llama.cpp (Vulkan) on Strix Halo

**Status:** parked (29 Sep 2026): dropped from the v2 runs by the owner.
**Machine:** the Strix Halo box (Minisforum MS-S1 MAX, 128 GB). The combination stays:
[qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi](../combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi/).

## Why

On the same box and the same UD-Q4_K_XL weights, gufo reads prompts 4-7x faster (1,266 vs 302 tok/s at 32k,
1,228 vs 172 at 120k), and prompt reading is what dominates a long agent session. The v1.3 run canvas-vk-01
took 26.5 hours (67/75 held-out); gufo's runs took about 10-11. The Strix Halo box's time is better spent on gufo.

**Recheck when:** llama.cpp's Vulkan or ROCm prompt reading on Strix Halo improves substantially (a release
note or a quick `llama-bench` at 32k and 120k), or a Gorgon Halo machine arrives and the llama.cpp/gufo
comparison is wanted across generations.

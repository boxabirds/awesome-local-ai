# Qwen3.8-Flash-Next on a 128 GB Mac with llama.cpp (Metal) and pi

The tritus stack ([`ubuntu/strix-halo-128GB/llamacpp-pi`](../../../ubuntu/strix-halo-128GB/llamacpp-pi/))
moved to Apple silicon. It uses:
- the same llama.cpp branch and commit (`danielhanchen/llama.cpp` `qwen4exp/mtp`, `6fcaa16`);
- the same weights (Unsloth `UD-IQ4_XS` at revision `38bb39ee…`, plus the shared-Q8_0 MTP head);
- the same MTP settings (depth 4, p-min 0), sampling, reasoning effort and 131,072-token context.

Only the GPU backend differs: Metal instead of Vulkan.

It exists for one comparison: llama.cpp against MTPLX ([`../mtplx-opencode`](../mtplx-opencode/)) on
the same Mac, the same model family and the same client. That separates the engine from the
hardware. See the MTPLX forensics for why the comparison is needed.

    ./install.sh qwen/3.8/flash-next/macos/128GB/llamacpp-pi

**Not measured yet.** The memory figures in `profiles.tsv` are carried over from the Strix Halo
estimates, and the smoke test prints the real footprint.

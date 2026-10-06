# Qwen3.8-Flash-Next at 3 bits on a 128 GB Mac, llama.cpp Metal, driven by pi

**Status:** installed, never benchmarked. It exists to answer one question.
**Pair:** `qwen/3.8/flash-next/macos/128GB/llamacpp-pi` runs the same model, engine, branch, machine, sampling,
context and client at **UD-IQ4_XS**. This one runs **UD-IQ3_XXS**. The quantisation is the only difference.

## Why it exists

Strata's GSQ-RCO IQ3_XXS scored 6 of 27 at story 3 where every 4-bit-and-up stack scored 21-24. That run moved
the engine and the quantisation at once, so the result attributes to neither. Holding the engine still and
changing only the bit depth answers the question that generalises: **can 3-bit Flash-Next do agentic coding?**

Unsloth's UD-IQ3_XXS and ISTA-DASLab's GSQ-RCO IQ3_XXS are different methods at the same nominal depth, so a
result here is about 3-bit Flash-Next in general, not about Strata's weights. Unsloth publish no top-1 agreement
or KLD figure for this size on the model's card, so none is quoted.

The Strix Halo stack ([`ubuntu/strix-halo-128GB/llamacpp-pi`](../../../ubuntu/strix-halo-128GB/llamacpp-pi/))
moved to Apple silicon. It uses:
- the same llama.cpp branch and commit (`danielhanchen/llama.cpp` `qwen4exp/mtp`, `6fcaa16`);
- the same weights (Unsloth `UD-IQ4_XS` at revision `38bb39ee…`, plus the shared-Q8_0 MTP head);
- the same MTP settings (depth 4, p-min 0), sampling, reasoning effort and 131,072-token context.

Only the GPU backend differs: Metal instead of Vulkan.

It exists for one comparison: llama.cpp against MTPLX ([`../mtplx-pi`](../mtplx-pi/)) on
the same Mac, the same model family and the same client. That separates the engine from the
hardware. See the MTPLX forensics for why the comparison is needed.

    ./install.sh qwen/3.8/flash-next/macos/128GB/llamacpp-pi

**Not measured yet.** The memory figures in `profiles.tsv` are carried over from the Strix Halo
estimates, and the smoke test prints the real footprint.

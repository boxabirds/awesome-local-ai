# K2 Horizon (MBZUAI Institute of Foundation Models): a new open model family, and how much of its tooling is real

**Status:** gated (3 Oct 2026). A new model family, not an engine. Of the stacks it claimed, vLLM and SGLang are real;
llama.cpp is one maintainer's merge away; Ollama and MLX are not there. Nothing here was run.
**Kind:** a model-axis candidate: every combination so far is Qwen3.8 (27B, Swift, Flash-Next). It would add a column,
not replace one.
**Sources:** the model cards on Hugging Face (`IFM/K2-Horizon-*`), launch coverage (HPCwire AIwire 3 Sep; Moor Insights &
Strategy; TBreak), and the pull requests, issues and file listings of vllm, sglang, llama.cpp, mlx-lm, transformers and
ollama, all read 3 Oct 2026. The institute's own site returned 403 to a fetch.

## What it is

The K2 family is from MBZUAI's Institute of Foundation Models (IFM): K2 V2 and K2 Think V2 (70B, earlier in 2026), and on
3 Sep 2026 **K2 Horizon**, six models: 0.9B, 3.7B, 7B and 32B dense, **MoVA-36B-A4B** (a mixture of experts with
"mixture-of-values" attention, 36B stored, 4B active, 524,288-token context) and 375B-A23B. Apache-2.0, on Hugging Face under
`IFM/`. The cards say weights, data and recipe are open; for MoVA, "training code will be made public" and
"intermediate checkpoints will be released" are in the future tense.

## The claims against what is there

| Claim (source) | What I found | Verdict |
|---|---|---|
| "Day-zero support from vLLM" (Moor Insights; TBreak) | vllm pull request 55063 "Add K2-Horizon model support" merged 3 Sep 08:17 UTC, the launch day; `vllm/model_executor/models/k2_horizon.py` exists; a recipes page at recipes.vllm.ai/IFM answers. Open: MoVA weight loading and GPTQ INT4 (56637), tool-call parser fixes | Real |
| "Day-zero support from SGLang" | sglang pull request 37654 "Add native IFM K2 Horizon serving support" merged 3 Sep 08:39 UTC, with a tool-call detector; a cookbook page answers. FP8 loading for MoVA (39509) still open | Real |
| "Day-zero support from Ollama" (Moor Insights) | `ollama.com/library/k2-horizon` is a 404; ollama's library search shows no K2 Horizon; the one issue (18698, "Support for K2 Horizon models") is open since 28 Sep with no pull request | Not real |
| GGUFs "for use with llama.cpp" (the GGUF cards) | Official GGUFs exist for 0.9B, 3.7B, 7B, 32B and MoVA-36B (BF16, Q8_0, Q6_K, Q5_K_M, Q5_0, Q4_K_M). The cards say they "require a version of llama.cpp containing K2 Horizon architecture support. PR to llama.cpp is in progress". llama.cpp pull request 29535 ("add K2 Horizon dense and MoVA support", 2,192 lines, 26 files) is by an outside contributor, open since 27 Sep; a maintainer (CISC) approved it on 1 Oct; its state is "dirty" (needs a rebase); the bot flagged it as large. IFM's own fork was last pushed 17 Sep, before the PR's later fixes | Partly: real files, no released llama.cpp runs them yet |
| MLX / Apple silicon | No `k2_horizon` file in mlx-lm. An mlx-lm pull request (1841) was closed without merging on 6 Sep. A community MLX quant of the 7B exists (`mlx-works/K2-Horizon-7B-oQ4e`); whether any released mlx-lm loads it is not checked | Not there |
| Transformers | Cards say `transformers` but load with `trust_remote_code=True`; the transformers pull request (49132, "[New model] Add K2 Horizon") is open | Not native |
| "All six ship with quantization support" (Moor) | GGUF for five of six (none for the 375B); FP8 and GPTQ INT4 work is open in vllm and sglang for MoVA | Mostly |
| API partners (Compass, Cerebras, Nebius) and AMD/NVIDIA/Cerebras hardware | Not checked; irrelevant to local runs | Not checked |
| "Frontier-class at 4B active parameters"; "outscores dense 30B and MoE up to 15x its size" | The card's own tables, on the card's own harness. No third-party figure found. Not checked | Unverified |

So the pattern the owner saw a few weeks ago has partly resolved: the data-centre stacks were wired in the same day;
the local stacks (llama.cpp, Ollama, MLX) were claimed and are not yet there, and llama.cpp is the closest.

## Where it could run

Model sizes of the official GGUFs: MoVA-36B-A4B Q4_K_M 20.8 GiB (Q8_0 37.1); 32B dense Q4_K_M 19.6 GiB (Q8_0 34.4);
7B Q4_K_M 5.2 GiB. So by size it fits every machine here: the M5 Max and Strix Halo easily; the RTX 4090's 24 GB only just at
Q4_K_M, with little left for a long KV cache (the 128k minimum is unmeasured for this architecture). The only route to run
them locally today is llama.cpp built from the contributor's branch (`bitalov/llama.cpp`, `k2-horizon-all-fixes-20260927`)
or IFM's older fork: an unmerged branch is not a pin we would use for a benchmark. vLLM is a route on CUDA (the 4090 for
the small ones; MoVA-36B in BF16 is about 70 GiB and its quantized loading is still an open pull request).

## Confounds if it were run

A different model, so a different comparison from every Qwen result: it measures the model and the engine, as Strata does.
The tool-call format is its own (`json`, `xml` or `xml_typed`, `xml` by default; a dedicated parser in each stack, and a new
one in the llama.cpp pull request): the failure class of our gufo issue 304, so tool calls are the first check. MoVA's
attention differs from anything we run; `-sm tensor` multi-GPU is not relevant here.

## Checks before a run (minutes, no story)

1. The pull request merged and a llama.cpp release tag that contains it (or a pinned commit of master after the merge).
2. Tool calls over the OpenAI API with pi's requests, including raw newlines inside an argument, in each of the three tool-call
   formats the model supports, with the format fixed to one for the benchmark.
3. Cache reuse across a pi conversation past 120k tokens (the TensorFold check).
4. Memory at 131,072 context on the machine chosen, at the quantization chosen.

## Not checked

The card's benchmark figures; any independent evaluation; whether a coding-agent run of the 32B or the MoVA is any good at
building a web app (the only thing that matters here); the Q4_K_M quality loss, which the card reports against BF16 (about
85.6 average against 85.3 on its own suite); the 375B (does not fit any of our machines).

**Last checked:** 3 Oct 2026. **Recheck when:** llama.cpp pull request 29535 merges (the gate), or Ollama or mlx-lm adds it,
or the owner wants a non-Qwen model in the matrix.

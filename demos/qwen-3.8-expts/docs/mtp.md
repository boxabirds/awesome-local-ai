# Multi-Token Prediction (MTP) on Apple Silicon: oMLX + Qwen3.8-27B + OpenCode

A working setup for MTP speculative decoding on a local coding-agent stack, with
measured before/after numbers, the exact config files, and a note on which parts
transfer to other servers and clients.

**Result: ~2.2–2.5× decode throughput — ~13–17 tok/s → ~30–38 tok/s — at 73–85%
draft acceptance on real agentic coding prompts.**

Measured on macOS 26.4, Apple M5 Max / 128 GB, oMLX 0.5.7, Qwen3.8-27B 8-bit MLX.

> All config below is sanitized. Replace `/Users/you` with your home directory and
> `omlx-local-xxxxxxxxxxxxxxxx` with your own key from `~/.omlx/settings.json`.

---

## Contents

- [What MTP actually is here](#what-mtp-actually-is-here)
- [The pieces](#the-pieces)
- [Config: the whole thing](#config-the-whole-thing)
- [Applying the change](#applying-the-change)
- [Verifying it's on](#verifying-its-on)
- [Measured results](#measured-results)
- [Does MTP change the output? Yes](#does-mtp-change-the-output-yes)
- [Where the client fits: nowhere](#where-the-client-fits-nowhere)
- [What generalises beyond oMLX and OpenCode](#what-generalises-beyond-omlx-and-opencode)
- [Troubleshooting](#troubleshooting)

---

## What MTP actually is here

Normal decoding: one target-model forward pass per token. On Apple Silicon that
pass is memory-bandwidth-bound — you pay to stream ~28 GB of weights through the
GPU regardless of how much arithmetic you do with them.

MTP: a tiny drafter proposes a block of tokens, the target verifies the whole
block in **one** batched pass, and every accepted token is emitted. Verifying 3
tokens costs barely more than generating 1, because the expensive part (streaming
the weights) happens once either way. Rejected tokens cost you nothing but the
draft; the target still contributes its own next token each round, so a round
never emits fewer than 1 token.

> **MTP is not output-preserving.** "Verifies" does not mean "produces the same
> text you'd have gotten without it." Enabling MTP measurably changes the
> generated output on this stack. See
> [Does MTP change the output?](#does-mtp-change-the-output-yes) — read that
> before you enable it on anything you care about reproducing.

The drafter here is not a separate small model. It is the MTP head that ships
inside the Qwen3.8-27B checkpoint, split out into its own directory and quantized
separately — 456 MB, one layer, `block_size: 3` (so at most 3 tokens per round:
1 free target token + 2 drafted).

A wrinkle worth knowing: the target's `config.json` declares
`mtp_num_hidden_layers: 1`, but the target's `.safetensors` ships **zero** `mtp.*`
weights. That's why the drafter is a separate download, and why oMLX logs this on
load:

```
mlx-vlm runtime MTP patch applied for .../Qwen3.8-27B-8bit (config declares mtp
heads but checkpoint ships no mtp.* weights; MTPModule attachment skipped to keep
strict load_weights happy)
```

That line is expected. It is not an error.

---

## The pieces

| Piece | Path | Notes |
|---|---|---|
| Target model | `/Users/you/models/Qwen3.8-27B-8bit` | `model_type: qwen3_5`, MLX affine 8-bit, 27.9 GB resident |
| MTP drafter | `/Users/you/.omlx/drafters/Qwen3.8-27B-MTP-8bit` | `model_type: qwen3_5_mtp`, 456 MB, `block_size: 3` |
| Server config | `~/.omlx/model_settings.json` | per-model `vlm_mtp_*` keys |
| Server global | `~/.omlx/settings.json` | port, model dirs, sampling defaults |
| Client config | `~/.config/opencode/opencode.json` | **unchanged by MTP** |

The drafter's own README gives its `mlx-vlm` usage as
`--draft-model mlx-community/Qwen3.8-27B-MTP-8bit`, with `--draft-kind mtp`
auto-detected from `model_type`. Any MTP drafter must be derived from the same
base checkpoint as the target.

---

## Config: the whole thing

### 1. `~/.omlx/model_settings.json` — the actual MTP switch

```json
{
  "version": 1,
  "models": {
    "Qwen3.8-27B-8bit": {
      "preserve_thinking": false,
      "vlm_mtp_enabled": true,
      "vlm_mtp_draft_model": "/Users/you/.omlx/drafters/Qwen3.8-27B-MTP-8bit"
    },
    "Qwen3.8-27B-bf16": {
      "preserve_thinking": false
    }
  }
}
```

That is the entire change. Two keys.

**The key set**, from the live `ModelSettingsRequest` schema (`GET /openapi.json`):

| Key | Type | Meaning |
|---|---|---|
| `vlm_mtp_enabled` | bool | on/off, for models served by the **VLM** engine |
| `vlm_mtp_draft_model` | string | absolute path to the drafter (`~` is *not* expanded) |
| `vlm_mtp_draft_block_size` | int | tokens drafted per round; omit to inherit the drafter's own `block_size` |
| `mtp_enabled` | bool | the same feature for models on the **text-only LLM** engine |

Qwen3.8-27B is multimodal (`modalities.input: [text, image]`) and is served by
oMLX's `VLMBatchedEngine`, so it needs the `vlm_` variants. Setting `mtp_enabled`
on it silently does nothing. This is the single most likely way to waste an
afternoon.

### 2. `~/.omlx/settings.json` — server context (excerpt)

Nothing here is MTP-specific, but the sampling defaults matter when you read the
acceptance numbers, and the port/key are what the client points at.

```json
{
  "version": "1.0",
  "server": {
    "host": "127.0.0.1",
    "port": 8000,
    "log_level": "info"
  },
  "model": {
    "model_dirs": ["/Users/you/models"],
    "max_model_memory": "auto"
  },
  "scheduler": {
    "max_concurrent_requests": 8
  },
  "auth": {
    "api_key": "omlx-local-xxxxxxxxxxxxxxxx",
    "skip_api_key_verification": false
  },
  "sampling": {
    "max_context_window": 262144,
    "max_tokens": 32768,
    "temperature": 1.0,
    "top_p": 0.95,
    "top_k": 0,
    "repetition_penalty": 1.0
  }
}
```

Note `temperature: 1.0, top_p: 0.95` — acceptance rates below were achieved at
full temperature, not with greedy decoding. Greedy would score higher.

### 3. `~/.config/opencode/opencode.json` — client (excerpt, **no MTP settings**)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "omlx/Qwen3.8-27B-8bit",
  "provider": {
    "omlx": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "oMLX (local)",
      "options": {
        "baseURL": "http://127.0.0.1:8000/v1",
        "apiKey": "omlx-local-xxxxxxxxxxxxxxxx"
      },
      "models": {
        "Qwen3.8-27B-8bit": {
          "name": "Qwen3.8-27B 8-bit via oMLX",
          "limit": { "context": 262144, "output": 32768 },
          "attachment": true,
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        }
      }
    }
  },
  "agent": {
    "qwen38": {
      "description": "Agentic coder, brief reasoning (daily driver)",
      "mode": "primary",
      "model": "omlx/Qwen3.8-27B-8bit",
      "prompt": "You are an autonomous coding agent. Use the provided tools to read the user's repository, make precise edits, run commands, and search the web when you need current information. Prefer concrete actions over long explanations.",
      "options": { "chat_template_kwargs": { "reasoning_effort": "low" } }
    },
    "qwen38-think": {
      "description": "Agentic coder, maximum reasoning for hard problems",
      "mode": "primary",
      "model": "omlx/Qwen3.8-27B-8bit",
      "options": { "chat_template_kwargs": { "reasoning_effort": "xhigh" } }
    },
    "qwen38-fast": {
      "description": "Agentic coder, no reasoning -- mechanical edits",
      "mode": "primary",
      "model": "omlx/Qwen3.8-27B-8bit",
      "options": { "chat_template_kwargs": { "enable_thinking": false } }
    }
  }
}
```

This file is shown for completeness of the stack. **It is byte-identical before
and after enabling MTP.**

### 4. Drafter `config.json` (excerpt, for identification)

```json
{
  "block_size": 3,
  "model_type": "qwen3_5_mtp",
  "quantization": { "group_size": 64, "bits": 8, "mode": "affine" },
  "text_config": {
    "model_type": "qwen3_5_text",
    "mtp_num_hidden_layers": 1,
    "mtp_use_dedicated_embeddings": false,
    "hidden_size": 5120,
    "num_hidden_layers": 64,
    "vocab_size": 248320
  }
}
```

`mtp_use_dedicated_embeddings: false` means the drafter borrows the target's
token embeddings and LM head at runtime — that's why it's only 456 MB, and why it
is useless standalone.

---

## Applying the change

Settings bind at **model load time**, not per request. After editing, either
bounce the server:

```bash
omlx restart
```

or unload just that model and let the next request reload it:

```bash
KEY=$(python3 -c "import json;print(json.load(open('$HOME/.omlx/settings.json'))['auth']['api_key'])")
curl -X POST http://127.0.0.1:8000/v1/models/Qwen3.8-27B-8bit/unload \
  -H "Authorization: Bearer $KEY"
```

The oMLX admin UI at <http://127.0.0.1:8000/admin> exposes the same per-model
settings if you'd rather click. Both paths write the same file. (The
`/admin/api/...` REST endpoints exist but authenticate with the admin session, not
the `api_key` — a bearer token that works for `/v1/*` will 401 there.)

---

## Verifying it's on

On load you want this line in `~/.omlx/logs/server.log`:

```
omlx.engine_pool - VLM MTP enabled for Qwen3.8-27B-8bit, drafter=/Users/you/.omlx/drafters/Qwen3.8-27B-MTP-8bit
```

Then per request:

```
vlm_mtp decode started: request=3af0a741 uid=-2 block_size=None
vlm_mtp stats: request=3af0a741 finish=stop rounds=237 accepted=347/474 (73.2%)
              tokens_per_round=2.46 emitted=583 block_size=3
```

Live tail:

```bash
tail -f ~/.omlx/logs/server.log | grep -E "vlm_mtp|Chat completion"
```

**`tokens_per_round` is the KPI.** With `block_size=3` it ranges from 1.0 (no
benefit, pure overhead) to 3.0 (perfect). At 2.46–2.71 you're capturing most of
the theoretical win. Near 1.0 means the drafter is mismatched or sampling is
fighting it — turn MTP off, it's costing you.

No `vlm_mtp` lines at all means the setting never applied: wrong model id, wrong
key (`mtp_enabled` vs `vlm_mtp_enabled`), or the model wasn't reloaded.

---

## Measured results

Same three agentic coding prompts, same server, MTP on then off, back to back:

| Prompt | MTP on | MTP off | Speedup | Acceptance | tok/round |
|---|---|---|---|---|---|
| 142-tok prompt | 36.1 tok/s | 16.7 tok/s | 2.16× | 73.2% | 2.46 |
| 130-tok prompt | 38.4 tok/s | 15.6 tok/s | 2.46× | 85.3% | 2.71 |
| 102-tok prompt | 33.7 tok/s | 14.8 tok/s | 2.28× | 74.7% | 2.49 |

Caveats, stated plainly:

- **The on/off runs did not produce the same text.** Token counts differ per
  prompt (582 vs 416, 670 vs 618, 212 vs 209). tok/s is still the right metric
  for throughput, but this is a property of the feature, not a flaw in the
  measurement — see the next section.
- Both windows drift downward across repeats (MTP-on 36.1 → 35.7 → 30.4; MTP-off
  16.7 → 14.4 → 13.2) as cache state and thermals move. The first run of each
  window is the cleanest comparison.
- These are short prompts. MTP accelerates **decode only**. On a long-context
  agentic turn dominated by prefill, the end-to-end win is well under 2×.
- Single-stream (batch size 1). Under concurrent load the win shrinks.

Cost: ~456 MB extra resident memory, plus per-round verify overhead already priced
into the numbers above.

---

## Does MTP change the output? Yes

The speculative-decoding literature describes a verify step that is
*distribution-preserving*: drafts are accepted under a rejection-sampling rule
chosen so the emitted sequence is statistically identical to unaccelerated
decoding. It is easy to read "verify" and assume you get the same text, only
faster. **On this stack you do not.**

The A/B run above is unusually clean evidence, because each prompt was replayed
several times in each mode. Completion lengths, same prompts, same server:

| Prompt | MTP on (3 repeats) | MTP off (2 repeats) |
|---|---|---|
| 142-tok | 582, 582, 582 | 416, 416 |
| 130-tok | 670, 670, 670 | 618, 618 |
| 102-tok | 212, 212, 212 | 209, 209 |

The internal drafter stats repeat identically too — the 142-token prompt logged
`rounds=237 accepted=347/474 (73.2%)` on all three MTP runs, to the token.

Two conclusions, and the gap between them is the point:

1. **Generation is reproducible within a mode.** Despite `temperature: 1.0,
   top_p: 0.95`, repeated identical prompts produced byte-identical-length
   outputs. Sampling on this server is effectively deterministic run-to-run.
2. **Generation is not reproducible across the mode switch.** Flipping
   `vlm_mtp_enabled` changed every single output. The 142-token prompt produced a
   **40% longer** answer with MTP on. That is not a one-token tail difference; it
   is a different response.

So the divergence cannot be blamed on sampling noise. Enabling MTP moved the
output.

**What I can't tell you** is which mechanism causes it, and I'm not going to
guess authoritatively. The plausible candidates, any of which would do it:

- The verify rule may not be strict rejection sampling. Many practical MTP
  implementations accept a draft on argmax match or a relaxed probability
  threshold — faster, higher acceptance, not distribution-preserving.
- Numerics. A batched multi-token verify pass and a single-token decode pass use
  different kernels and different reduction orders, so logits differ in the last
  bits. Even an exact-match acceptance rule diverges once a single argmax flips.
- The drafter is quantized separately (affine 8-bit, group size 64), adding its
  own numerical error to the proposals.

Determining which would mean reading the oMLX verify implementation, not the logs.

**What this means practically:**

- Treat MTP as a setting that changes model behaviour, not a transparent speedup.
- Don't A/B a prompt, a system prompt, or an eval with MTP on for one arm and off
  for the other. You'll be measuring two things at once.
- If you have a golden-output regression suite, re-baseline it after toggling.
- For interactive coding — the workload this stack exists for — none of this
  matters much. One valid sample from the model is as good as another, and 2.3×
  is worth far more than reproducibility you weren't relying on.
- If you need bit-reproducible output (audit trails, paper results, cache-keyed
  responses), turn MTP off and accept ~14 tok/s.

---

## Where the client fits: nowhere

MTP is entirely server-side. The OpenCode config needs **no change** — no new
request fields, no new response fields, streaming behaves identically. Every agent
pointed at `omlx/Qwen3.8-27B-8bit` picks it up automatically.

The only client-side lever that matters, and only indirectly, is
`chat_template_kwargs.reasoning_effort`: higher effort means more decoded tokens,
which is exactly the regime where MTP pays off. A `reasoning_effort: xhigh` agent
benefits far more than a one-line-edit agent.

Two things this setup does *not* cover:

- **The bf16 target has no MTP configured**, and no bf16 drafter exists in this
  setup. Whether an 8-bit drafter pairs correctly with a bf16 target is untested;
  the drafter README says to use an adapter and target derived from the same
  checkpoint and doesn't commit either way on quantization mismatch. Measure
  `tokens_per_round` before trusting it.
- **Prefill is untouched.** oMLX has a separate `specprefill_*` family of settings
  for that. Different feature, different knobs.

---

## What generalises beyond oMLX and OpenCode

| Concept | Generalises? | Detail |
|---|---|---|
| Speculative decoding is client-transparent | **Yes, fully** | Any OpenAI-compatible client — OpenCode, Claude Code, Codex, `curl`, an SDK — needs zero changes. True of vLLM, SGLang, llama.cpp, TGI, and mlx-vlm alike. |
| Decode-only speedup | **Yes** | Never accelerates prefill. Budget accordingly for long-context agent turns. |
| Acceptance rate is the KPI | **Yes** | Every implementation exposes some version of it. Below ~50% acceptance the verify overhead usually eats the win. Always measure; never assume. |
| "Verify" ≠ same output | **Yes, treat as the default** | Distribution preservation is a property of a *particular* verify rule, not of speculative decoding in general, and floating-point non-associativity can break it even when the rule is correct. Whatever the server, assume output changes until you've checked. |
| Drafter must match the target checkpoint | **Yes** | Cross-checkpoint or cross-finetune drafters tank acceptance. Same base model, same tokenizer, ideally same quantization. |
| Extra resident memory for the drafter | **Yes** | Small here (456 MB) because it's one MTP layer borrowing the target's embeddings. A classic separate small-model drafter costs far more. |
| Higher temperature lowers acceptance | **Yes** | Drafts get rejected more when the distribution is spread. This server runs `temperature: 1.0, top_p: 0.95` and still hit 73–85%. |
| Batch dilution | **Yes** | Speculation wins most at batch size 1 (interactive coding). Under heavy concurrency the GPU is already saturated and the win shrinks. |
| MTP head shipped inside the model | **Mostly** | Qwen3-Next/3.5+, DeepSeek V3+, GLM-4.x ship MTP heads. Models without one need a separate draft model (n-gram, EAGLE, or a small sibling), configured differently. |
| Config binds at model load, not per request | **Mostly** | Near-universal. The mechanism for forcing a reload differs per server. |
| `vlm_mtp_*` vs `mtp_*` split | **No** | oMLX-specific, driven by its VLM/LLM engine split. vLLM uses `speculative_config`; llama.cpp uses `--model-draft` / `--draft-max`. |
| `~/.omlx/model_settings.json` layout, `omlx restart`, the log line formats | **No** | oMLX-specific trivia. |

The portable mental model: **speculative decoding is a server-side throughput knob
whose only honest measurement is accepted-tokens-per-round under your real
workload.** Everything above about which JSON file to edit is local detail.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| No `vlm_mtp` lines in the log | Setting never applied — wrong model id, or the model wasn't reloaded after the edit. |
| `mtp_enabled` set, nothing happens | Wrong key for a VLM-engine model. Use `vlm_mtp_enabled`. |
| `tokens_per_round` ≈ 1.0 | Drafter/target mismatch, or wrong drafter path. MTP is now a net loss — disable it. |
| Load fails on the drafter path | Path must be absolute. `~` is not expanded. |
| `MTPModule attachment skipped` on load | Expected. The target ships no `mtp.*` weights; the split-out drafter supplies them. |
| 401 on `/admin/api/...` | Those endpoints use the admin session, not the `/v1` bearer key. Edit the file or use the admin UI. |
| Output changed after enabling MTP | Expected, not a bug. See [Does MTP change the output?](#does-mtp-change-the-output-yes). Re-baseline any golden-output tests. |
| Need to roll back | oMLX writes timestamped backups as `~/.omlx/model_settings.json.before-mtp.*`. |

---

*Numbers and log excerpts in this document are from a real running system, not
estimates. Config files are sanitized copies of working configs.*

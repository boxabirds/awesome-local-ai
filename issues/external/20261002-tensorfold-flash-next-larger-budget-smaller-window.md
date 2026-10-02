> **Draft**, not filed. For https://github.com/ashhart/TensorFold/issues (no issue template there). Evidence: the
> startup logs of 2 Oct 2026 on the M5 Max, kept in the run folders named in `horizon/tensorfold.md`.

**Title:** Flash Next on a 128 GB Mac: raising TENSORFOLD_MEMORY_LIMIT_GB shrinks the keep-prompt window (48,128 at 89.6 GiB, 10,240 at 107.5 GiB), because the larger budget selects 8,192-token prompt chunks

## Summary

On a 128 GB M5 Max, `Vontra/Qwen3.8-Flash-Next-MLX-4bit-MTP` gets a 48,128-token fitted context window at the
default 89.6 GiB budget. Raising the budget to the ceiling the server itself suggests (107.5 GiB) lowers the window
to 10,240 tokens. The only startup line that differs is the prompt chunk: 2,048 tokens at 89.6 GiB, 8,192 at
107.5 GiB. We need about 131k tokens of context that keeps its prompt between turns (a coding agent's session) and
found no setting on this machine that gives it.

## Environment

- TensorFold 0.6.0 (commit `c4646171139e`), MLX 0.32.3, mlx-lm 0.31.3, Python 3.12
- Apple M5 Max, 128 GB, macOS 26.4 (25E246); no other model server or large process running
- Checkpoint: `Vontra/Qwen3.8-Flash-Next-MLX-4bit-MTP` at `dadefa80`, sha256-verified

## To reproduce

```bash
# A: default budget
TENSORFOLD_NO_LIVE=1 tensorfold serve <checkpoint> --host 127.0.0.1 --port 18950 --name bench \
  --reasoning-effort low --max-tokens 32768 --parallel 1 --snapshot-dir none --no-update-check \
  --temperature 1.0 --top-p 0.95 --top-k 20

# B: the same, with the budget raised (110 is clamped to the 107.5 GiB ceiling)
TENSORFOLD_MEMORY_LIMIT_GB=110 TENSORFOLD_NO_LIVE=1 tensorfold serve <same arguments>
```

No request is needed: the difference is in the startup lines.

## What happens

A, 89.6 GiB:

```
[tensorfold] memory budget 89.6 GiB: MLX's buffers up to 86.6 GiB, 3 GiB for the rest of the process; TENSORFOLD_MEMORY_LIMIT_GB can raise it to 107.5
[tensorfold] weights: 75.6 GiB resident, 29.8 GiB file-backed
[tensorfold] 77.2 GiB of weights kept resident
[tensorfold] prompt chunks of up to 2,048 tokens, cut at replies 256+ tokens apart
[tensorfold] context window 48,128 tokens: the most one request can use in the 89.6 GiB memory budget and still keep its prompt for the next turn (the model's window is 262,144); have clients compact before it
```

B, 107.5 GiB:

```
[tensorfold] memory budget 107.5 GiB: MLX's buffers up to 104.5 GiB, 3 GiB for the rest of the process
[tensorfold] weights: 75.6 GiB resident, 29.8 GiB file-backed
[tensorfold] 77.2 GiB of weights kept resident
[tensorfold] prompt chunks of up to 8,192 tokens, cut at replies 256+ tokens apart
[tensorfold] context window 10,240 tokens: the most one request can use in the 107.5 GiB memory budget and still keep its prompt for the next turn (the model's window is 262,144); have clients compact before it
```

Every configuration we started (startup lines only, except the first two, which also served requests):

| Budget (GiB) | Extra flags | Prompt chunk | Result |
|---|---|---|---|
| 89.6 | none | 2,048 | window 48,128 |
| 89.6 | `--ple-on-ssd` | 2,048 | window 48,128 (no change; the tables were already file-backed) |
| 89.6 | `--prefill-pass 1` | 2,048 | window 48,128 |
| 107.5 | `--ple-on-ssd` | 8,192 | window 10,240 |
| 107.5 | `--prefill-pass 1` | 8,192 | window 34,816 |
| 107.5 | `--context 163840` | 8,192 | refused: "the most one request can use is 18,176 tokens (prompt plus reply)" |
| 107.5 | `--prefill-pass 1 --context 163840` | 8,192 | refused, same 18,176 |

At 89.6 GiB the server works as it says: a conversation grown turn by turn to 32,033 prompt tokens reused its
prompt on every turn (worst re-read 5 tokens), and requests past 48,128 tokens were refused with a clear message.

## What we expected

A larger budget to give a window at least as large. `docs/recipes/qwen3.8-flash-next.md` describes the chunk as
"the largest of 8,192, 4,096 and 2,048 tokens whose working memory leaves room for 128K tokens of context", so we
expected either 128K of context at 107.5 GiB, or the 2,048-token chunk to be kept.

## What we think causes it (from reading 0.6.0)

- `engine/prefill_step.py choose()` accepts a chunk when `held + work * step // small + 131072 * per_token` fits
  the budget: one copy of the cache, and the working memory of the smallest chunk scaled linearly.
- The fitted window comes from `server/prompt_memory.py largest_window(resumable=True)`, which counts two copies of
  the cache (`kept = 2`) plus the measured working memory of the chosen chunk, the cache's growth and the attention
  scores.
- So at 107.5 GiB the 8,192-token chunk passes the first test and then leaves room for only 10,240 tokens under
  the second. At 89.6 GiB only the 2,048-token chunk passes, and its smaller working memory leaves 48,128.
- By the same arithmetic, 2,048-token chunks at 107.5 GiB would keep roughly 130-140k tokens (9.4 GiB beside the
  weights keeps 48k; 27 GiB would be free). That is our estimate, not a measurement: we found no way to pin the
  chunk (the choices are fixed in `families/qwen4_exp/__init__.py engine_settings()`).

## Questions

1. Is the window shrinking as the budget grows intended? If not, could `choose()` use the same accounting as the
   keep-prompt window (two copies, the chosen chunk's measured working memory)?
2. Could the chunk be set by hand (an option or an environment variable), so a client that values context over
   prefill speed can keep 2,048-token chunks at a larger budget?
3. What is the intended way to get about 131k tokens of resumable context for Flash Next on a 128 GB Mac? Only
   `--ssd-experts`, at its decode cost?
4. The explicit `--context` refusal reports 18,176 tokens as the most one request can use, below the 34,816
   keep-prompt window the same budget reports with `--prefill-pass 1` and no `--context`. Is that expected?

## One more thing, which we can't attribute

While starting the server in turn at budgets of 94, 98, 102 and 105 GiB (startup only, nothing else running) the
Mac restarted. We lost that sweep's output and found no panic report, so we don't know which budget it was or
whether TensorFold was the cause; the earlier starts at 107.5 GiB completed normally, with system-wide free memory
down to 18% during loading. We mention it because the ceiling the server suggests (107.5 GiB of 128) leaves little
for the 29.8 GiB of file-backed tables and the rest of the system.

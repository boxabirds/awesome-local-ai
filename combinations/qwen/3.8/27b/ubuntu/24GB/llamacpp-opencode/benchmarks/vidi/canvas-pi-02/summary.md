# Vidi run — qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | 50.2 | None | None | None | — | — | green | 5/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 18 GB |
| 2 | Capture ideas on sticky notes and rearrange them | 43.0 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 18 GB |
| 3 | See other people's edits appear live on the same board | 204.3 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 8 | — | throttled 0%, server peak 18 GB |

**Totals:** 3 stories, 297 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 24/27, stalled 0, 7595 lines in src+tests.

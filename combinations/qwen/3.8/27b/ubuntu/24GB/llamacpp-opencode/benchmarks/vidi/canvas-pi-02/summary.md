# Vidi run — qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | 50.2 | None | None | None | — | — | green | 5/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 18 GB |
| 2 | Capture ideas on sticky notes and rearrange them | 43.0 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 18 GB |

**Totals:** 2 stories, 93 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/2, final acceptance 18/20, stalled 0, 4288 lines in src+tests.

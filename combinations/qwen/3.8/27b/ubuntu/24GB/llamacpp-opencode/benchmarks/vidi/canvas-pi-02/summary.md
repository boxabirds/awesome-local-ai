# Vidi run — qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 50.2 | None | None | None | — | — | green | 5/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 18 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 43.0 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 18 GB |
| 3 | See other people's edits appear live on the same board | DONE | 204.3 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 8 | — | throttled 0%, server peak 18 GB |
| 4 | Return to a board and find everything as it was left | DONE | 230.2 | None | None | None | — | — | red | 28/31 |  | 0 / 0 | 9 | — | throttled 0%, server peak 18 GB |
| 5 | Share a board with others using a link | DONE | 49.1 | None | None | None | — | — | red | 0/36 |  | 0 / 0 | 2 | — | throttled 0%, server peak 18 GB |

**Totals:** 5 stories, 577 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/5, final acceptance 0/36, stalled 0, partial 0, 12727 lines in src+tests.

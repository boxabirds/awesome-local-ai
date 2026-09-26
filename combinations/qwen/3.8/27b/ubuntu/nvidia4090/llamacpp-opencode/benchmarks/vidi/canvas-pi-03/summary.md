# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 19.9 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 57.5 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 2 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 168.5 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 7 | — | throttled 0%, server peak 18 GB |
| 4 | Return to a board and find everything as it was left | DONE | 252.4 | None | None | None | — | — | green | 29/31 |  | 0 / 1 | 11 | — | throttled 0%, server peak 18 GB |
| 5 | Share a board with others using a link | DONE | 91.4 | None | None | None | — | — | green | 34/36 |  | 0 / 0 | 4 | — | throttled 0%, server peak 18 GB |

**Totals:** 5 stories, 590 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 5/5, final acceptance 34/36, stalled 0, partial 0, 11016 lines in src+tests.

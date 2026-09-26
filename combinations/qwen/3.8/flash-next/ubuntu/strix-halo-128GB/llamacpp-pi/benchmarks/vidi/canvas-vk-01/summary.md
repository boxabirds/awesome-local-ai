# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi

Model `qwen3.8-flash-next`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 77.8 | None | None | None | — | — | red | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 36 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 97.8 | None | None | None | — | — | red | 17/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 36 GB |
| 3 | See other people's edits appear live on the same board | DONE | 212.2 | None | None | None | — | — | red | 24/27 |  | 0 / 0 | 4 | — | throttled 0%, server peak 36 GB |
| 4 | Return to a board and find everything as it was left | DONE | 158.4 | None | None | None | — | — | red | 28/31 |  | 0 / 0 | 3 | — | throttled 0%, server peak 38 GB |
| 5 | Share a board with others using a link | DONE | 79.6 | None | None | None | — | — | red | 33/36 |  | 0 / 0 (ended in error) | 1 | — | throttled 0%, server peak 38 GB MEMORY-ABORT |
| 7 | Select, move, resize and delete several objects at once | DONE | 182.0 | None | None | None | — | — | red | 41/44 |  | 0 / 0 | 4 | — | throttled 0%, server peak 37 GB |

**Totals:** 6 stories, 808 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/6, final acceptance 41/44, stalled 0, partial 0, 15117 lines in src+tests.

# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 50.2 | None | None | None | — | — | green | 5/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 18 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 43.0 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 18 GB |
| 3 | See other people's edits appear live on the same board | DONE | 204.3 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 8 | — | throttled 0%, server peak 18 GB |
| 4 | Return to a board and find everything as it was left | DONE | 230.2 | None | None | None | — | — | red | 28/31 |  | 0 / 0 | 9 | — | throttled 0%, server peak 18 GB |
| 5 | Share a board with others using a link | DONE | 49.1 | None | None | None | — | — | red | 0/36 |  | 0 / 0 | 2 | — | throttled 0%, server peak 18 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 174.0 | None | None | None | — | — | green | 41/44 |  | 0 / 0 | 7 | — | throttled 0%, server peak 18 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 100.9 | None | None | None | — | — | green | 48/51 |  | 0 / 0 | 6 | — | throttled 0%, server peak 18 GB |
| 9 | Write free text anywhere on the board | DONE | 51.5 | None | None | None | — | — | green | 51/57 |  | 0 / 1 | 3 | — | throttled 0%, server peak 18 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 21.4 | None | None | None | — | — | green | 56/65 |  | 0 / 0 | 1 | — | throttled 0%, server peak 18 GB |
| 11 | Sketch freehand with a pen | DONE | 46.4 | None | None | None | — | — | red | 61/70 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |
| 12 | Drop images onto the board | DONE | 14.8 | None | None | None | — | — | red | 62/75 |  | 0 / 2 | 1 | — | throttled 0%, server peak 17 GB |

**Totals:** 11 stories, 986 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 7/11, final acceptance 62/75, stalled 0, partial 0, 28771 lines in src+tests.

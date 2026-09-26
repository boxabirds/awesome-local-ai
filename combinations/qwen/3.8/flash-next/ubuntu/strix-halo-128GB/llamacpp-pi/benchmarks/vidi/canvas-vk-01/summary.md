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
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 74.6 | None | None | None | — | — | red | 48/51 |  | 0 / 0 | 1 | — | throttled 0%, server peak 37 GB |
| 9 | Write free text anywhere on the board | DONE | 119.8 | None | None | None | — | — | red | 52/57 |  | 0 / 0 | 2 | — | throttled 0%, server peak 38 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | PARTIAL (red) | 239.0 | None | None | None | — | — | red | 58/65 |  | 0 / 5 | 5 | — | throttled 0%, server peak 38 GB |
| 11 | Sketch freehand with a pen | DONE, on partial 10 | 68.6 | None | None | None | — | — | red | 62/70 |  | 0 / 0 | 1 | — | throttled 0%, server peak 38 GB |

**Totals:** 10 stories, 1310 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/10, final acceptance 62/70, stalled 0, partial 1, 25063 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 10 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **red**: gate red, tasks not verified [7, 8, 9, 10, 11, 12, 13, 14, 15] (implementation: [8, 10, 11, 12, 13]), held-out 6/8 (floor 0.625).
- Story 11, built on partial 10: held-out tests on the partial base 10/13; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

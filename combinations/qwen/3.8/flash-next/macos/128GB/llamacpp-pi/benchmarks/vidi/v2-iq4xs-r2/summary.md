# Vidi run — qwen/3.8/flash-next/macos/128GB/llamacpp-pi

Model `qwen3.8-flash-next`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 5/6 | 0 | 0 | 5/6 |
| 2 | 5/10 | 0 | 0 | 13/20 |
| 3 | 4/7 | 0 | 0 | 17/27 |
| 4 | 4/4 | 0 | 0 | 21/31 |
| 5 | 5/5 | 0 | 0 | 26/36 |

**New work** 23/32, **regressions** 0, **repairs** 0, **cumulative** 26/36.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 21.2 | None | None | None | — | — | red | 5/6 |  | 0 / 1 | 0 | — | throttled 93%, server peak 80 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 114.1 | None | None | None | — | — | red | 13/20 |  | 0 / 0 | 2 | — | throttled 98%, server peak 86 GB |
| 3 | See other people's edits appear live on the same board | DONE | 126.0 | None | None | None | — | — | red | 17/27 |  | 0 / 0 | 3 | — | throttled 96%, server peak 88 GB |
| 4 | Return to a board and find everything as it was left | DONE | 174.2 | None | None | None | — | — | red | 21/31 |  | 0 / 0 | 4 | — | throttled 96%, server peak 88 GB |
| 5 | Share a board with others using a link | PARTIAL (red) | 149.7 | None | None | None | — | — | red | 26/36 |  | 0 / 1 | 3 | — | throttled 80%, server peak 88 GB |

**Totals:** 5 stories, 585 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/5, final acceptance 26/36, stalled 0, partial 1, 15075 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 5 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [2, 4, 5, 7] (implementation: [2, 4, 5]), held-out 5/5 (floor 0.0).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7590 / 1 | `BoardViewport.tsx` (262), `useCamera.ts` (128), `camera.ts` (113), `ZoomControls.tsx` (93), `package.json` (35), `NOTES.md` (33), +17 more |
| 2 | 1 by the agent | 4155 / 21 | `StickyNote.tsx` (368), `board-model.ts` (231), `StickyTextEditor.tsx` (220), `sticky-text.ts` (150), `App.tsx` (142), `BoardViewport.tsx` (100), +8 more |
| 3 | 1 by the agent | 3965 / 35 | `board-room.ts` (182), `NOTES.md` (132), `protocol.ts` (121), `connectBoard.ts` (103), `ConnectionStatus.tsx` (58), `App.tsx` (54), +15 more |
| 4 | 1 by the agent | 3915 / 128 | `board-store.ts` (553), `board-room.ts` (394), `NOTES.md` (125), `room-state.ts` (108), `test-hooks.ts` (46), `connectBoard.ts` (40), +15 more |
| 5 | 1 by the agent | 3568 / 88 | `SharePanel.tsx` (238), `BoardPage.tsx` (117), `HomePage.tsx` (108), `NOTES.md` (107), `board-store.ts` (99), `index.ts` (92), +16 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

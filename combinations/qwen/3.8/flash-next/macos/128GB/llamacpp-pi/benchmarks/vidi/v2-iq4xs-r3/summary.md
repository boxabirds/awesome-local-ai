# Vidi run — qwen/3.8/flash-next/macos/128GB/llamacpp-pi

Model `qwen3.8-flash-next`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 5/7 | 0 | 0 | 25/27 |
| 4 | 4/4 | 0 | 0 | 29/31 |

**New work** 25/27, **regressions** 0, **repairs** 0, **cumulative** 29/31.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 109.7 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 92%, server peak 84 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 107.4 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 2 | — | throttled 98%, server peak 88 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (amber) | 240.0 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 6 | — | throttled 96%, server peak 88 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (red), on partial 3 | 240.0 | None | None | None | — | — | red | 29/31 |  | 0 / 0 | 5 | — | throttled 93%, server peak 88 GB |

**Totals:** 4 stories, 697 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/4, final acceptance 29/31, stalled 0, partial 2, 13688 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 5/7 (floor 0.571).
- **Story 4 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [2, 3, 4, 5, 7, 9] (implementation: [2, 4, 7]), held-out 4/4 (floor 0.25).
- Story 4, built on partial 3: held-out tests on the partial base 9/11; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 7119 / 52 | `camera.ts` (257), `BoardViewport.tsx` (223), `useCamera.ts` (218), `styles.css` (186), `NOTES.md` (150), `ZoomControls.tsx` (76), +15 more |
| 2 | 5 by the agent | 4500 / 74 | `StickyNote.tsx` (424), `board-model.ts` (350), `styles.css` (216), `StickyText.ts` (171), `StickyTextEditor.tsx` (117), `App.tsx` (116), +9 more |
| 3 | 1 by the agent, + harness snapshot | 3655 / 95 | `board-room.ts` (262), `connectBoard.ts` (163), `index.ts` (128), `board-id.ts` (112), `protocol.ts` (91), `App.tsx` (67), +12 more |
| 4 | 7 by the agent, + harness snapshot | 3289 / 244 | `board-room.ts` (465), `board-store.ts` (368), `room-state.ts` (125), `matrix-config.mjs` (55), `NOTES.md` (52), `connectBoard.ts` (42), +14 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 0 | 0 | 30/31 |

**New work** 26/27, **regressions** 0, **repairs** 0, **cumulative** 30/31.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 32.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 80.0 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 2 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 160.1 | None | None | None | — | — | green | 26/27 |  | 2 / 0 | 3 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | DONE | 158.8 | None | None | None | — | — | green | 30/31 |  | 0 / 0 | 5 | — | throttled 0%, server peak 0 GB |

**Totals:** 4 stories, 431 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/4, final acceptance 30/31, stalled 0, partial 0, 12474 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 7220 / 45 | `BoardViewport.tsx` (241), `camera.ts` (171), `useCamera.ts` (159), `styles.css` (140), `ZoomControls.tsx` (55), `playwright.config.ts` (49), +15 more |
| 2 | 6 by the agent | 4248 / 110 | `StickyNote.tsx` (328), `board-model.ts` (294), `StickyText.ts` (240), `styles.css` (230), `App.tsx` (144), `StickyTextEditor.tsx` (144), +10 more |
| 3 | 5 by the agent | 4187 / 56 | `board-room.ts` (198), `protocol.ts` (125), `NOTES.md` (113), `connectBoard.ts` (108), `App.tsx` (89), `index.ts` (54), +12 more |
| 4 | 1 by the agent | 3973 / 85 | `board-store.ts` (485), `board-room.ts` (465), `NOTES.md` (126), `room-state.ts` (111), `test-hooks.ts` (50), `connectBoard.ts` (43), +11 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

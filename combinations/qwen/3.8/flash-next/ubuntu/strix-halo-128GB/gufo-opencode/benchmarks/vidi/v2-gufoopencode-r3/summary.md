# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-opencode

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client opencode 1.18.30, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 5/7 | 0 | 0 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |

**New work** 24/27, **regressions** 0, **repairs** 0, **cumulative** 28/31.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 51.4 | None | None | None | — | — | green | 6/6 |  | 1 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 50.4 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 91.8 | None | None | None | — | — | red | 24/27 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 4 | Return to a board and find everything as it was left | DONE | 164.9 | None | None | None | — | — | green | 28/31 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |

**Totals:** 4 stories, 358 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/4, final acceptance 28/31, stalled 0, partial 0, 8226 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 5563 / 57 | `useCamera.ts` (167), `BoardViewport.tsx` (149), `camera.ts` (135), `index.css` (108), `playwright.config.ts` (94), `App.tsx` (69), +14 more |
| 2 | 8 by the agent | 2333 / 90 | `StickyNote.tsx` (234), `board-model.ts` (220), `index.css` (172), `StickyText.ts` (115), `App.tsx` (112), `StickyTextEditor.tsx` (101), +11 more |
| 3 | 6 by the agent | 3646 / 61 | `board-room.ts` (148), `connectBoard.ts` (118), `NOTES.md` (65), `protocol.ts` (61), `board-id.ts` (37), `index.ts` (35), +12 more |
| 4 | 1 by the agent | 2751 / 125 | `board-store.ts` (392), `board-room.ts` (316), `room-state.ts` (97), `NOTES.md` (75), `test-hooks.ts` (44), `connectBoard.ts` (35), +14 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

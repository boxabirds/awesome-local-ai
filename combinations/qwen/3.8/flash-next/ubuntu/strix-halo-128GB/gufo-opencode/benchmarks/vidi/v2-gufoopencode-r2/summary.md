# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-opencode

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client opencode 1.18.30, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 18/20 |
| 3 | 5/7 | 0 | 0 | 23/27 |
| 4 | 4/4 | 0 | 0 | 27/31 |

**New work** 23/27, **regressions** 0, **repairs** 0, **cumulative** 27/31.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 52.5 | None | None | None | — | — | green | 6/6 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 45.0 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 139.0 | None | None | None | — | — | green | 23/27 |  | 1 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 4 | Return to a board and find everything as it was left | DONE | 107.5 | None | None | None | — | — | green | 27/31 |  | 1 / 0 | 0 | — | throttled 0%, server peak 17 GB |

**Totals:** 4 stories, 344 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/4, final acceptance 27/31, stalled 0, partial 0, 7879 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 6203 / 50 | `BoardViewport.tsx` (202), `styles.css` (152), `camera.ts` (139), `useCamera.ts` (136), `ZoomControls.tsx` (61), `NOTES.md` (55), +14 more |
| 2 | 1 by the agent | 2293 / 22 | `StickyNote.tsx` (229), `styles.css` (191), `board-model.ts` (162), `StickyTextEditor.tsx` (109), `App.tsx` (95), `StickyText.ts` (85), +10 more |
| 3 | 7 by the agent | 3802 / 65 | `board-room.ts` (147), `connectBoard.ts` (96), `protocol.ts` (73), `NOTES.md` (56), `playwright.nightly.config.ts` (42), `vitest.config.ts` (40), +19 more |
| 4 | 1 by the agent | 2484 / 77 | `board-room.ts` (297), `board-store.ts` (236), `room-state.ts` (83), `NOTES.md` (63), `seedBoard.ts` (63), `connectBoard.ts` (35), +16 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

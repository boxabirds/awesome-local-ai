# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 5/7 | 0 | 0 | 25/27 |
| 4 | 4/4 | 0 | 0 | 29/31 |
| 5 | 5/5 | 0 | 0 | 34/36 |
| 7 | 8/8 | 0 | 0 | 42/44 |

**New work** 38/40, **regressions** 0, **repairs** 0, **cumulative** 42/44.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 63.6 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 75%, server peak 91 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 73.7 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 2 | — | throttled 99%, server peak 94 GB |
| 3 | See other people's edits appear live on the same board | DONE | 104.2 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 3 | — | throttled 86%, server peak 94 GB |
| 4 | Return to a board and find everything as it was left | DONE | 218.5 | None | None | None | — | — | green | 29/31 |  | 0 / 3 | 5 | — | throttled 62%, server peak 85 GB |
| 5 | Share a board with others using a link | DONE | 90.6 | None | None | None | — | — | green | 34/36 |  | 0 / 0 | 4 | — | throttled 88%, server peak 94 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 136.1 | None | None | None | — | — | green | 42/44 |  | 0 / 0 | 5 | — | throttled 98%, server peak 94 GB |

**Totals:** 6 stories, 687 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 6/6, final acceptance 42/44, stalled 0, partial 0, 19637 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6681 / 0 | `BoardViewport.tsx` (222), `useCamera.ts` (180), `NOTES.md` (166), `styles.css` (161), `camera.ts` (134), `ZoomControls.tsx` (72), +15 more |
| 2 | 1 by the agent | 3991 / 36 | `StickyNote.tsx` (312), `board-model.ts` (279), `styles.css` (193), `StickyTextEditor.tsx` (182), `App.tsx` (124), `StickyText.ts` (123), +8 more |
| 3 | 9 by the agent | 3918 / 173 | `connectBoard.ts` (213), `board-room.ts` (151), `testHooks.ts` (107), `NOTES.md` (87), `protocol.ts` (87), `App.tsx` (59), +15 more |
| 4 | 6 by the agent | 4357 / 194 | `board-room.ts` (496), `board-store.ts` (374), `NOTES.md` (176), `test-hooks.ts` (134), `room-state.ts` (96), `testHooks.ts` (77), +14 more |
| 5 | 1 by the agent | 3263 / 264 | `BoardPage.tsx` (290), `App.tsx` (230), `styles.css` (192), `SharePanel.tsx` (170), `NOTES.md` (159), `board-store.ts` (113), +11 more |
| 7 | 1 by the agent | 3868 / 156 | `useTransformGesture.ts` (395), `board-model.ts` (290), `geometry.ts` (275), `useSelection.ts` (224), `BoardPage.tsx` (171), `NOTES.md` (154), +10 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

**2 restart (no intervention logged); 12 min dead in total.**

| Story | When (UTC) | Down for | Kind | Logged cause |
|---|---|---|---|---|
| 4 | 30 Sep 21:24 | 8 min | restart (no intervention logged) | — |
| 4 | 30 Sep 21:56 | 3 min | restart (no intervention logged) | — |

| Story | Active | Dead | Recorded |
|---|---|---|---|
| 4 | 229 min | 12 min | 219 min |

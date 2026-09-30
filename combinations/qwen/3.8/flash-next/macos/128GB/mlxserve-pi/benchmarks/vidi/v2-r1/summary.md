# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 7/10 | 0 | 0 | 17/20 |
| 3 | 4/7 | 0 | 0 | 21/27 |

**New work** 17/23, **regressions** 0, **repairs** 0, **cumulative** 21/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 44.6 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 75%, server peak 90 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 49.4 | None | None | None | — | — | green | 17/20 |  | 0 / 0 | 1 | — | throttled 98%, server peak 94 GB |
| 3 | See other people's edits appear live on the same board | DONE | 161.9 | None | None | None | — | — | green | 21/27 |  | 0 / 0 | 5 | — | throttled 78%, server peak 94 GB |

**Totals:** 3 stories, 256 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 21/27, stalled 0, partial 0, 8934 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 7173 / 31 | `BoardViewport.tsx` (349), `useCamera.ts` (174), `camera.ts` (164), `ZoomControls.tsx` (88), `NOTES.md` (84), `playwright.config.ts` (60), +14 more |
| 2 | 7 by the agent | 2687 / 89 | `StickyNote.tsx` (296), `board-model.ts` (268), `StickyTextEditor.tsx` (200), `App.tsx` (196), `StickyText.ts` (166), `NoteToolbar.tsx` (81), +8 more |
| 3 | 5 by the agent | 5446 / 72 | `board-room.ts` (184), `connectBoard.ts` (177), `index.ts` (139), `protocol.ts` (114), `App.tsx` (65), `ConnectionStatus.tsx` (60), +11 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

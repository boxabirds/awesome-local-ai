# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 18/20 |

**New work** 14/16, **regressions** 0, **repairs** 0, **cumulative** 18/20.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 28.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 91%, server peak 89 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 37.4 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 1 | — | throttled 95%, server peak 94 GB |

**Totals:** 2 stories, 66 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/2, final acceptance 18/20, stalled 0, partial 0, 4291 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 6614 / 56 | `BoardViewport.tsx` (297), `camera.ts` (186), `useCamera.ts` (176), `ZoomControls.tsx` (108), `NOTES.md` (85), `App.tsx` (81), +15 more |
| 2 | 6 by the agent | 2719 / 88 | `board-model.ts` (290), `StickyNote.tsx` (260), `StickyTextEditor.tsx` (175), `StickyText.ts` (163), `App.tsx` (124), `NoteToolbar.tsx` (96), +9 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

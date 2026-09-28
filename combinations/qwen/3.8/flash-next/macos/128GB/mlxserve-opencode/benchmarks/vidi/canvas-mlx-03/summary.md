# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-opencode

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 19/20 |

**New work** 16/16, **regressions** 0, **repairs** 0, **cumulative** 19/20.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.4 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 75%, server peak 81 GB |
| 2 | Capture ideas on sticky notes and rearrange them | PARTIAL (amber) | 53.0 | None | None | None | — | — | green | 19/20 |  | 0 / 5 | 1 | — | throttled 89%, server peak 91 GB |

**Totals:** 2 stories, 87 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/2, final acceptance 19/20, stalled 0, partial 1, 3596 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 2 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **amber**: gate green, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8] (implementation: [2, 4, 5, 6]), held-out 10/10 (floor 0.0).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7691 / 0 | `BoardViewport.tsx` (198), `useCamera.ts` (173), `camera.ts` (129), `ZoomControls.tsx` (95), `NOTES.md` (83), `App.tsx` (52), +14 more |
| 2 | harness snapshot (agent left work uncommitted) | 2201 / 13 | `StickyNote.tsx` (304), `board-model.ts` (186), `App.tsx` (152), `StickyTextEditor.tsx` (140), `StickyText.ts` (100), `NoteToolbar.tsx` (87), +8 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

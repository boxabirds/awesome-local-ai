# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |

**New work** 16/16, **regressions** 0, **repairs** 0, **cumulative** 20/20.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 62.5 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 82%, server peak 91 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 62.0 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 2 | — | throttled 80%, server peak 93 GB |

**Totals:** 2 stories, 125 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/2, final acceptance 20/20, stalled 0, partial 0, 7564 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 7047 / 36 | `useCamera.ts` (325), `BoardViewport.tsx` (203), `styles.css` (182), `camera.ts` (160), `NOTES.md` (111), `ZoomControls.tsx` (67), +14 more |
| 2 | 5 by the agent | 4671 / 61 | `board-model.ts` (340), `StickyNote.tsx` (338), `styles.css` (219), `StickyText.ts` (162), `StickyTextEditor.tsx` (160), `App.tsx` (138), +10 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

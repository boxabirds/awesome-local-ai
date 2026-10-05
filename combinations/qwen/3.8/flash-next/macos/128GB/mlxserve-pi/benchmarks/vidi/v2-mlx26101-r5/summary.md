# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |

**New work** 15/16, **regressions** 0, **repairs** 0, **cumulative** 19/20.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.6 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 93%, server peak 91 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 69.3 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 3 | — | throttled 99%, server peak 93 GB |

**Totals:** 2 stories, 104 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/2, final acceptance 19/20, stalled 0, partial 0, 6572 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6329 / 7 | `BoardViewport.tsx` (224), `useCamera.ts` (210), `styles.css` (174), `NOTES.md` (140), `camera.ts` (113), `ZoomControls.tsx` (72), +15 more |
| 2 | 1 by the agent | 4409 / 26 | `StickyNote.tsx` (365), `styles.css` (207), `board-model.ts` (196), `StickyTextEditor.tsx` (167), `NOTES.md` (161), `App.tsx` (147), +9 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 5/6 | 0 | 0 | 5/6 |
| 2 | 0/10 | 5 | 0 | 0/20 |

**New work** 5/16, **regressions** 5, **repairs** 0, **cumulative** 0/20.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 8.1 | None | None | None | — | — | green | 5/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 20.0 | None | None | None | — | — | red | 0/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |

**Totals:** 2 stories, 28 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/2, final acceptance 0/20, stalled 0, partial 0, 3680 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 6565 / 127 | `BoardViewport.tsx` (334), `useCamera.ts` (200), `camera.ts` (134), `ZoomControls.tsx` (96), `App.tsx` (64), `package.json` (31), +15 more |
| 2 | 1 by the agent | 2244 / 10 | `StickyNote.tsx` (191), `board-model.ts` (170), `StickyTextEditor.tsx` (116), `App.tsx` (87), `StickyText.ts` (72), `NoteToolbar.tsx` (68), +6 more |

### Earlier stories broken or fixed

- **Story 2 broke 5, fixed 0** earlier held-out tests (story 2: Capture ideas on sticky notes and rearrange them). Source files it changed most: `StickyNote.tsx` (191), `board-model.ts` (170), `StickyTextEditor.tsx` (116), `App.tsx` (87), `StickyText.ts` (72), `NoteToolbar.tsx` (68), +6 more.
  - story 1: 5/6 → 0/10; broke 5.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

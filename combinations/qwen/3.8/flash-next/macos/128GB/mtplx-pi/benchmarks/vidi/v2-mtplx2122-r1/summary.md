# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-pi

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 0/6 | 0 | 0 | 0/6 |
| 2 | 0/10 | 0 | 0 | 0/20 |

**New work** 0/16, **regressions** 0, **repairs** 0, **cumulative** 0/20.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 64.5 | 203 | 13105182 | 238208 | 0.5 | 72.0 | green | 0/6 |  | 0 / 1 | 3 | 117165 | throttled 97%, server peak 96 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 66.9 | 192 | 13266009 | 241018 | 0.8 | 76.2 | green | 0/20 |  | 2 / 1 | 4 | 126991 | throttled 95%, server peak 97 GB |

**Totals:** 2 stories, 131 agent-minutes, 395 requests, 26,371,191 prompt / 479,226 completion tokens, gate green 2/2, final acceptance 0/20, stalled 0, partial 0, 4826 lines in src+tests.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 10 | 91.1 |
| 16-32k | 39 | 81.2 |
| 32-64k | 152 | 72.3 |
| 64-100k | 118 | 72.3 |
| 100-+k | 76 | 74.9 |

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 8265 / 8 | `App.tsx` (184), `BoardViewport.tsx` (177), `useCamera.ts` (145), `camera.ts` (104), `ZoomControls.tsx` (98), `playwright.config.ts` (62), +14 more |
| 2 | 1 by the agent | 2921 / 114 | `App.tsx` (287), `StickyNote.tsx` (276), `StickyTextEditor.tsx` (189), `board-model.ts` (178), `BoardViewport.tsx` (108), `StickyText.ts` (92), +8 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

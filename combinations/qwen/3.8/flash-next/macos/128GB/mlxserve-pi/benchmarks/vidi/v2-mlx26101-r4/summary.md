# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 18/20 |
| 3 | 6/7 | 0 | 0 | 24/27 |

**New work** 20/23, **regressions** 0, **repairs** 0, **cumulative** 24/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 70.0 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 91%, server peak 92 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 79.9 | None | None | None | — | — | green | 18/20 |  | 0 / 1 | 3 | — | throttled 92%, server peak 94 GB |
| 3 | See other people's edits appear live on the same board | DONE | 139.7 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 6 | — | throttled 80%, server peak 94 GB |

**Totals:** 3 stories, 290 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 24/27, stalled 0, partial 0, 11982 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 7050 / 49 | `cameraStore.ts` (279), `styles.css` (178), `BoardViewport.tsx` (175), `NOTES.md` (164), `playwright.config.ts` (157), `camera.ts` (157), +15 more |
| 2 | 4 by the agent | 4820 / 129 | `board-model.ts` (362), `StickyNote.tsx` (358), `styles.css` (240), `StickyTextEditor.tsx` (175), `StickyText.ts` (157), `App.tsx` (123), +11 more |
| 3 | 1 by the agent | 5948 / 146 | `board-room.ts` (221), `StickyTextEditor.tsx` (178), `connectBoard.ts` (175), `NOTES.md` (166), `useBoardDoc.ts` (88), `protocol.ts` (87), +15 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

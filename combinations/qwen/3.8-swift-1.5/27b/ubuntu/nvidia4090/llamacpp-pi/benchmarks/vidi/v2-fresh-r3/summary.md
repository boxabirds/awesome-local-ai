# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 5/7 | 0 | 0 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |

**New work** 24/27, **regressions** 0, **repairs** 0, **cumulative** 28/31.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 8.5 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 27.0 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 48.1 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 23 GB |
| 4 | Return to a board and find everything as it was left | DONE | 105.2 | None | None | None | — | — | green | 28/31 |  | 1 / 0 | 4 | — | throttled 0%, server peak 25 GB |

**Totals:** 4 stories, 189 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/4, final acceptance 28/31, stalled 0, partial 0, 7262 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6258 / 7 | `BoardViewport.tsx` (243), `useCamera.ts` (117), `camera.ts` (114), `ZoomControls.tsx` (98), `package.json` (31), `NavigationHint.tsx` (31), +14 more |
| 2 | 3 by the agent | 2444 / 61 | `StickyNote.tsx` (269), `board-model.ts` (221), `StickyTextEditor.tsx` (174), `StickyText.ts` (96), `App.tsx` (94), `NoteToolbar.tsx` (83), +9 more |
| 3 | 1 by the agent | 3302 / 228 | `board-room.ts` (157), `connectBoard.ts` (104), `cloudflare-workers.d.ts` (94), `protocol.ts` (60), `ConnectionStatus.tsx` (55), `App.tsx` (52), +11 more |
| 4 | 4 by the agent | 1890 / 114 | `board-room.ts` (315), `board-store.ts` (306), `room-state.ts` (73), `cloudflare-workers.d.ts` (42), `PROGRESS.md` (18), `App.tsx` (14), +4 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

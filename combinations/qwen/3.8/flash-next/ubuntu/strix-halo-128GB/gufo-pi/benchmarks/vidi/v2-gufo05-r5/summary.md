# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 6/7 | 0 | 1 | 26/27 |

**New work** 21/23, **regressions** 0, **repairs** 1, **cumulative** 26/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 58.3 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 52.7 | None | None | None | — | — | green | 19/20 |  | 0 / 1 | 1 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 194.2 | None | None | None | — | — | green | 26/27 |  | 0 / 1 | 5 | — | throttled 0%, server peak 0 GB |

**Totals:** 3 stories, 305 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 26/27, stalled 0, partial 0, 9711 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6534 / 44 | `BoardViewport.tsx` (239), `camera.ts` (172), `styles.css` (172), `useCamera.ts` (149), `playwright.config.ts` (136), `NOTES.md` (129), +16 more |
| 2 | 4 by the agent | 3711 / 79 | `board-model.ts` (317), `StickyNote.tsx` (300), `styles.css` (176), `StickyTextEditor.tsx` (159), `StickyText.ts` (150), `App.tsx` (143), +11 more |
| 3 | 4 by the agent | 21291 / 220 | `worker-configuration.d.ts` (16189), `board-room.ts` (235), `connectBoard.ts` (213), `protocol.ts` (148), `NOTES.md` (127), `index.ts` (84), +16 more |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 1** earlier held-out tests (story 3: See other people's edits appear live on the same board; story 3: BoardRoom relays Yjs sync and awareness; integration tests for routing and the room; story 3 task 2: Worker entry, board ids, protocol decode, workers integration test project; story 3 task 1: board id and protocol decode unit tests red phase (TC-01 to TC-03)). Source files it changed most: `worker-configuration.d.ts` (16189), `board-room.ts` (235), `connectBoard.ts` (213), `protocol.ts` (148), `NOTES.md` (127), `index.ts` (84), +16 more.
  - story 2: 9/10 → 10/10; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-pi

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 0/6 | 0 | 0 | 0/6 |
| 2 | 0/10 | 0 | 0 | 0/20 |
| 3 | 5/7 | 0 | 19 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |
| 5 | 0/5 | 28 | 0 | 0/36 |
| 7 | 0/8 | 0 | 0 | 0/44 |

**New work** 9/40, **regressions** 28, **repairs** 19, **cumulative** 0/44.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 64.5 | 203 | 13105182 | 238208 | 0.5 | 72.0 | green | 0/6 |  | 0 / 1 | 3 | 117165 | throttled 97%, server peak 96 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 66.9 | 192 | 13266009 | 241018 | 0.8 | 76.2 | green | 0/20 |  | 2 / 1 | 4 | 126991 | throttled 95%, server peak 97 GB |
| 3 | See other people's edits appear live on the same board | DONE | 110.3 | 434 | 30108133 | 334218 | 0.8 | 70.3 | green | 24/27 |  | 3 / 0 | 5 | 120006 | throttled 88%, server peak 100 GB |
| 4 | Return to a board and find everything as it was left | DONE | 50.2 | 147 | 9446153 | 161704 | 1.3 | 70.5 | green | 28/31 |  | 3 / 0 (ended in error) | 2 | 115795 | throttled 91%, server peak 101 GB |
| 5 | Share a board with others using a link | DONE | 27.8 | 91 | 5316692 | 84288 | 1.4 | 75.7 | red | 0/36 |  | 3 / 0 (ended in error) | 2 | 117074 | throttled 80%, server peak 102 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 10.8 | 33 | 1559200 | 33096 | 1.9 | 85.2 | red | 0/44 |  | 3 / 0 (ended in error) | 0 | 91415 | throttled 70%, server peak 102 GB |

**Totals:** 6 stories, 330 agent-minutes, 1100 requests, 72,801,369 prompt / 1,092,532 completion tokens, gate green 4/6, final acceptance 0/44, stalled 0, partial 0, 11403 lines in src+tests.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 46 | 83.2 |
| 16-32k | 99 | 84.7 |
| 32-64k | 397 | 73.8 |
| 64-100k | 382 | 67.6 |
| 100-+k | 176 | 70.3 |

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 8265 / 8 | `App.tsx` (184), `BoardViewport.tsx` (177), `useCamera.ts` (145), `camera.ts` (104), `ZoomControls.tsx` (98), `playwright.config.ts` (62), +14 more |
| 2 | 1 by the agent | 2921 / 114 | `App.tsx` (287), `StickyNote.tsx` (276), `StickyTextEditor.tsx` (189), `board-model.ts` (178), `BoardViewport.tsx` (108), `StickyText.ts` (92), +8 more |
| 3 | 1 by the agent | 5797 / 43 | `board-room.ts` (197), `connectBoard.ts` (128), `protocol.ts` (122), `e2e-server.mjs` (85), `index.ts` (78), `workers-env.d.ts` (70), +12 more |
| 4 | harness snapshot (agent left work uncommitted) | 1814 / 79 | `board-store.ts` (332), `board-room.ts` (285), `room-state.ts` (86), `NOTES.md` (36), `probe9.mjs` (22), `config.ts` (17), +3 more |
| 5 | harness snapshot (agent left work uncommitted) | 668 / 16 | `board-store.ts` (113), `index.ts` (108), `create-board.ts` (74), `board-room.ts` (63), `test-hooks.ts` (61), `rpc-spike.mjs` (57), +1 more |
| 7 | — | 0 / 0 | — |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 19** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `board-room.ts` (197), `connectBoard.ts` (128), `protocol.ts` (122), `e2e-server.mjs` (85), `index.ts` (78), `workers-env.d.ts` (70), +12 more.
  - story 1: 0/10 → 10/10; fixed 10
  - story 2: 0/10 → 9/10; fixed 9
- **Story 5 broke 28, fixed 0** earlier held-out tests (harness: snapshot after story 5 (uncommitted agent work)). Source files it changed most: `board-store.ts` (113), `index.ts` (108), `create-board.ts` (74), `board-room.ts` (63), `test-hooks.ts` (61), `rpc-spike.mjs` (57), +1 more.
  - story 1: 10/10 → 0/10; broke 10.
  - story 2: 9/10 → 0/10; broke 9.
  - story 3: 5/7 → 0/7; broke 5.
  - story 4: 4/4 → 0/4; broke 4.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

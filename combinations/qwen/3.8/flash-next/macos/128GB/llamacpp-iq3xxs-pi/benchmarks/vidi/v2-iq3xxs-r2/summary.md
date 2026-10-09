# Vidi run — qwen/3.8/flash-next/macos/128GB/llamacpp-iq3xxs-pi

Model `qwen3.8-flash-next-iq3xxs`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 1 | 0 | 29/31 |

**New work** 26/27, **regressions** 1, **repairs** 0, **cumulative** 29/31.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 132.3 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 61%, server peak 73 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 96.9 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 2 | — | throttled 99%, server peak 73 GB |
| 3 | See other people's edits appear live on the same board | DONE | 204.2 | None | None | None | — | — | green | 26/27 |  | 0 / 1 | 4 | — | throttled 78%, server peak 79 GB |
| 4 | Return to a board and find everything as it was left | DONE | 208.7 | None | None | None | — | — | green | 29/31 |  | 0 / 0 | 4 | — | throttled 83%, server peak 79 GB |

**Totals:** 4 stories, 642 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/4, final acceptance 29/31, stalled 0, partial 0, 13108 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6672 / 88 | `BoardViewport.tsx` (231), `useCamera.ts` (228), `camera.ts` (192), `styles.css` (139), `NOTES.md` (104), `playwright.config.ts` (99), +15 more |
| 2 | 4 by the agent | 3998 / 128 | `StickyNote.tsx` (423), `board-model.ts` (322), `styles.css` (171), `StickyText.ts` (169), `StickyTextEditor.tsx` (132), `App.tsx` (123), +10 more |
| 3 | 5 by the agent | 5543 / 218 | `board-room.ts` (261), `PROGRESS.md` (146), `protocol.ts` (95), `StickyText.ts` (91), `connectBoard.ts` (90), `index.ts` (66), +16 more |
| 4 | 6 by the agent | 3347 / 193 | `board-room.ts` (459), `board-store.ts` (412), `BoardSocket.ts` (297), `connectBoard.ts` (139), `room-state.ts` (102), `NOTES.md` (78), +14 more |

### Earlier stories broken or fixed

- **Story 4 broke 1, fixed 0** earlier held-out tests (story 4: Return to a board and find everything as it was left; story 4 task 7+8: client load-failure state with the red badge; component tests for badge, edit lock and close-code mapping (TC-22, TC-23, TC-28); story 4 task 4+5: persistent hibernating BoardRoom; integration tests for durability, failures and hibernation (TC-12 to TC-18, TC-26); story 4 task 3: BoardStore integration tests on real DO SQLite (TC-03..TC-11, TC-25); probe-doc quarantine and compaction gap guard; story 4 task 2: BoardStore (SQLite schema, append, load with quarantine, chunked compaction); TC-01/TC-02 green; story 4 task 1: unit tests for chunking, compaction threshold and room state machine (TC-01, TC-02, TC-27) with stubs). Source files it changed most: `board-room.ts` (459), `board-store.ts` (412), `BoardSocket.ts` (297), `connectBoard.ts` (139), `room-state.ts` (102), `NOTES.md` (78), +14 more.
  - story 3: 6/7 → 5/7; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

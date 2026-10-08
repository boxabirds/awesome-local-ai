# Vidi run — qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi

Model `qwen3.6-35b-a3b`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 0/10 | 0 | 0 | 6/20 |
| 3 | 0/7 | 6 | 0 | 0/27 |

**New work** 6/23, **regressions** 6, **repairs** 0, **cumulative** 0/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 29.2 | None | None | None | — | — | red | 6/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 34 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 52.8 | None | None | None | — | — | red | 6/20 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 88.3 | None | None | None | — | — | red | 0/27 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |

**Totals:** 3 stories, 170 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/3, final acceptance 0/27, stalled 0, partial 1, 5027 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 0/7 (floor 0.571).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 8471 / 7 | `BoardViewport.tsx` (160), `camera.ts` (112), `ZoomControls.tsx` (103), `useCamera.ts` (88), `App.tsx` (58), `NOTES.md` (37), +13 more |
| 2 | 1 by the agent | 2382 / 31 | `StickyNote.tsx` (313), `board-model.ts` (216), `App.tsx` (152), `StickyTextEditor.tsx` (102), `StickyText.ts` (92), `NoteToolbar.tsx` (83), +8 more |
| 3 | harness snapshot (agent left work uncommitted) | 3184 / 161 | `board-room.ts` (133), `connectBoard.ts` (103), `ConnectionStatus.tsx` (62), `protocol.ts` (59), `index.ts` (47), `board-id.ts` (44), +10 more |

### Earlier stories broken or fixed

- **Story 3 broke 6, fixed 0** earlier held-out tests (harness: snapshot after story 3 (uncommitted agent work)). Source files it changed most: `board-room.ts` (133), `connectBoard.ts` (103), `ConnectionStatus.tsx` (62), `protocol.ts` (59), `index.ts` (47), `board-id.ts` (44), +10 more.
  - story 1: 6/10 → 0/10; broke 6.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

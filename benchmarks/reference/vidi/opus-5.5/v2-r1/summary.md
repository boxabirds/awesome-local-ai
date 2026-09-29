# Vidi run — reference/opus-5.5

Model `claude-opus-5-5`, scope `canvas`, effort `client default`, client claude 2.1.284 (Claude Code), host Apple M2 16GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 0 | 0 | 30/31 |
| 5 | 0/5 | 30 | 0 | 0/36 |
| 7 | 0/8 | 0 | 0 | 0/44 |
| 8 | 0/7 | 0 | 0 | 0/51 |

**New work** 26/47, **regressions** 30, **repairs** 0, **cumulative** 0/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 10.4 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 14.8 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 0 | — | throttled 0% |
| 3 | See other people's edits appear live on the same board | DONE | 22.8 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 0 | — | throttled 0% |
| 4 | Return to a board and find everything as it was left | DONE | 18.1 | None | None | None | — | — | green | 30/31 |  | 0 / 0 | 0 | — | throttled 0% |
| 5 | Share a board with others using a link | DONE | 11.2 | None | None | None | — | — | green | 0/36 |  | 0 / 0 | 0 | — | throttled 0% |
| 7 | Select, move, resize and delete several objects at once | DONE | 16.0 | None | None | None | — | — | green | 0/44 |  | 0 / 0 | 0 | — | throttled 0% |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 7.3 | None | None | None | — | — | green | 0/51 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 7 stories, 101 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 7/7, final acceptance 0/51, stalled 0, partial 0, 29965 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 5634 / 0 | `BoardViewport.tsx` (218), `useCamera.ts` (136), `styles.css` (132), `camera.ts` (79), `ZoomControls.tsx` (43), `package.json` (34), +13 more |
| 2 | 1 by the agent | 2548 / 30 | `StickyNote.tsx` (280), `styles.css` (225), `board-model.ts` (171), `StickyText.ts` (112), `StickyTextEditor.tsx` (102), `App.tsx` (90), +10 more |
| 3 | 1 by the agent | 19559 / 115 | `worker-configuration.d.ts` (16056), `connectBoard.ts` (123), `protocol.ts` (114), `board-room.ts` (102), `App.tsx` (82), `StickyTextEditor.tsx` (64), +16 more |
| 4 | 1 by the agent | 2285 / 116 | `board-store.ts` (239), `board-room.ts` (174), `room-state.ts` (58), `test-hooks.ts` (56), `NOTES.md` (53), `connectBoard.ts` (33), +12 more |
| 5 | 1 by the agent | 1739 / 70 | `styles.css` (161), `SharePanel.tsx` (145), `BoardPage.tsx` (72), `board-store.ts` (53), `router.ts` (51), `index.ts` (50), +16 more |
| 7 | 1 by the agent | 3055 / 368 | `useTransformGesture.ts` (342), `StickyNote.tsx` (289), `board-model.ts` (251), `geometry.ts` (156), `useSelection.ts` (151), `App.tsx` (147), +10 more |
| 8 | 1 by the agent | 1301 / 12 | `undo.ts` (105), `UndoButtons.tsx` (51), `App.tsx` (41), `useBoardKeys.ts` (32), `useUndo.ts` (31), `NOTES.md` (29), +4 more |

### Earlier stories broken or fixed

- **Story 5 broke 30, fixed 0** earlier held-out tests (story 5: Share a board with others using a link). Source files it changed most: `styles.css` (161), `SharePanel.tsx` (145), `BoardPage.tsx` (72), `board-store.ts` (53), `router.ts` (51), `index.ts` (50), +16 more.
  - story 1: 10/10 → 0/10; broke 10.
  - story 2: 10/10 → 0/10; broke 10.
  - story 3: 6/7 → 0/7; broke 6.
  - story 4: 4/4 → 0/4; broke 4.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

# Vidi run — qwen/3.8/flash-next/macos/128GB/llamacpp-pi

Model `qwen3.8-flash-next`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

Setup fallbacks are held-out tests whose setup reached its state by the documented flow after an undocumented alternate flow failed (rule 8); the failure is counted once, as a finding.

| Story | New work | Regressions | Repairs | Cumulative | Setup fallbacks |
|---|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 | 0 |
| 2 | 0/10 | 0 | 0 | 6/20 | 0 |
| 3 | 0/7 | 0 | 0 | 6/27 | 0 |
| 4 | 1/4 | 0 | 0 | 7/31 | 0 |
| 5 | 4/5 | 0 | 0 | 11/36 | 0 |
| 7 | 0/8 | 0 | 0 | 11/44 | 0 |
| 8 | 1/7 | 0 | 0 | 12/51 | 0 |
| 9 | 5/6 | 0 | 0 | 17/57 | 1 |
| 10 | 8/8 | 0 | 0 | 25/65 | 1 |
| 11 | 0/5 | 0 | 0 | 25/70 | 1 |

**New work** 25/66, **regressions** 0, **repairs** 0, **cumulative** 25/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 67.3 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 92%, server peak 85 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 15.9 | None | None | None | — | — | red | 6/20 |  | 3 / 0 (ended in error) | 0 | — | throttled 78%, server peak 85 GB |
| 3 | See other people's edits appear live on the same board | DONE | 39.6 | None | None | None | — | — | red | 6/27 |  | 3 / 0 (ended in error) | 1 | — | throttled 89%, server peak 92 GB |
| 4 | Return to a board and find everything as it was left | DONE | 209.2 | None | None | None | — | — | green | 7/31 |  | 0 / 1 | 5 | — | throttled 98%, server peak 92 GB |
| 5 | Share a board with others using a link | DONE | 139.6 | None | None | None | — | — | green | 11/36 |  | 0 / 0 | 3 | — | throttled 92%, server peak 92 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 59.3 | None | None | None | — | — | green | 11/44 |  | 0 / 1 | 1 | — | throttled 97%, server peak 92 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 146.6 | None | None | None | — | — | green | 12/51 |  | 0 / 1 | 3 | — | throttled 97%, server peak 92 GB |
| 9 | Write free text anywhere on the board | PARTIAL (red) | 65.6 | None | None | None | — | — | red | 17/57 |  | 0 / 1 | 2 | — | throttled 84%, server peak 92 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE, on partial 9 | 149.2 | None | None | None | — | — | red | 25/65 |  | 0 / 0 | 3 | — | throttled 89%, server peak 92 GB |
| 11 | Sketch freehand with a pen | DONE, on partial 9 | 138.9 | None | None | None | — | — | red | 25/70 |  | 0 / 1 | 4 | — | throttled 94%, server peak 92 GB |

**Totals:** 10 stories, 1031 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 5/10, final acceptance 25/70, stalled 0, partial 1, 28222 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 9 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] (implementation: [2, 4, 6, 8]), held-out 5/6 (floor 0.333).
- Story 10, built on partial 9: held-out tests on the partial base 13/14; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 11, built on partial 9: held-out tests on the partial base 13/19; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 7232 / 97 | `useCamera.ts` (285), `NOTES.md` (241), `BoardViewport.tsx` (218), `camera.ts` (198), `styles.css` (167), `ZoomControls.tsx` (53), +16 more |
| 2 | 1 by the agent, + harness snapshot | 1236 / 31 | `board-model.ts` (349), `useBoardDoc.ts` (75), `config.ts` (37), `StickyText.ts` (28), `package.json` (5), `PROGRESS.md` (2) |
| 3 | 1 by the agent, + harness snapshot | 1931 / 10 | `StickyText.ts` (152), `protocol.ts` (100), `board-id.ts` (58), `config.ts` (37), `package.json` (4), `.gitignore` (1), +1 more |
| 4 | 1 by the agent | 5751 / 64 | `board-room.ts` (404), `board-store.ts` (354), `connectBoard.ts` (189), `NOTES.md` (187), `StickyNote.tsx` (184), `useBoardEditing.ts` (176), +23 more |
| 5 | 1 by the agent | 2935 / 275 | `SharePanel.tsx` (172), `styles.css` (151), `index.ts` (134), `BoardPage.tsx` (108), `PROGRESS.md` (98), `board-store.ts` (93), +14 more |
| 7 | 1 by the agent | 3083 / 129 | `useTransformGesture.ts` (331), `board-model.ts` (212), `geometry.ts` (180), `BoardScreen.tsx` (147), `SelectionOverlay.tsx` (133), `useBoardKeys.ts` (131), +9 more |
| 8 | 4 by the agent | 2536 / 212 | `useUndo.ts` (152), `undo.ts` (150), `NOTES.md` (122), `StickyTextEditor.tsx` (99), `BoardScreen.tsx` (62), `useBoardKeys.ts` (60), +7 more |
| 9 | harness snapshot (agent left work uncommitted) | 2575 / 191 | `text.ts` (260), `BoardScreen.tsx` (207), `textLayout.ts` (159), `TextEditor.tsx` (125), `TextObject.tsx` (124), `StickyText.ts` (105), +16 more |
| 10 | 2 by the agent | 5151 / 41 | `connector.ts` (340), `ConnectorTool.tsx` (272), `shape.ts` (272), `ConnectorObject.tsx` (262), `BoardScreen.tsx` (205), `ShapeObject.tsx` (184), +16 more |
| 11 | 1 by the agent | 3975 / 87 | `PenTool.tsx` (316), `stroke.ts` (282), `NOTES.md` (186), `StrokeObject.tsx` (132), `simplify.ts` (129), `navigationGestures.ts` (93), +13 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.

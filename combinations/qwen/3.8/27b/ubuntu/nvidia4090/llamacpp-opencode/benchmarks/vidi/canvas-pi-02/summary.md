# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 50.2 | None | None | None | — | — | green | 5/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 18 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 43.0 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 18 GB |
| 3 | See other people's edits appear live on the same board | DONE | 204.3 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 8 | — | throttled 0%, server peak 18 GB |
| 4 | Return to a board and find everything as it was left | DONE | 230.2 | None | None | None | — | — | red | 28/31 |  | 0 / 0 | 9 | — | throttled 0%, server peak 18 GB |
| 5 | Share a board with others using a link | DONE | 49.1 | None | None | None | — | — | red | 0/36 |  | 0 / 0 | 2 | — | throttled 0%, server peak 18 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 174.0 | None | None | None | — | — | green | 41/44 |  | 0 / 0 | 7 | — | throttled 0%, server peak 18 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 100.9 | None | None | None | — | — | green | 48/51 |  | 0 / 0 | 6 | — | throttled 0%, server peak 18 GB |
| 9 | Write free text anywhere on the board | DONE | 51.5 | None | None | None | — | — | green | 51/57 |  | 0 / 1 | 3 | — | throttled 0%, server peak 18 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 21.4 | None | None | None | — | — | green | 56/65 |  | 0 / 0 | 1 | — | throttled 0%, server peak 18 GB |
| 11 | Sketch freehand with a pen | DONE | 46.4 | None | None | None | — | — | red | 61/70 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |
| 12 | Drop images onto the board | DONE | 14.8 | None | None | None | — | — | red | 62/75 |  | 0 / 2 | 1 | — | throttled 0%, server peak 17 GB |

**Totals:** 11 stories, 986 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 7/11, final acceptance 62/75, stalled 0, partial 0, 28771 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | — | 0 / 0 | — |
| 2 | — | 0 / 0 | — |
| 3 | — | 0 / 0 | — |
| 4 | — | 0 / 0 | — |
| 5 | 1 by the agent | 2460 / 130 | `styles.css` (194), `BoardPage.tsx` (184), `SharePanel.tsx` (164), `App.tsx` (120), `create-board.ts` (93), `board-store.ts` (92), +14 more |
| 7 | 1 by the agent | 3438 / 458 | `useTransformGesture.ts` (330), `StickyNote.tsx` (239), `board-model.ts` (204), `useSelection.ts` (200), `geometry.ts` (166), `Marquee.tsx` (112), +15 more |
| 8 | 1 by the agent | 1635 / 28 | `undo.ts` (117), `UndoButtons.tsx` (66), `NOTES.md` (48), `useUndo.ts` (42), `BoardPage.tsx` (39), `useBoardKeys.ts` (36), +7 more |
| 9 | 1 by the agent | 2504 / 220 | `text.ts` (265), `textLayout.ts` (180), `StickyText.ts` (166), `TextEditor.tsx` (141), `text-edit.ts` (133), `TextObject.tsx` (119), +17 more |
| 10 | 1 by the agent | 2761 / 44 | `connector.ts` (327), `shape.ts` (183), `BoardPage.tsx` (175), `BoardViewport.tsx` (159), `Toolbar.tsx` (135), `ShapeToolbar.tsx` (133), +10 more |
| 11 | 1 by the agent | 2184 / 18 | `PenTool.tsx` (333), `stroke.ts` (190), `simplify.ts` (140), `StrokeObject.tsx` (105), `NOTES.md` (88), `PenToolbar.tsx` (83), +12 more |
| 12 | 2 by the agent | 4600 / 38 | `useImageInsert.ts` (338), `image.ts` (295), `ImageObject.tsx` (277), `cacheManager.ts` (237), `syncTracker.ts` (184), `localBoardStore.ts` (167), +26 more |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 1** earlier held-out tests (no commits). Source files it changed most: —.
  - story 1: 9/10 → 10/10; fixed 1
- **Story 5 broke 28, fixed 0** earlier held-out tests (story 5: Share a board with others using a link). Source files it changed most: `styles.css` (194), `BoardPage.tsx` (184), `SharePanel.tsx` (164), `App.tsx` (120), `create-board.ts` (93), `board-store.ts` (92), +14 more.
  - story 1: 10/10 → 0/10; broke 10: “golden path: controls and hint visible at 100% @ref prd:golden-path”; “zoom buttons step 100 → 125 → 100 @ref prd:zoom.step”; “zoom limits clamp and disable buttons @ref prd:zoom.limits”; “keyboard zoom and reset do not zoom the page @ref prd:zoom.no_page_zoom” …. Most common error: `Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:18787/`
  - story 2: 9/10 → 0/10; broke 9: “double-click creates note centred on the point @ref prd:sticky.create_dblclick”; “toolbar button creates note in view centre @ref prd:sticky.create_button”; “escape and outside click keep typed text; Enter re-edits at end @ref prd:sticky.edit_end”; “pasting over the limit keeps exactly 1000 characters @ref prd:sticky.text_limit” …. Most common error: `Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:18787/`
  - story 3: 5/7 → 0/7; broke 5: “late joiner sees current notes @ref prd:live.join_state”; “boards stay separate @ref prd:live.isolation”; “selection stays personal @ref prd:live.local_selection”; “server restart shows Reconnecting… then Connected, notes kept @ref prd:live.status” …. Most common error: `Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:18787/`
  - story 4: 4/4 → 0/4; broke 4: “board is intact after everyone leaves @ref prd:persist.reopen”; “change seen by another person survives immediate leave + restart @ref prd:persist.seen_is_saved”; “survives restart with nobody connected @ref prd:persist.restart”; “no save button or saved indicator @ref prd:persist.automatic”. Most common error: `Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:18787/`
- **Story 7 broke 0, fixed 33** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (330), `StickyNote.tsx` (239), `board-model.ts` (204), `useSelection.ts` (200), `geometry.ts` (166), `Marquee.tsx` (112), +15 more.
  - story 1: 0/10 → 10/10; fixed 10
  - story 2: 0/10 → 9/10; fixed 9
  - story 3: 0/7 → 5/7; fixed 5
  - story 4: 0/4 → 4/4; fixed 4
  - story 5: 0/5 → 5/5; fixed 5

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

**1 harness crash; 18 min dead in total.**

| Story | When (UTC) | Down for | Kind | Logged cause |
|---|---|---|---|---|
| 12 | 25 Sep 15:59 | 18 min | harness crash | harness crashed at the end of the story (git diff output with a PNG byte decoded strictly; |

| Story | Active | Dead | Recorded |
|---|---|---|---|
| 12 | 53 min | 18 min | 15 min |

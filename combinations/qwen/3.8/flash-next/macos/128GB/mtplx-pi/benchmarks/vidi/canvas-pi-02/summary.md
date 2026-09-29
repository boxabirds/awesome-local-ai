# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-opencode

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 46.1 | 118 | 8577481 | 137733 | 1.2 | 67.5 | green | 6/6 |  | 0 / 0 | 1 | 119758 | throttled 87%, server peak 105 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 77.6 | 205 | 13417999 | 211432 | 1.1 | 59.2 | green | 20/20 |  | 0 / 0 | 3 | 116754 | throttled 99%, server peak 110 GB |
| 3 | See other people's edits appear live on the same board | DONE | 124.0 | 420 | 28827658 | 337899 | 1.3 | 62.4 | green | 20/27 |  | 1 / 0 | 6 | 118458 | throttled 96%, server peak 112 GB |
| 4 | Return to a board and find everything as it was left | DONE | 138.7 | 69 | 5683005 | 35316 | 1.6 | 64.4 | green | 21/31 |  | 0 / 0 | 6 | 112516 | DEGRADED (power) throttled 86%, server peak 115 GB |
| 5 | Share a board with others using a link | PARTIAL (amber) | 389.0 | 1240 | 89064830 | 873403 | 1.6 | 61.7 | green | 34/36 |  | 2 / 20 | 16 | 118520 | throttled 91%, server peak 116 GB |
| 7 | Select, move, resize and delete several objects at once | PARTIAL (amber), on partial 5 | 100.4 | 416 | 28749883 | 196399 | 1.4 | 50.6 | green | 40/44 |  | 0 / 5 | 5 | 116247 | throttled 99%, server peak 109 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | PARTIAL (amber), on partial 5, 7 | 112.0 | 293 | 19348542 | 260709 | 1.4 | 56.7 | green | 47/51 |  | 1 / 5 | 5 | 120382 | throttled 92%, server peak 112 GB |
| 9 | Write free text anywhere on the board | DONE, on partial 5, 7, 8 | 61.3 | 399 | 26227708 | 162154 | 1.1 | 68.6 | green | 53/57 |  | 0 / 1 | 3 | 115031 | throttled 95%, server peak 113 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE, on partial 5, 7, 8 | 25.0 | 161 | 10336834 | 75693 | 1.1 | 70.2 | red | 59/65 |  | 0 / 0 | 1 | 114711 | throttled 94%, server peak 113 GB |
| 11 | Sketch freehand with a pen | DONE, on partial 5, 7, 8 | 96.0 | 92 | 6511067 | 60133 | 1.5 | 49.7 | red | 60/70 |  | 0 / 0 | 4 | 114091 | throttled 97%, server peak 110 GB |
| 12 | Drop images onto the board | DONE, on partial 5, 7, 8 | 51.0 | 166 | 11848676 | 107613 | 2.7 | 53.4 | red | 60/75 |  | 0 / 2 | 23 | 127043 | throttled 82%, server peak 112 GB |

**Totals:** 11 stories, 1221 agent-minutes, 3579 requests, 248,593,683 prompt / 2,458,484 completion tokens, gate green 8/11, final acceptance 60/75, stalled 0, partial 3, 35009 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 5 PARTIAL**, ended by the operator (operator (quintus)): runaway story: ~7.5 h agent time and 20 nudges without committing; operator cut-off at 4 h / 5 nudges adopted 2026-09-25. Verdict **amber**: gate green, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 4, 5]), held-out 5/5 (floor 1.0).
- **Story 7 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **amber**: gate green, tasks not verified [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] (implementation: [2, 8, 10, 11, 12, 13]), held-out 6/8 (floor 1.0).
- Story 7, built on partial 5: held-out tests on the partial base 11/13; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- **Story 8 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **amber**: gate green, tasks not verified [2, 5, 6, 7, 8, 9, 10, 11] (implementation: [2, 8, 10]), held-out 7/7 (floor 1.0).
- Story 8, built on partial 5, 7: held-out tests on the partial base 18/20; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 9, built on partial 5, 7, 8: held-out tests on the partial base 24/26; partial story's tests fixed 1, regressed 0; 0 stub-like lines added to src/.
- Story 10, built on partial 5, 7, 8: held-out tests on the partial base 30/34; partial story's tests fixed 1, regressed 0; 0 stub-like lines added to src/.
- Story 11, built on partial 5, 7, 8: held-out tests on the partial base 31/39; partial story's tests fixed 1, regressed 0; 0 stub-like lines added to src/.
- Story 12, built on partial 5, 7, 8: held-out tests on the partial base 31/44; partial story's tests fixed 1, regressed 0; 17 stub-like lines added to src/.

> Stories 4 ran partly on battery or in Low Power Mode. Their timings are not comparable; re-run them.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 57 | 78.2 |
| 32-64k | 1337 | 63.6 |
| 64-100k | 1407 | 60.9 |
| 100-+k | 614 | 60.3 |
| 16-32k | 164 | 65.5 |

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7336 / 0 | `BoardViewport.tsx` (243), `useCamera.ts` (236), `camera.ts` (140), `styles.css` (133), `ZoomControls.tsx` (73), `playwright.config.ts` (48), +14 more |
| 2 | 1 by the agent | 3960 / 20 | `StickyNote.tsx` (349), `board-model.ts` (227), `App.tsx` (169), `styles.css` (167), `StickyTextEditor.tsx` (147), `NOTES.md` (144), +9 more |
| 3 | 1 by the agent | 5174 / 39 | `connectBoard.ts` (241), `board-room.ts` (215), `boardSession.ts` (171), `protocol.ts` (165), `board-id.ts` (122), `App.tsx` (100), +10 more |
| 4 | 1 by the agent | 1994 / 171 | `board-room.ts` (487), `room-machine.ts` (419), `board-store.ts` (218), `room-state.ts` (169), `board-protocol.ts` (139), `NOTES.md` (95), +2 more |
| 5 | harness snapshot (agent left work uncommitted) | 8891 / 165 | `transport.ts` (423), `Presence.tsx` (366), `NOTES.md` (311), `usePresence.ts` (280), `awareness-tracker.ts` (273), `identity.ts` (266), +27 more |
| 7 | harness snapshot (agent left work uncommitted) | 3275 / 252 | `useTransformGesture.ts` (317), `App.tsx` (307), `board-model.ts` (187), `geometry.ts` (186), `useSelection.ts` (158), `SelectionOverlay.tsx` (128), +8 more |
| 8 | harness snapshot (agent left work uncommitted) | 1803 / 9 | `undo.ts` (145), `useUndo.ts` (122), `UndoButtons.tsx` (77), `StickyTextEditor.tsx` (47), `App.tsx` (31), `useBoardKeys.ts` (31), +6 more |
| 9 | 1 by the agent | 2848 / 188 | `App.tsx` (218), `TextObject.tsx` (212), `TextEditor.tsx` (206), `text.ts` (182), `textLayout.ts` (154), `board-model.ts` (105), +16 more |
| 10 | 1 by the agent | 2961 / 38 | `connector.ts` (291), `ConnectorTool.tsx` (249), `ShapeObject.tsx` (206), `shape.ts` (197), `ShapeTool.tsx` (165), `connector-geometry.ts` (131), +15 more |
| 11 | 1 by the agent | 4197 / 18 | `stroke.ts` (635), `PenTool.tsx` (308), `pen-capture.ts` (285), `stroke-path.ts` (146), `simplify.ts` (106), `testHooks.ts` (104), +14 more |
| 12 | harness snapshot (agent left work uncommitted) | 979 / 4 | `image.ts` (223), `uploader.ts` (161), `assetRegistry.ts` (121), `ImageObject.tsx` (118), `image-format.ts` (99), `image-contract.ts` (98), +5 more |

### Earlier stories broken or fixed

- **Story 5 broke 0, fixed 8** earlier held-out tests (harness: snapshot after story 5 (uncommitted agent work)). Source files it changed most: `transport.ts` (423), `Presence.tsx` (366), `NOTES.md` (311), `usePresence.ts` (280), `awareness-tracker.ts` (273), `identity.ts` (266), +27 more.
  - story 3: 0/7 → 5/7; fixed 5
  - story 4: 1/4 → 4/4; fixed 3
- **Story 9 broke 0, fixed 1** earlier held-out tests (story 9: Write free text anywhere on the board). Source files it changed most: `App.tsx` (218), `TextObject.tsx` (212), `TextEditor.tsx` (206), `text.ts` (182), `textLayout.ts` (154), `board-model.ts` (105), +16 more.
  - story 7: 6/8 → 7/8; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

**1 operator restart, 1 restart (no intervention logged), 1 machine freeze; 50 min dead in total.**

| Story | When (UTC) | Down for | Kind | Logged cause |
|---|---|---|---|---|
| 7 | 25 Sep 20:36 | 2 min | operator restart | harness restarted by the operator. |
| 7 | 25 Sep 20:39 | 2 min | restart (no intervention logged) | — |
| 11 | 26 Sep 03:20 | 46 min | machine freeze | quintus froze (last system log 03:20:22Z, power collector's last rows 03:20:33Z) and the watchdog restarted it at 03:23Z. |

| Story | Active | Dead | Recorded |
|---|---|---|---|
| 7 | 129 min | 4 min | 100 min |
| 11 | 171 min | 46 min | 96 min |

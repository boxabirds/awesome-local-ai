# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-opencode

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.3 | 100 | 5844203 | 96786 | 0.9 | 63.7 | green | 6/6 |  | 0 / 0 | 1 | 115094 | throttled 96%, server peak 108 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 46.7 | 181 | 11185922 | 131257 | 1.0 | 57.0 | green | 19/20 |  | 0 / 0 | 1 | 115221 | throttled 99%, server peak 109 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 165.8 | 383 | 27388627 | 318864 | 1.2 | 67.7 | red | 25/27 |  | 0 / 5 | 6 | 115639 | throttled 56%, server peak 111 GB |
| 4 | Return to a board and find everything as it was left | DONE, on partial 3 | 55.8 | 172 | 11675670 | 147343 | 2.0 | 67.0 | green | 29/31 |  | 3 / 0 (ended in error) | 5 | 115993 | throttled 85%, server peak 100 GB |
| 5 | Share a board with others using a link | DONE, on partial 3 | 100.9 | 372 | 25806362 | 204304 | 1.3 | 72.2 | green | 34/36 |  | 1 / 0 | 5 | 115757 | throttled 60%, server peak 105 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 3 | 149.9 | 431 | 29011734 | 347427 | 1.3 | 67.9 | green | 37/44 |  | 3 / 2 (ended in error) | 11 | 123269 | throttled 72%, server peak 110 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 3 | 62.0 | 155 | 9188329 | 177299 | 1.9 | 71.1 | green | 38/51 |  | 3 / 0 (ended in error) | 4 | 119407 | throttled 85%, server peak 110 GB |
| 9 | Write free text anywhere on the board | DONE, on partial 3 | 159.2 | 418 | 29109980 | 353923 | 1.5 | 65.2 | red | 40/57 |  | 3 / 1 (ended in error) | 8 | 120528 | throttled 78%, server peak 104 GB |

**Totals:** 8 stories, 775 agent-minutes, 2212 requests, 149,210,827 prompt / 1,777,203 completion tokens, gate green 6/8, final acceptance 40/57, stalled 0, partial 1, 17599 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 6/7 (floor 0.0).
- Story 4, built on partial 3: held-out tests on the partial base 10/11; partial story's tests fixed 0, regressed 0; 3 stub-like lines added to src/.
- Story 5, built on partial 3: held-out tests on the partial base 15/16; partial story's tests fixed 0, regressed 0; 6 stub-like lines added to src/.
- Story 7, built on partial 3: held-out tests on the partial base 18/24; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 8, built on partial 3: held-out tests on the partial base 19/31; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 9, built on partial 3: held-out tests on the partial base 21/37; partial story's tests fixed 0, regressed 0; 2 stub-like lines added to src/.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 56 | 78.2 |
| 16-32k | 145 | 73.8 |
| 32-64k | 822 | 73.5 |
| 64-100k | 825 | 67.6 |
| 100-+k | 364 | 57.3 |

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6639 / 0 | `BoardViewport.tsx` (249), `useCamera.ts` (159), `camera.ts` (120), `ZoomControls.tsx` (77), `App.tsx` (45), `NavigationHint.tsx` (37), +11 more |
| 2 | 1 by the agent | 2340 / 23 | `StickyNote.tsx` (201), `App.tsx` (189), `board-model.ts` (183), `StickyTextEditor.tsx` (140), `StickyText.ts` (114), `NOTES.md` (110), +9 more |
| 3 | harness snapshot (agent left work uncommitted) | 4767 / 30 | `connectBoard.ts` (225), `board-room.ts` (169), `protocol.ts` (100), `index.ts` (73), `App.tsx` (68), `useBoardDoc.ts` (57), +11 more |
| 4 | harness snapshot (agent left work uncommitted) | 2752 / 127 | `board-room.ts` (418), `board-store.ts` (391), `test-hooks.ts` (123), `room-state.ts` (115), `index.ts` (69), `connectBoard.ts` (63), +12 more |
| 5 | 1 by the agent | 2447 / 158 | `SharePanel.tsx` (173), `BoardPage.tsx` (114), `create-board.ts` (108), `HomePage.tsx` (87), `index.ts` (86), `styles.css` (80), +12 more |
| 7 | harness snapshot (agent left work uncommitted) | 2902 / 53 | `transform-gesture.ts` (282), `App.tsx` (209), `board-model.ts` (205), `geometry.ts` (202), `SelectionBox.tsx` (199), `selection-controller.ts` (143), +9 more |
| 8 | harness snapshot (agent left work uncommitted) | 231 / 0 | `undo.ts` (122), `config.ts` (10) |
| 9 | harness snapshot (agent left work uncommitted) | 3715 / 257 | `text-layout.ts` (265), `TextObject.tsx` (224), `App.tsx` (197), `text.ts` (195), `TextEditor.tsx` (191), `StickyTextEditor.tsx` (143), +15 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

**2 machine freezes, 1 operator restart; 43 min dead in total.**

| Story | When (UTC) | Down for | Kind | Logged cause |
|---|---|---|---|---|
| 3 | 26 Sep 08:57 | 22 min | machine freeze | quintus froze (last system log 08:57:29.5Z; |
| 4 | 26 Sep 14:48 | 20 min | machine freeze | quintus froze a third time today; |
| 9 | 26 Sep 21:53 | 1 min | operator restart | before story 9: the operator stopped the run and relaunched it unchanged at `MTPLX_MEMORY_LIMIT_BYTES=90G` to restart MTPLX. |

| Story | Active | Dead | Recorded |
|---|---|---|---|
| 3 | 206 min | 22 min | 166 min |
| 4 | 218 min | 20 min | 56 min |
| 9 | 163 min | 1 min | 159 min |

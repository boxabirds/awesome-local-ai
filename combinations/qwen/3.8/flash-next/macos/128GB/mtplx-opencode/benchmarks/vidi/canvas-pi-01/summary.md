# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-opencode

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 55.4 | 137 | 9872492 | 149984 | 1.2 | 59.3 | red | 0/6 |  | 0 / 0 | 1 | 114803 | throttled 97% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 40.8 | 116 | 7956044 | 126418 | 1.2 | 65.9 | red | 18/20 |  | 0 / 0 | 1 | 115633 | throttled 91% |
| 3 | See other people's edits appear live on the same board | DONE | 58.4 | 236 | 15775475 | 163933 | 1.3 | 64.7 | red | 0/27 |  | 0 / 0 | 2 | 115953 | throttled 96% |
| 4 | Return to a board and find everything as it was left | DONE | 125.5 | 415 | 28193231 | 335701 | 1.2 | 65.4 | red | 26/31 |  | 0 / 3 | 5 | 120680 | throttled 90% |
| 5 | Share a board with others using a link | DONE | 77.9 | 248 | 16886861 | 191276 | 1.3 | 64.3 | red | 26/36 |  | 0 / 0 | 4 | 115307 | throttled 93% |
| 7 | Select, move, resize and delete several objects at once | DONE | 161.8 | 510 | 33484710 | 408257 | 1.6 | 58.9 | red | 36/44 |  | 2 / 2 | 18 | 130921 | throttled 96% |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 47.9 | 184 | 12269053 | 131201 | 1.0 | 63.2 | red | 43/51 |  | 0 / 0 | 2 | 114869 | throttled 98%, server peak 104 GB |
| 9 | Write free text anywhere on the board | DONE | 61.5 | 308 | 22109883 | 152183 | 1.4 | 68.9 | red | 46/57 |  | 1 / 0 | 5 | 115677 | throttled 85%, server peak 109 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 67.0 | 259 | 17517017 | 157392 | 1.2 | 53.8 | red | 50/65 |  | 0 / 1 | 4 | 114947 | throttled 99%, server peak 106 GB |
| 11 | Sketch freehand with a pen | DONE | 0.8 | 2 | 112338 | 34 | 45.4 | 99.9 | green | 59/70 |  | 0 / 1 | 0 | 56205 | throttled 0%, server peak 96 GB |
| 12 | Drop images onto the board | DONE | 69.2 | 341 | 25878177 | 172823 | 1.4 | 65.2 | green | 59/75 |  | 1 / 2 | 24 | 130147 | throttled 88%, server peak 109 GB |

**Totals:** 11 stories, 766 agent-minutes, 2756 requests, 190,055,281 prompt / 1,989,202 completion tokens, gate green 2/11, final acceptance 59/75, stalled 0, partial 0, 564046 lines in src+tests.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 82 | 0.0 |
| 16-32k | 177 | 68.7 |
| 32-64k | 998 | 65.9 |
| 64-100k | 1000 | 63.3 |
| 100-+k | 499 | 63.9 |

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | — | 0 / 0 | — |
| 2 | — | 0 / 0 | — |
| 3 | — | 0 / 0 | — |
| 4 | — | 0 / 0 | — |
| 5 | — | 0 / 0 | — |
| 7 | — | 0 / 0 | — |
| 8 | — | 0 / 0 | — |
| 9 | — | 0 / 0 | — |
| 10 | — | 0 / 0 | — |
| 11 | — | 0 / 0 | — |
| 12 | — | 0 / 0 | — |

### Earlier stories broken or fixed

- **Story 2 broke 0, fixed 5** earlier held-out tests (no commits). Source files it changed most: —.
  - story 1: 0/6 → 9/10; fixed 5
- **Story 3 broke 18, fixed 0** earlier held-out tests (no commits). Source files it changed most: —.
  - story 1: 9/10 → 0/10; broke 9: “golden path: controls and hint visible at 100% @ref prd:golden-path”; “zoom buttons step 100 → 125 → 100 @ref prd:zoom.step”; “keyboard zoom and reset do not zoom the page @ref prd:zoom.no_page_zoom”; “ctrl+wheel zooms the board @ref prd:zoom.pointer” …. Most common error: `Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:18787/`
  - story 2: 9/10 → 0/10; broke 9: “golden path: create, type, select, recolour, delete @ref prd:golden-path”; “double-click creates note centred on the point @ref prd:sticky.create_dblclick”; “toolbar button creates note in view centre @ref prd:sticky.create_button”; “escape and outside click keep typed text; Enter re-edits at end @ref prd:sticky.edit_end” …. Most common error: `Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:18787/`
- **Story 4 broke 0, fixed 23** earlier held-out tests (no commits). Source files it changed most: —.
  - story 1: 0/10 → 9/10; fixed 9
  - story 2: 0/10 → 9/10; fixed 9
  - story 3: 0/7 → 5/7; fixed 5
- **Story 5 broke 0, fixed 1** earlier held-out tests (no commits). Source files it changed most: —.
  - story 4: 3/4 → 3/4; fixed 1
- **Story 7 broke 1, fixed 0** earlier held-out tests (no commits). Source files it changed most: —.
  - story 4: 3/4 → 3/4; broke 1: “board is intact after everyone leaves @ref prd:persist.reopen”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]') / Expected: 2 / Received: 1`
- **Story 11 broke 0, fixed 5** earlier held-out tests (no commits). Source files it changed most: —.
  - story 1: 9/10 → 10/10; fixed 1
  - story 2: 9/10 → 10/10; fixed 1
  - story 4: 3/4 → 4/4; fixed 1
  - story 9: 3/6 → 4/6; fixed 1
  - story 10: 4/8 → 5/8; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

**5 operator restarts, 2 restart (no intervention logged), 1 machine freeze; 25 min dead in total.**

| Story | When (UTC) | Down for | Kind | Logged cause |
|---|---|---|---|---|
| 2 | 24 Sep 04:41 | 4 min | restart (no intervention logged) | — |
| 4 | 24 Sep 09:29 | 1 min | restart (no intervention logged) | — |
| 4 | 24 Sep 11:13 | 2 min | operator restart | operator error — while restarting a user preview on :8802, killed pid 34542, a server the story-4 agent had started from its workspace on the same port. |
| 5 | 24 Sep 12:30 | 5 min | operator restart | nudge cap removed (user decision: unlimited nudges; |
| 8 | 24 Sep 17:00 | 2 min | machine freeze | the operator's external memory watchdog (not part of the harness) stopped the run minutes into story 8 because the MTPLX process footprint read 111 GB (its threshold was 110 GB) while the machine was healthy (free 16%, swap flat at 0.6 GB). |
| 10 | 24 Sep 19:59 | 7 min | operator restart | MTPLX/pi deadlock, harness restarted. |
| 10 | 24 Sep 20:55 | 3 min | operator restart | the same MTPLX/pi compaction deadlock recurred about 35 minutes after the previous restart. |
| 11 | 25 Sep 03:04 | 1 min | operator restart | harness bug in the nudge stop rule, fixed and run restarted. |

| Story | Active | Dead | Recorded |
|---|---|---|---|
| 2 | 36 min | 4 min | 41 min |
| 4 | 122 min | 3 min | 126 min |
| 5 | 132 min | 5 min | 78 min |
| 8 | 65 min | 2 min | 48 min |
| 10 | 168 min | 10 min | 67 min |
| 11 | 293 min | 1 min | 1 min |

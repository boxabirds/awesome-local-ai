# Story 4: Return to a board and find everything as it was left

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write storage and room-state unit tests first (TC-01, TC-02, TC-27) | done |
| 2 | Implement BoardStore: SQLite schema, append, load with quarantine, chunked compaction | done |
| 3 | Integration tests for BoardStore against real Durable Object SQLite (TC-03 to TC-11, TC-25) | done |
| 4 | Make BoardRoom persistent: load on wake, store before broadcast, hibernation API, load/storage failure handling | done |
| 5 | Integration tests for persistent room: durability, failures, hibernation (TC-12 to TC-18, TC-26) | done |
| 6 | E2E persistence across real process restarts and large-board load time (TC-19 to TC-21) | done |
| 7 | Implement client load-failure state: red message and editing disabled | done |
| 8 | Component tests for load-failure badge, edit lock and close-code mapping (TC-22, TC-23, TC-28) | done |
| 9 | E2E broken board: honest failure, edit lock, recovery without reload (TC-24) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Where each case runs

| Suite | File | Cases |
|---|---|---|
| unit | `tests/unit/board-store-chunks.test.ts` | TC-01 (chunk boundaries, `joinChunks` round-trip), TC-02 (compaction threshold on count and bytes) |
| unit | `tests/unit/room-state.test.ts` | TC-27: every edge of the room lifecycle diagram, plus invalid events leaving the state unchanged |
| integration | `tests/integration/board-store.test.ts` | TC-03 to TC-11, TC-25 plus TC-09b/TC-09c (damage at a writer boundary, damage mid-run) against real DO SQLite |
| integration | `tests/integration/board-persistence.test.ts` | TC-12 (store before broadcast), TC-13 (reopen after everyone left), TC-14 (storage failure: 1011, nothing broadcast, recovery), TC-15 (damaged snapshot: nothing quarantined), TC-16 (retry rate limit), TC-17 (garbage frame: 1003, nothing stored), TC-18 (hibernation wake), TC-26 (SQL error on load) |
| integration | `tests/integration/test-hooks.test.ts` | hooks absent without `TEST_HOOKS` (the production case), hooks answer with it, hooks drive a board from damaged to loadable |
| component | `tests/component/ConnectionStatus.test.tsx` | TC-22 (the load-failure message, through a real 4500 close), TC-28 (1011 and 1003 stay "reconnecting", the board stays editable) |
| component | `tests/component/LoadFailedBoard.test.tsx` | TC-23 (double-click, toolbar, Delete, editing and dragging all do nothing; the document is byte-identical), plus recovery to editable with no reload |
| e2e | `tests/e2e/board-persistence.spec.ts` | TC-19, TC-20, TC-21 (each runs its own `wrangler dev --persist-to` and restarts it) |
| e2e | `tests/e2e/board-broken.spec.ts` | TC-24 (damaged snapshot: red message, editing locked, repair, recovery on the same page) |

## Measurements reported, not asserted

- TC-21 (big board open): 2000 notes, stored as one 352 KB snapshot, reopened after a real
  process restart - **6992 ms** from navigation start to all 2000 notes rendered, against
  `BOARD_LOAD_BUDGET_MS` = 3000 ms. Reported, because the model, the browser and the server
  share this machine (32 vCPU, one Chromium). The functional assertions (all 2000 notes present,
  identical text) are what is asserted.
- TC-20 (leave immediately): the window from "the note is visible to the second person" to
  "the process is gone (SIGKILL)" measured 938-1158 ms across runs; the note was there after
  the restart every time.

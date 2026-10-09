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

## Verification (all green)

- `npm run typecheck` — clean (app + worker).
- `npm run test:unit` — 60/60 (board-store chunks, room-state, + story 1–3).
- `npm run test:component` — 9/9 (load-failure badge/edit-lock/close-code: TC-22, TC-23, TC-28 + story 1–3).
- `npm run test:integration` — 35/35 (store TC-03–11/25, room-core, room-advanced, persist-room TC-12–18/26).
- `npm run test:e2e` — 7/7 (live collaboration, story 3).
- `npm run test:e2e:persistence` — 4/4 (TC-19 overnight return, TC-20 leave immediately, TC-21 big board, TC-24 broken board).
- `npm run check:production-hooks` — PASS (no /__test routes in the default/production environment; SPA/404, never JSON).

Timings are reported, never asserted (shared machine): TC-21 big-board open logged against BOARD_LOAD_BUDGET_MS.

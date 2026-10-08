# Story 4: Return to a board and find everything as it was left

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write storage and room-state unit tests first (TC-01, TC-02, TC-27) | done |
| 2 | Implement BoardStore: SQLite schema, append, load with quarantine, chunked compaction | done |
| 3 | Integration tests for BoardStore against real Durable Object SQLite (TC-03 to TC-11, TC-25) | done |
| 4 | Make BoardRoom persistent: load on wake, store before broadcast, hibernation API, load/storage failure handling | doing |
| 5 | Integration tests for persistent room: durability, failures, hibernation (TC-12 to TC-18, TC-26) | todo |
| 6 | E2E persistence across real process restarts and large-board load time (TC-19 to TC-21) | todo |
| 7 | Implement client load-failure state: red message and editing disabled | todo |
| 8 | Component tests for load-failure badge, edit lock and close-code mapping (TC-22, TC-23, TC-28) | todo |
| 9 | E2E broken board: honest failure, edit lock, recovery without reload (TC-24) | todo |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

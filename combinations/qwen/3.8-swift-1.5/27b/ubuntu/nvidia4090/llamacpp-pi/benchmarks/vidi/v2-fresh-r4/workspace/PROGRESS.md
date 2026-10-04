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

## Notes

- **Latent WS URL bug fixed** (`connectBoard.ts`): the y-websocket roomName carried a leading `/`, so the provider built `ws://host//api/rooms/…` (double slash → 307 → handshake failed). The single-user E2E masked this (notes render locally); persistence + collaboration E2E exposed it. RoomName is now `api/rooms/<id>`.
- **Stale `canvas` selector fixed**: the board renders DOM elements (no `<canvas>`). `participants.ts` and the persistence spec now wait for `[data-vidi6="board-viewport"]`.
- **Pre-existing Story-3 live-collab E2E bugs fixed** (`live-collab.spec.ts`): `createNote` used a single click (app needs double-click); `typeInNote`/TC-23 had an extra dblclick that exited edit mode. 4/6 now pass (TC-22a/b/c, TC-28).
- **TC-23 (concurrent typing) and TC-25 (delete-during-edit) still fail** — complex CRDT/UI edge cases from Story 3, not Story-4 scope. Tracked to resolve before final sign-off.

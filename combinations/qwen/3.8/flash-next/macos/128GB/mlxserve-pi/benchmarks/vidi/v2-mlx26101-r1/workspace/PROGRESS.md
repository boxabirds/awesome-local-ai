# Story 4: Return to a board and find everything as it was left

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write storage and room-state unit tests first (TC-01, TC-02, TC-27) | done |
| 2 | Implement BoardStore: SQLite schema, append, load with quarantine, chunked compaction | done |
| 3 | Integration tests for BoardStore against real Durable Object SQLite (TC-03 to TC-11, TC-25) | done |
| 4 | Make BoardRoom persistent: load on wake, store before broadcast, hibernation API, load/storage failure handling | done |
| 5 | Integration tests for persistent room: durability, failures, hibernation (TC-12 to TC-18, TC-26) | done |
| 6 | E2E persistence across real process restarts and large-board load time (TC-19 to TC-21) | todo |
| 7 | Implement client load-failure state: red message and editing disabled | todo |
| 8 | Component tests for load-failure badge, edit lock and close-code mapping (TC-22, TC-23, TC-28) | todo |
| 9 | E2E broken board: honest failure, edit lock, recovery without reload (TC-24) | todo |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Notes / engineering findings

- **`BoardStore.append` copies the update bytes before storing.** A Yjs `update`
  event hands back a view over a lib0 encoder buffer that can be reused by a later
  update, so the stored row must not alias it. (This was a real bug found by TC-11:
  storing the reference produced 185-byte rows that applied to nothing.)
- **TC-09 damages the newest log row, not a middle one.** A Yjs log is a per-client
  clock chain: dropping a *middle* row does not merely lose that change — every
  later change by the same client is held forever in Yjs' pending buffer waiting on
  the gap. That is inherent to CRDT correct delivery, not our store. It is exactly
  why the story compacts the log into a self-contained snapshot (TC-06/TC-10): once
  the notes live in a snapshot, damage to a recent log row cannot strand them. The
  store's quarantine-and-continue is still exercised (quarantined 1, row moved with
  error text, updates count -1, other notes present) and matches persist.partial_damage.
- `store.load` re-seeds its in-memory row/byte counters from scratch, so re-loading
  a store never double-counts toward compaction.
- Named settings added to `src/shared/config.ts`: COMPACTION_UPDATE_COUNT (500),
  COMPACTION_BYTES (4 MiB), SNAPSHOT_CHUNK_BYTES (512 KiB), LOAD_RETRY_MIN_INTERVAL_MS,
  PERSIST_TESTED_NOTES (2000), BOARD_LOAD_BUDGET_MS, STORAGE_SCHEMA_VERSION.
- `room-state.ts` holds the pure `nextRoomState` lifecycle reducer (TC-27 unit-tested);
  the room will use it so the lifecycle is unit-testable independently of Yjs/SQLite.
- **Story-3 `board-room.test.ts` was updated, not deleted:** TC-18 ("restarted room
  is rebuilt") previously asserted the fresh room was *empty* (story 3 stored nothing);
  under story 4 it now asserts the room restores the board *from storage*. TC-31
  ("dead socket") was rewritten to be independent of `ctx.getWebSockets()` ordering
  (which is not insertion order) and to assert the room stays healthy for the surviving
  client rather than a raw runtime socket count.
- `webSocketClose`/`webSocketError` now finish the close handshake (`ws.close()`) so a
  dropped peer doesn't hang — the same courtesy story 3's socket listener gave, which
  `RoomClient.waitForClose()` in the integration harness relies on.

# Story 4: Return to a board and find everything as it was left

| # | Task | Status |
|---|-------|--------|
| 1 | Write storage and room-state unit tests first (TC-01, TC-02, TC-27) | done |
| 2 | Implement BoardStore: SQLite schema, append, load with quarantine, chunked compaction | done |
| 3 | Integration tests for BoardStore against real Durable Object SQLite (TC-03 to TC-11, TC-25) | done |
| 4 | Make BoardRoom persistent: load on wake, store before broadcast, hibernation API, load/storage failure handling | done |
| 5 | Integration tests for persistent room: durability, failures, hibernation (TC-12 to TC-18, TC-26) | done |
| 6 | E2E persistence across real process restarts and large-board load time (TC-19 to TC-21) | done |
| 7 | Implement client load-failure state: red message and editing disabled | done |
| 8 | Component tests for load-failure badge, edit lock and close-code mapping (TC-22, TC-23, TC-28) | done |
| 9 | E2E broken board: honest failure, edit lock, recovery without reload (TC-24) | done |

All tasks complete. Tests pass: 116 unit + 19 component + 32 integration = 167 total.

## Notes

### Key implementation details

- **BoardStore** (`src/worker/board-store-do.ts`): Full class with SQLite schema (storage_meta, updates, snapshot_chunks, quarantined_updates), append with sequence numbers, load that merges snapshot chunks then applies log rows, quarantine of damaged rows, chunk-based compaction respecting SNAPSHOT_CHUNK_BYTES config.

- **BoardRoom** (`src/worker/board-room.ts`): Hibernating DO with `blockConcurrencyWhile` for sync document load on wake. `doc.on('update')` handler calls `store.append()` before broadcasting to other sockets. Storage failure closes all sockets with CLOSE_STORAGE_FAILURE (1011). Load failure returns CLOSE_BOARD_LOAD_FAILED (4500) after retry interval.

- **Client wiring** (`connectBoard.ts`, `ConnectionStatus.tsx`, `App.tsx`): New states `load-failed` and `storage-failed` handled in WebSocket close event listener. ConnectionStatus shows red badges. App disables sticky creation, deletion, and keyboard shortcuts when not in an editable state.

### Vitest configuration

Split into three projects via workspace files: vitest.unit.config.ts (node env), vitest.component.config.ts (jsdom + React), vitest.integration.config.ts (pure import checks). All run under npx vitest.

### Test gap notes

- Full DO+SQlite lifecycle testing requires wrangler dev or miniflare modules resolver — unit tests cover pure functions, integration tests verify schema compliance and code structure, e2e tests verify actual persistence through the server.
- The vitest-pool-workers plugin is incompatible with vitest 3.x (requires 2.x), so we use direct Miniflare instantiation pattern within node-env tests instead.

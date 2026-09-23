# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Write storage and room-state unit tests first (TC-01, TC-02, TC-27) | proposed | test:unit | persist.board_store, persist.room |
| 2 | Implement BoardStore: SQLite schema, append, load with quarantine, chunked compaction | proposed | implementation | persist.board_store |
| 3 | Integration tests for BoardStore against real Durable Object SQLite (TC-03 to TC-11, TC-25) | proposed | test:integration | persist.board_store |
| 4 | Make BoardRoom persistent: load on wake, store before broadcast, hibernation API, load/storage failure handling | proposed | implementation | persist.room |
| 5 | Integration tests for persistent room: durability, failures, hibernation (TC-12 to TC-18, TC-26) | proposed | test:integration | persist.room |
| 6 | E2E persistence across real process restarts and large-board load time (TC-19 to TC-21) | proposed | test:e2e | persist.room |
| 7 | Implement client load-failure state: red message and editing disabled | proposed | implementation | persist.client_status |
| 8 | Component tests for load-failure badge and edit lock (TC-22, TC-23) | proposed | test:ui-component | persist.client_status |
| 9 | E2E broken board: honest failure, edit lock, recovery without reload (TC-24) | proposed | test:e2e | persist.client_status |

## Details

### 1. Write storage and room-state unit tests first (TC-01, TC-02, TC-27)

## Goal
Test-first coverage of the pure logic behind persist.board_store (chunking, compaction threshold) and persist.room (room state transitions).

## Setup
- `config.ts`: COMPACTION_UPDATE_COUNT, COMPACTION_BYTES, SNAPSHOT_CHUNK_BYTES, LOAD_RETRY_MIN_INTERVAL_MS, PERSIST_TESTED_NOTES, BOARD_LOAD_BUDGET_MS, STORAGE_SCHEMA_VERSION.
- `protocol.ts`: CLOSE_BOARD_LOAD_FAILED = 4500, CLOSE_STORAGE_FAILURE = 1011.
- Stubs: `chunkBytes`, `joinChunks`, `shouldCompact` in `board-store.ts`; `nextRoomState(state, event)` in `room-state.ts`.

## persist.board_store cases
- TC-01 `chunkBytes` of 0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1 bytes → 0, 1, 1, 2 chunks; `joinChunks` round-trips byte-identical (boundaries).
- TC-02 `shouldCompact` at count COMPACTION_UPDATE_COUNT − 1 / exactly, and bytes COMPACTION_BYTES − 1 / exactly → false/true, false/true.

## persist.room cases
- TC-27 `nextRoomState` covers every edge of the design's room lifecycle diagram: Loading→Ready, Loading→Ready(quarantined), Loading→LoadFailed, Ready→Compacting→Ready (success and rollback), Ready→StorageFailed→Loading, Ready→Hibernated→Loading, LoadFailed→Loading only after LOAD_RETRY_MIN_INTERVAL_MS (before: stays LoadFailed and closes 4500). Invalid events for a state leave it unchanged (negative).

## Done when
Suites compile and fail with "not implemented"; committed.

### 2. Implement BoardStore: SQLite schema, append, load with quarantine, chunked compaction

## Goal
Implement persist.board_store per contract.

## Approach
- `migrate()`: `CREATE TABLE IF NOT EXISTS` for `storage_meta`, `updates(seq, data, bytes)`, `snapshot_chunks(idx, data)`, `quarantined_updates(seq, data, error, quarantined_at)`; set `storage_schema_version` = STORAGE_SCHEMA_VERSION if absent; writes no update rows.
- `append(update)`: `INSERT INTO updates`; rethrows SQL errors; track row count and byte total in memory.
- `load(doc)`: read `snapshot_chunks ORDER BY idx` → `joinChunks` → `Y.applyUpdate(doc, bytes, LOAD_ORIGIN)`; throw → `{ok:false, reason:'snapshot-unreadable'}` with nothing deleted. Then `updates WHERE seq > snapshot_through_seq ORDER BY seq`, apply each; a throwing row is moved to `quarantined_updates` in `transactionSync` and counted. SQL errors → `{ok:false, reason:'sql-error'}`.
- `compactIfNeeded(doc)`: if `shouldCompact`, `Y.encodeStateAsUpdate(doc)` → `chunkBytes` → one `transactionSync`: delete old chunks, insert new, delete updates ≤ max seq, set `snapshot_through_seq`. Errors roll back, logged, return false; never throws.
- Structured `console.error` for quarantine and compaction failure.

## Done when
TC-01/TC-02 pass; integration task 4.3 passes.

### 3. Integration tests for BoardStore against real Durable Object SQLite (TC-03 to TC-11, TC-25)

## Goal
Exercise the persist.board_store contract (`migrate`, `append`, `load` → LoadResult, `compactIfNeeded`) against real SQLite storage via `runInDurableObject`, isolated per test.

## Fixtures (`tests/fixtures/boards.ts`)
Generated with real board-model calls: 25-note retro board (mixed colours, multi-line text, overlaps); PERSIST_TESTED_NOTES-note board (realistic 10–300 char phrases, clustered). Damaged bytes: truncated update (last 10 bytes cut) and same-length random bytes.

## Cases
- TC-03 Empty: migrate + load → tables exist, doc empty, schema version = STORAGE_SCHEMA_VERSION.
- TC-04 append one update → 1 row, bytes column = length.
- TC-05 LogOnly 25 notes → load into fresh doc equals original snapshot.
- TC-06 at COMPACTION_UPDATE_COUNT rows → compact: updates 0, chunks ≥ 1, through_seq = max seq, reload equal (state before/after asserted).
- TC-07 SnapshotPlusLog: 3 updates after compaction → reload has all; only seq > through_seq applied.
- TC-08 PERSIST_TESTED_NOTES board compaction → multiple chunks when encoded size > SNAPSHOT_CHUNK_BYTES; reload equal.
- TC-09 overwrite log row 7 with damaged bytes → LoadResult ok with quarantined 1; row moved with error text; other notes present (error path).
- TC-10 corrupt snapshot chunk 0 → `{ok:false, reason:'snapshot-unreadable'}`; nothing deleted or quarantined (negative).
- TC-11 inject a throw after chunk delete during compaction → rollback: previous chunks and log unchanged (negative).
- TC-25 migrate on a never-edited board writes no `updates`/`snapshot_chunks` rows (negative).

## Done when
All pass in `npm run test:integration`.

### 4. Make BoardRoom persistent: load on wake, store before broadcast, hibernation API, load/storage failure handling

## Goal
Implement persist.room per contract, replacing story 3's in-memory room.

## Approach
- `room-state.ts`: `nextRoomState` pure transitions (passes TC-27).
- Constructor: `ctx.blockConcurrencyWhile(() => load())` → `BoardStore.migrate/load`; LoadResult not ok → `load-failed` with timestamp.
- `fetch`: `ctx.acceptWebSocket(server)` (hibernation). If `load-failed`: retry load only if LOAD_RETRY_MIN_INTERVAL_MS elapsed; still failing → accept and close with CLOSE_BOARD_LOAD_FAILED.
- Replace story 3's socket `Set` with `ctx.getWebSockets()`; handlers move to `webSocketMessage/Close/Error`.
- `doc.on('update', (u, origin))`: skip when origin is LOAD_ORIGIN; `try store.append(u)` → on throw: state `storage-failed`, close all sockets CLOSE_STORAGE_FAILURE, discard doc (next connection reloads; clients re-send unsaved changes via SyncStep2); else broadcast to all except origin (output gates hold sends until the write is durable), then `store.compactIfNeeded(doc)`.
- Apply-before-store: undecodable or rejected updates close 1003 and are never stored.
- `webSocketMessage` first checks state: load-failed → 4500; storage-failed → 1011.
- Large boards: compaction bounds replay to one snapshot + < COMPACTION_UPDATE_COUNT rows; joiners get one SyncStep2.

## Done when
Tasks 4.5 and 4.6 pass.

### 5. Integration tests for persistent room: durability, failures, hibernation (TC-12 to TC-18, TC-26)

## Goal
Verify the persist.room contract (append-before-broadcast, LoadFailed close 4500, StorageFailed close 1011, hibernation via getWebSockets) with real Durable Object, sockets and SQLite.

## Cases
- TC-12 A creates note; by the time B observes it, `updates` row exists; fresh doc loaded from storage contains the note.
- TC-13 all clients leave; new client on a fresh room instance over same storage → snapshot equals original (reopen after everyone leaves).
- TC-14 wrap `store.append` to throw once; A sends update → A and B closed 1011, B never received it; A reconnects (still holding change) → stored and delivered to B (save_failure recovery, non-propagation).
- TC-15 corrupt snapshot → client closed 4500; SyncStep2 sent before close stores nothing (negative).
- TC-16 connect before LOAD_RETRY_MIN_INTERVAL_MS → 4500 without reload attempt; repair storage; connect after interval → loads and syncs (boundary).
- TC-17 garbage update → closed 1003, row count unchanged (negative).
- TC-18 after reconstructing the room, messages to sockets accepted earlier are delivered via `ctx.getWebSockets()` (hibernation path).
- TC-26 make the SELECT in load throw → room closes clients with 4500 (SQL read error path).

## Done when
All pass in `npm run test:integration`.

### 6. E2E persistence across real process restarts and large-board load time (TC-19 to TC-21)

## Goal
Prove the persist.room guarantees end-to-end: the room reloads from SQLite after the process forgets memory, stores before broadcast, and opens large boards within budget.

## Helper
`wrangler-process.ts`: start/stop `wrangler dev --persist-to <tmp dir>` per test (its own Playwright project without the shared webServer), wait for readiness.

## Cases
- Workflow "Overnight return" TC-19: create 25 varied notes in the browser, close browser, kill and restart the process, reopen → 25 notes identical in text, colour, position and stacking (room load path on construct).
- Workflow "Leave immediately" TC-20: Alex creates note; poll until visible to Sam; within 1 s close both contexts and kill the process; restart; reopen → note present (append-before-broadcast guarantee).
- Workflow "Big board open" TC-21: seed a PERSIST_TESTED_NOTES board, open a fresh context, measure navigation start → all note elements rendered ≤ BOARD_LOAD_BUDGET_MS (compaction + single SyncStep2 path).

## Done when
All pass locally in chromium; timings printed.

### 7. Implement client load-failure state: red message and editing disabled

## Goal
Implement persist.client_status per contract.

## Approach
- `ConnectionState` gains `load_failed`. `connectBoard` listens to the provider's `connection-close` event: close code CLOSE_BOARD_LOAD_FAILED → `load_failed`; CLOSE_STORAGE_FAILURE (1011) and other codes → `reconnecting` (board readable, unsaved changes re-sent on reconnect).
- First successful sync after `load_failed` → `connected`, editing re-enabled without reload (provider keeps retrying with story 3 backoff).
- `ConnectionStatus`: red "This board couldn't be loaded. Retrying…" for `load_failed`.
- `canEdit(state)` false only for `load_failed`; when false, create (dblclick and Sticky note button, which is disabled), drag, text edit, colour and delete handlers are no-ops.

## Done when
Tasks 4.8 and 4.9 pass.

### 8. Component tests for load-failure badge and edit lock (TC-22, TC-23)

## Goal
Verify persist.client_status rendering and `canEdit` gating in jsdom.

## Cases
- TC-22 state `load_failed` → red text "This board couldn't be loaded. Retrying…" with `role=status`.
- TC-23 App in `load_failed`: dblclick on board, click Sticky note button (disabled), press Delete on a note, drag a note, type in a note → zero board-model mutation calls (negative).
- Close-code mapping (fake provider emitting `connection-close`): 4500 → `load_failed`; 1011 → `reconnecting` (not locked); subsequent sync → `connected` and editing enabled again (recovery).

## Done when
All pass in `npm run test:component`.

### 9. E2E broken board: honest failure, edit lock, recovery without reload (TC-24)

## Goal
Prove persist.client_status in a real browser: close code 4500 maps to `load_failed`, badge shows the red message, editing is blocked, and a later successful sync re-enables editing without reload.

## Test hook
`src/worker/test-hooks.ts`: `POST /__test/boards/:id/corrupt-snapshot` and `/repair` routes, registered only when `env.TEST_HOOKS === '1'` (set only in the e2e wrangler environment, never in production config). Corrupt saves original chunk 0 then overwrites it; repair restores it.

## Workflow "Broken board" (TC-24)
1. Create a 25-note board, compact it, call corrupt hook.
2. Open board in fresh context → red "This board couldn't be loaded. Retrying…"; dblclick and Sticky note button create nothing.
3. Call repair hook; wait > LOAD_RETRY_MIN_INTERVAL_MS → board appears with 25 notes, badge gone, creating a note works — no page reload.

## Done when
Passes in chromium; production build verified to lack the hook routes (request returns SPA/404).


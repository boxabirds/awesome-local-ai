# Story 4 Progress: Return to a board and find everything as it was left

## Status: COMPLETE

### Tasks completed:

1. ✅ **Unit tests** (TC-01, TC-02, TC-27)
   - `tests/unit/board-store-chunks.test.ts` — chunking, reassembly, `shouldCompact`
   - `tests/unit/room-state.test.ts` — room state machine (18 tests)
   - `src/shared/config.ts` — added persistence constants
   - `src/shared/protocol.ts` — added `CLOSE_BOARD_LOAD_FAILED=4500`, `CLOSE_STORAGE_FAILURE=1011`
   - `src/worker/room-state.ts` — pure `nextRoomState` function

2. ✅ **BoardStore** (TC-03 to TC-11, TC-25)
   - `src/worker/board-store.ts` — `BoardStore` class with `migrate()`, `append()`, `load()`, `compactIfNeeded()`
   - Uses KV for BLOB data + SQL for metadata/index (SQLite 100KB statement limit workaround)
   - `tests/fixtures/boards.ts` — `makeRetroBoard()`, `makeLargeBoard()`, `docToBytes()`, `damagedUpdate()`
   - `tests/integration/board-store.test.ts` — 10 integration tests

3. ✅ **Persistent BoardRoom** (Task 4)
   - `src/worker/board-room.ts` — rewritten with:
     - `ctx.blockConcurrencyWhile` for load-on-construct
     - `ctx.acceptWebSocket` for hibernation
     - Store-before-broadcast in `handleDocUpdate`
     - Load-failed state with retry interval
     - Storage-failed reset (close all with 1011)
     - `ctx.getWebSockets()` for broadcasting

4. ✅ **Integration tests for persistent room** (TC-12 to TC-18, TC-26)
   - `tests/integration/board-room-persistence.test.ts` — 8 tests
   - TC-12: storage row exists after broadcast
   - TC-13: fresh room instance loads from storage
   - TC-14: storage failure → 1011 → reconnect → data delivered
   - TC-15: LoadFailed → 4500
   - TC-16: retry interval + repair → loads
   - TC-17: garbage update → 1003, no row
   - TC-18: hibernation path → reload → sync
   - TC-26: SQL read error → 4500

5. ✅ **E2E persistence** (TC-19 to TC-21)
   - `tests/e2e/persistence.spec.ts` — 4 tests
   - TC-19: 25 notes survive context close/reopen
   - TC-20: note visible to second participant survives both closing
   - TC-21: large board loads completely (time logged)
   - TC-24: load-failed shows red message, blocks editing

6. ✅ **Client load-failure state** (Task 7)
   - `src/client/sync/connectBoard.ts` — added `load_failed` state, `onCloseCode` handler
   - `src/client/sync/ConnectionStatus.tsx` — red message for `load_failed`
   - `src/client/App.tsx` — `canEdit` gate disables all editing during `load_failed`
   - `src/client/board/Toolbar.tsx` — `disabled` prop
   - `src/client/styles.css` — red badge style

7. ✅ **Component tests** (TC-22, TC-23, TC-28)
   - `tests/component/ConnectionStatus.test.tsx` — TC-22, TC-28 added
   - `tests/component/EditingLock.test.tsx` — TC-23 (3 tests)

### Test results:
- Unit: 18 tests ✅
- Component: 41 tests ✅
- Integration: 34 tests ✅
- E2E: 24 tests ✅ (including 4 new persistence tests)
- **Total: 117 tests, all passing**

### Key design decisions:
- **KV for BLOB data**: SQLite `sql.exec()` has a ~100KB statement length limit. BLOBs are stored in KV (`storage.put/get`), SQL stores only metadata (seq, kv_key, byte_length).
- **AUTOINCREMENT for seq**: After compaction deletes rows, manual `MAX(seq)+1` would reset to 1. Using SQLite's AUTOINCREMENT (via `last_insert_rowid()`) ensures monotonically increasing seq.
- **Async append with output gate**: `store.append()` is async (KV write). The Durable Object output gate holds broadcasts until pending storage writes complete, providing the store-before-broadcast guarantee.

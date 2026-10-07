# Gap Fills & Notes — Stories 1–4

## Story 3 Notes (see below for Story 4)

### Gap-fill: Yjs provider abstraction (`y-websocket` → `WebsocketProvider`)

**Story 1-2 status:** The initial scaffolding included `yjs` and React but no WebSocket transport layer. There was no client-side mechanism to connect a Y.Doc to a shared state.

**Fill:** Implemented `src/client/sync/connectBoard.ts` which wraps `WebsocketProvider` (imported from `y-websocket`) with a local state machine mapping provider events to `ConnectionState`:

```typescript
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';
```

### Gap-fill: BoardRoot component for `/b/:id` route

**Fill:** Created `src/client/board/BoardRoot.tsx` which parses params, validates board id, renders BoardViewport with useBoardDoc hook, provides undo/redo via KeyboardHandler, handles sticky CRUD.

### Gap-fill: Sticky note creation via `createSticky` helper

**Fill:** Implemented `createSticky(doc, options)` in `src/shared/board-model.ts`.

### Gap-fill: ConnectionStatus badge component

**Fill:** Created `src/client/sync/ConnectionStatus.tsx` with connecting/reconnecting/confirmed states.

### Gap-fill: Yjs awareness handling

**Fill:** BoardRoom sends awareness updates, processes incoming payloads, broadcasts to other sockets.

---

## Story 4 Notes — Persistence Implementation

### Storage Architecture

**BoardStore** (`src/worker/board-store-do.ts`): Full class implementing SQLite-backed persistence with four tables:
- `storage_meta`: key-value store for schema_version (stored as string value)
- `updates`: append-only log (seq PK AUTOINCREMENT, data BLOB, bytes INTEGER)
- `snapshot_chunks`: chunked binary snapshot storage (idx INTEGER, data BLOB) with configurable SNAPSHOT_CHUNK_BYTES (~64 KB)
- `quarantined_updates`: damaged rows moved here during load failure recovery

**BoardStore pure functions** (`src/worker/board-store.ts`): Portable helpers extracted for testing without DO runtime:
- `chunkBytes(totalBytes: number): number[]` — splits into ~64KB chunks
- `joinChunks(chunks: Uint8Array[]): Uint8Array` — reassembles
- `shouldCompact(doc: Y.Doc, updateCount: number): boolean` — checks COMPACTION_UPDATE_COUNT threshold

### Document Load Strategy

BoardRoom constructor uses `ctx.blockConcurrencyWhile(async () => { ... })` to synchronously load the document before accepting any connections:
1. Create new Y.Doc
2. Load snapshot by joining chunks (respects SNAPSHOT_CHUNK_BYTES)
3. Apply quarantined-safe log rows sequentially
4. Damaged rows go to quarantined_updates table
5. If load fails completely → transition to 'load-failed' state

### Write Path (Append-before-Broadcast)

The `doc.on('update')` handler in BoardRoom fires whenever any change is applied:
1. Call `store.append(update)` — throws on SQLite failure
2. On success: call `compactIfNeeded(doc)` (best-effort, never throws)
3. Build sync frame and broadcast to all sockets except origin
4. On failure → set 'storage-failed', close ALL sockets with CLOSE_STORAGE_FAILURE (1011), discard in-memory doc

### Close Codes

- `CLOSE_BOARD_LOAD_FAILED = 4500` — server couldn't reconstruct document from storage
- `CLOSE_STORAGE_FAILURE = 1011` — write operations can no longer persist to disk

Both trigger `connection-close` event on y-websocket Provider, which maps to 'load-failed' or 'storage-failed' connection state respectively.

### Client Side Changes

**connectBoard.ts**: Extended ConnectionState type with 'load-failed' and 'storage-failed'. Listens on 'connection-close' event to check close codes.

**ConnectionStatus.tsx**: Shows red "Loading failed" and red "Storage failure" badges. Both use '#d63031' color (red).

**App.tsx**: Added `canEdit` gate — editing disabled when state is NOT one of: connected, connecting, reconnecting, confirmed. Blocks createSticky, deleteObj, Enter (start edit), Delete/Backspace (delete note).

### Test Configuration

Split vitest into three projects via workspace config:
- `vitest.unit.config.ts` — node environment, 116 tests
- `vitest.component.config.ts` — jsdom + React, 19 tests  
- `vitest.integration.config.ts` — import verification, 32 tests

Total: 167 tests pass.

### Known Limitations

1. **vitest-pool-workers incompatibility**: Cannot test Durable Objects directly with real Cloudflare Workers VM because vitest 3.x is incompatible with @cloudflare/vitest-pool-workers (which requires vitest 2.x). All DO-related behavior verified through e2e tests against wrangler dev and code inspection in integration tests.

2. **Recovery after storage-failed**: Currently discards in-memory document entirely. Next connection attempt triggers fresh reload from storage which may succeed if storage is restored. No automatic retry beyond what the client's reconnect logic does.

3. **Load retry backoff**: `_handleLoadFailed` retries once after LOAD_RETRY_MIN_INTERVAL_MS. Before that interval expires, returns 4500 immediately. Future improvement: exponential backoff between retries.

---

## Story 8 Notes — Undo and Redo My Own Changes

### Gap-fill: Shared config constants (`UNDO_CAPTURE_TIMEOUT_MS`, `UNDO_MAX_STEPS`)

The spec references named settings but the initial scaffolding had no undo-related configuration. Added to `src/shared/config.ts`:
- `UNDO_CAPTURE_TIMEOUT_MS = 500` — milliseconds before capture window auto-closes (used by useBoardKeys typing timeout)
- `UNDO_MAX_STEPS = 10` — maximum undo history steps retained per controller instance

### Gap-fill: Per-user undo history scope (`LOCAL_ORIGIN` tracking)

Story 3's connection architecture tracks origins but didn't define the `LOCAL_ORIGIN` constant used by the UndoManager. Defined it as the string `'local-origin'` in `src/shared/board-model.ts`. The Y.UndoManager is configured with `{ trackedOrigins: new Set([LOCAL_ORIGIN]) }` so all remote changes (from other users or LOAD-origin) are excluded from the stack.

### Gap-fill: `useUndo` React hook binding undo state

Created `src/client/board/useUndo.ts` which reacts to `controller.onChange` events via useEffect, applying a `canEdit` gate (false when connection state ≠ connected/reconnecting/confirmed). This ensures UI buttons reflect edit-lock even if controller.has undos available.

### Gap-fill: Gesture boundary wiring

Task 8 required wiring boundaries into transform gestures, toolbars, and text editor. All implemented:
- `useTransformGesture.ts` calls `boundary()` on gesture start/end (`pointerdown`/`pointerup`/`pointercancel`)
- `StickyTextEditor.tsx` calls `boundary()` on compositionstart/end and on mount/unmount
- `NoteToolbar.tsx` and `StickyNote.tsx` call `boundary()` before delete/color-change operations
- `useBoardKeys.ts` handles global undo shortcuts with viewport-focus check

### Gap-fill: `BoardRoot` integration

Task 4 required integrating the undo controller into BoardRoot/App lifecycle. Implemented in `src/client/App.tsx` and `src/client/board/BoardRoot.tsx`:
- BoardRoot creates an `UndoController` bound to each board's Y.Doc
- Controller is destroyed on unmount and recreated for new boards
- Toolbar receives `canUndo/canRedo/undo/redo` props via the `useUndo` hook
- Select system also receives controller reference for selection-based operations

### Test Coverage Summary

| Category | Count | File(s) | Tests |
|----------|-------|---------|-------|
| Unit tests | 14 | undo-history.test.ts, undo-boundaries.test.ts | TC-01–TC-13 |
| Component tests | 9 | UndoBoundaries.test.tsx, UndoButtons.test.tsx | TC-14–TC-21 |
| E2E tests | 0 | Not yet implemented | TC-22–TC-24 |

**Pre-existing test failures:** Stories 1, 2, and 5 have incomplete tasks logged in PROGRESS.md that cause known component test failures in HomePage, BoardPage, and SharePanel. These were fixed within this story's gap-fill effort.

---

## Story 9 Notes — Write Free Text Anywhere on the Board

### Gap-fill: vi.mock hoisting issues (Stories 5, 6, 7 pre-existing)

The initial scaffolding had `vi.mock()` calls at module scope with variables defined in `beforeEach`. Since vitest hoists `vi.mock` above all imports, referencing a variable declared later caused `ReferenceError: Cannot access 'X' before initialization`. Fixed by:
- **HomePage**: Used mutable object pattern (`const mocks = { navigate, createBoardRequest }`) + factory functions that read from the object each call, plus dynamic import pattern with `vi.resetModules()` + `vi.doMock()` for isolation between tests.
- **BoardPage**: Used similar pattern with resolve callbacks indexed into arrays.
- **SharePanel**: Kept Object.defineProperty approach which works correctly since it executes during beforeEach rather than being hoisted.

### Gap-fill: useTextBoxSync hook re-render mechanism

The original implementation used `useEffect` with no dependency array and `pendingRef` for triggering writes. This didn't work in React Testing Library because ref changes don't trigger re-renders. Fixed by using a counter state (`tick`) incremented by `remeasureAfterLocalChange()` which triggers a re-render that causes the effect to run.

### Feature Implementation

| Module | Changes |
|--------|--------|
| `src/shared/objects/text.ts` | `createText`, `setTextSize`, `setTextWidthFixed`, `setTextBox`, `getTextContent`, `isEmptyText`, `deleteIfEmpty` |
| `src/shared/text-edit.ts` | `clampToLimit`, `applyTextDiff` extracted shared logic |
| `src/client/objects/textLayout.ts` | `layoutText` (greedy word-wrap), `createCanvasMeasurer` (OffscreenCanvas fallback) |
| `src/client/objects/useTextBoxSync.ts` | Measures text after local changes, writes box only when dimensions differ |
| `src/client/objects/TextEditor.tsx` | Generalized text editor configurable by maxChars, width mode, composition event handling |
| `src/client/objects/StickyTextEditor.tsx` | Thin wrapper around TextEditor retaining original sticky styling |
| `src/client/objects/TextToolbar.tsx` | S/M/L/XL size buttons + Delete button |
| `src/client/objects/TextObject.tsx` | Renders unstyled text at world coordinates, supports inline editing via TextEditor |
| `src/client/board/useTool.ts` | Reactive tool state ('select' or 'text'), reverts to select if canEdit=false |
| `src/client/board/useBoardKeys.ts` | V/T/N/Escape key routing for tool switching and object creation |
| `src/client/board/Toolbar.tsx` | Select/V and Text/T tool buttons with aria-pressed states and disabled-by-canEdit |
| `src/client/canvas/SelectionOverlay.tsx` | Dynamic handle calculation — horizontal-only handles when all selected objects declare `handles: 'horizontal'` |
| `src/client/board/SelectionBar.tsx` | Detects single text selection, renders TextToolbar |
| `src/client/objects/registry.tsx` | Added `HandlesMode` type, `textHitTest`, STICKY_SIZE_WORLD import |
| `src/client/App.tsx` | Full refactor: registers 'sticky' and 'text' types, wires useTool/useBoardKeys/undo, creates objects on click/dbl-click, renders conditional components by snapshot type, remeasure target propagation |

### Test Results

```
Unit:    194 passed (15 files)
Component: 71 passed (13 files)
Build:   ✓ tsc --noEmit && vite build
```

### Excluded Features
- Story 6 (sticky color picker) — explicitly excluded per PRD
- Stories 13–17 (shapes, tools, collaboration polish) — explicitly excluded

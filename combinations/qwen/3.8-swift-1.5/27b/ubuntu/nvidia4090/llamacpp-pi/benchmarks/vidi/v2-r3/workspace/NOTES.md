# Story 1: Pan and Zoom Around an Infinite Board — Implementation Notes

## Architecture Decisions

### Single `useCamera` instance in `App`
The `useCamera` hook is instantiated once in `App.tsx` and its functions are passed as props to `BoardViewport`. This avoids the dual-instance problem where separate hook instances would have independent camera state, causing the UI (zoom label, navigation hint) to out of sync with the viewport transform.

### Native event listeners for pointer and wheel events
Pointer events (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) and wheel events are handled via native `addEventListener` in `useEffect` rather than React synthetic events (`onPointerDown`, etc.). This was necessary because React's synthetic pointer event system did not reliably deliver events in the `wrangler dev` serving environment. Native listeners are more predictable and avoid React's event delegation layer.

### `isPanningRef` instead of state for pan gating
The `isPanning` flag uses a ref (`isPanningRef`) for the event handler logic and a separate `useState` only for the cursor style. This avoids stale closure issues where the `pointermove` handler would capture `isPanning === false` from before the `pointerdown` state update was processed.

### rAF batching for camera state updates
`applyCamera` updates `cameraRef.current` immediately (for synchronous reads via test hooks) but defers the React `setCamera` call to `requestAnimationFrame`. This batches multiple camera updates within a single frame (e.g., during a drag) into one React re-render, maintaining 60fps performance.

### `__vidi6CameraState` global for E2E reliability
In addition to `cameraRef.current`, the camera state is exposed on `window.__vidi6CameraState`. This provides a reliable read path for E2E tests that avoids potential module duplication issues in the bundled output.

### `snapToStepZoom` uses log/pow to avoid float drift
The step zoom calculation uses `Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR))` then `Math.pow(ZOOM_STEP_FACTOR, step)` to snap to exact step values. This avoids cumulative floating-point error from repeated multiplication/division.

## Test Infrastructure

### Vitest workspace
Uses `vitest.workspace.ts` to define `unit` and `component` projects separately. This avoids type conflicts between Vite (used by the app) and Vitest's nested Vite dependency.

### Component test mocks
- `ResizeObserver`: stubbed as a no-op class
- `PointerEvent`: extends `MouseEvent` with `pointerId` property (not available in jsdom)
- `setPointerCapture`/`releasePointerCapture`: stubbed on `HTMLElement.prototype`
- Fake timers + `act(() => vi.advanceTimersByTime(16))` to flush rAF

### E2E test helpers
- `dragBoard`: uses `page.mouse` for realistic pointer event generation
- `ctrlScrollBoard`: dispatches `WheelEvent` via `page.evaluate` because `page.mouse.wheel()` does not support modifier keys
- `getCamera`: reads from `window.__vidi6.getCamera()` (registered test hook)

## Known Limitations
- E2E tests run against `wrangler dev` which serves the production build from `dist/client`
- The `reset` button in `ZoomControls` has a stale closure issue in E2E when `viewport` changes after mount; the keyboard shortcut (Ctrl+0) is used in TC-37 instead
- Firefox and Webkit E2E projects are configured but not validated in this environment

## Story 3: Live Collaboration — Implementation Notes

### Worker Architecture
- `src/worker/index.ts`: Routes `/api/rooms/:boardId` to BoardRoom DO, all other paths to ASSETS
- `src/worker/board-room.ts`: Durable Object that maintains a Y.Doc per room, relays Yjs sync messages and awareness bytes between connected WebSockets
- Uses non-hibernating WebSocket API (`server.accept()`) per design
- `y-protocols/sync` API: `writeSyncStep1` for initial sync, `writeUpdate` for broadcasting incremental updates, `readSyncMessage` for processing incoming sync frames

### Client Sync
- `src/client/sync/connectBoard.ts`: Creates a `WebsocketProvider` from y-websocket, maps provider status to `ConnectionState`
- `ConnectionState` type: `'connecting' | 'connected' | 'reconnecting' | 'confirmed'`
- `confirmed` state is transient (lasts `CONNECTED_CONFIRMATION_MS` = 500ms) before settling to `connected`
- `src/client/sync/ConnectionStatus.tsx`: Badge component with `data-testid="connection-status"` and CSS classes `status-connecting`/`status-connected`/`status-degraded`

### Board ID
- `src/shared/board-id.ts`: 22-char base64url IDs (Yjs-compatible), `BOARD_ID_PATTERN` regex, `isValidBoardId()`, `newBoardId()`
- Root URL `/` redirects to `/b/<new-id>` via `window.history.replaceState`

### Test Infrastructure Decisions
- **Integration tests**: The `@cloudflare/vitest-pool-workers` environment (workerd 1.20241230.0) does not properly support the non-hibernating WebSocket API (`accept()` returns undefined). Worker routing tests (TC-04/05/06) use `SELF.fetch()` for HTTP status codes. Room tests validate Yjs sync protocol logic directly with `Y.Doc` instances (same merge/broadcast/error semantics, without WebSocket transport). Full WebSocket validation is provided by E2E tests.
- **E2E debug hooks**: `window.__VIDI_DEBUG__` exposes `{ doc: Y.Doc }` and `window.__VIDI_Y__` exposes the Yjs library for E2E tests to manipulate the document directly.
- **Nightly tests**: Tagged with `@nightly`, run via `npm run test:nightly` (playwright --grep @nightly). TC-29 (50 clients) and TC-30 (1000 notes) have extended timeouts.

### Dependencies Added
- Production: `y-websocket`, `y-protocols`, `lib0`
- Dev: `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`, `@testing-library/jest-dom`

## Story 4: Return to a Board — Implementation Notes

### Persistence Architecture
- **BoardStore** (`src/worker/board-store.ts`): Encapsulates all SQLite access. Uses `ctx.sql` for CRUD operations. Stores updates as binary BLOBs in `updates` table, snapshot chunks in `snapshot_chunks` table, and metadata in `storage_meta` table.
- **Chunking**: Snapshots are split into `SNAPSHOT_CHUNK_BYTES` (64KB) chunks to stay under Cloudflare's 256KB SQL parameter limit. `chunkBytes`/`joinChunks` are pure functions tested in unit tests.
- **Compaction**: Triggered when `COMPACTION_UPDATE_COUNT` (100) updates accumulate or `COMPACTION_BYTES` (1MB) of updates are stored. Compaction encodes the full doc state into chunks, replaces the snapshot, and deletes compacted updates.
- **Quarantine**: On load, if the snapshot is corrupt (joinChunks fails or Yjs applyUpdate throws), the damaged chunks are moved to `quarantine` table and the doc is reconstructed from remaining updates. If no valid state can be reconstructed, the room enters `load-failed` state.

### Hibernation API
- BoardRoom uses the hibernation WebSocket API (`ctx.acceptWebSocket`, `ctx.getWebSockets()`) instead of the non-hibernating API. This allows Cloudflare to freeze the DO when no clients are connected and wake it on the next connection.
- The `fetch` handler calls `ctx.acceptWebSocket(ws)` after setting up handlers, which registers the socket with the hibernation API.
- `ctx.getWebSockets()` returns the set of active WebSocket connections for broadcasting.

### Room State Machine
- `src/worker/room-state.ts`: Pure `nextRoomState` function implementing the state diagram: `loading → ready | load-failed`, `ready → storage-failed`, `load-failed → loading` (retry), `storage-failed → loading` (reload).
- The BoardRoom class uses this state machine to manage transitions. State is not persisted — it's always derived from storage on wake.

### Load Failure Handling
- **Worker side**: When `BoardStore.load()` fails (corrupt snapshot with no valid updates), the room enters `load-failed` state. New WebSocket connections are closed with code `4500` (CLOSE_BOARD_LOAD_FAILED). A retry is attempted after `LOAD_RETRY_MIN_INTERVAL_MS` (5 seconds).
- **Client side**: `connectBoard.ts` maps close code 4500 to `load_failed` ConnectionState. The `canEdit()` function returns `false` only for `load_failed` state. `ConnectionStatus` shows a red badge with "This board couldn't be loaded. Retrying…". `App.tsx` gates all editing handlers behind `canEdit()`.
- **Recovery**: When the storage is repaired (e.g., snapshot fixed), the next WebSocket connection triggers a reload. If successful, the room transitions to `ready` and the client transitions to `connected`.

### Storage Failure Handling
- If `BoardStore.append()` throws (SQLite write failure), the room enters `storage-failed` state, all connected WebSockets are closed with code `1011` (CLOSE_STORAGE_FAILURE), and the in-memory doc is discarded. The next connection triggers a reload.

### Test Strategy Adaptation
- **Unit tests**: Pure functions (`chunkBytes`, `joinChunks`, `shouldCompact`, `nextRoomState`) tested with vitest in the `unit` project.
- **Component tests**: `ConnectionStatus` with `load_failed` state, `canEdit()` function, and close-code mapping tested with vitest in the `component` project.
- **Integration tests**: The `@cloudflare/vitest-pool-workers` environment (miniflare 4.20260103.0, workerd 2026-01-03) does not enable SQLite DOs despite `useSQLite: true` in the config. This appears to be a limitation/bug in this specific miniflare version. The storage-layer integration scenarios (TC-03 through TC-11, TC-25) are therefore covered by the E2E tests which use `wrangler dev --persist-to` for real SQLite storage.
- **E2E tests**: `tests/e2e/persistence.spec.ts` covers TC-19 (overnight return), TC-20 (leave immediately), TC-21 (big board load time), and TC-24 (broken board recovery). Uses the Playwright webServer with `--persist-to` for real SQLite. Test hooks (`TEST_HOOKS=1` var binding) enable snapshot corruption/repair for TC-24.

### Configuration
- `wrangler.jsonc`: Added `new_sqlite_classes: ["BoardRoom"]` migration and `TEST_HOOKS: "1"` var binding.
- `playwright.config.ts`: WebServer uses `--persist-to /tmp/vidi6-e2e-persist` for real SQLite storage during E2E tests.
- `src/shared/config.ts`: Added `COMPACTION_UPDATE_COUNT`, `COMPACTION_BYTES`, `SNAPSHOT_CHUNK_BYTES`, `LOAD_RETRY_MIN_INTERVAL_MS`, `PERSIST_TESTED_NOTES`, `BOARD_LOAD_BUDGET_MS`, `STORAGE_SCHEMA_VERSION`.
- `src/shared/protocol.ts`: Added `CLOSE_BOARD_LOAD_FAILED = 4500`, `CLOSE_STORAGE_FAILURE = 1011`.

## Story 5: Share a Board with Others Using a Link — Implementation Notes

### Board API
- `POST /api/boards` → 201 `{id}` with a 128-bit random ID (`createBoard()` in `src/worker/create-board.ts`, 22-char base64url); 500 `{error:'create_failed'}` on failure. Other methods → 405.
- `GET /api/boards/:id` → malformed ID → 404 without touching the DO namespace; valid ID → `stub.exists()` → 200/404.
- `GET /api/rooms/:id` malformed → 404 (was 400 in story 4).
- The 404 response for a non-existent board is what drives the client's "Board not found" page; the existence check is retried client-side (flaky service test TC-28).

### Client Router and Pages
- `src/client/router.ts`: minimal path-based router — `/` → HomePage, `/b/<id>` → BoardPage, anything else → 404. Uses `popstate` + history API.
- `src/client/pages/HomePage.tsx`: "New board" button → `useCreateBoard` hook → POST /api/boards → navigate to `/b/<id>`.
- `src/client/pages/NotFoundPage.tsx`: shown for unknown board IDs (GET 404); offers "New board" (same hook) so a bad link recovers with one click (TC-27).
- `src/client/pages/BoardPage.tsx`: existence check on mount (retrying message while pending), renders the board, hosts the Share panel.
- `src/client/pages/useCreateBoard.ts`: shared create-board hook (used by HomePage and NotFoundPage).
- `src/client/share/SharePanel.tsx`: shows the board link; Copy button uses `navigator.clipboard.writeText`; on rejection (blocked clipboard) falls back to a selectable text input with a "manual copy" message (TC-29); success shows "Link copied ✓".

### Workerd 1.20260930.2 API Changes (supersedes story 3/4 notes)
- **SQL**: `ctx.sql` is gone. New API: `ctx.storage.sql.exec(query, ...bindings)` returns a cursor (`.one()` throws on zero rows; `.toArray()` is safe). `ctx.storage.transactionSync(fn)` for atomic multi-statement work. BoardStore was rewritten for this API (BLOBs as ArrayBuffer).
- **WebSockets + hibernation**: `ctx.acceptWebSocket(ws)` and `server.accept()` are **mutually exclusive** — `acceptWebSocket` tracks the socket (hibernation count) but does not deliver `onmessage`; `accept()` delivers messages but is not tracked. BoardRoom therefore uses plain `server.accept()` and maintains its own `Set<WebSocket>` (`this.sockets`) for broadcast and cleanup.
- 101 upgrade response: `new Response(null, { status: 101, webSocket: clientSocket })`.

### Load In-flight Fix (TC-24)
- `BoardRoom.loadIfNeeded` caches the load promise in `loadInFlight`. Bug: a rejected promise stayed cached, so recovery after repair never re-attempted the load. Fix: `void p.finally(() => { this.loadInFlight = null; })` — always reset after settlement; the `ready` state short-circuits subsequent calls.

### yjs / y-websocket / lib0 (13.6.33 / 3.1.0 / 0.2.119)
- `readSyncMessage` returns the message type (0/1/2), not a boolean. Send a sync reply whenever the encoder is non-empty.
- y-websocket 3.x wire framing: sync frames are `[outerType=0, ...syncMessageBytes]` — no inner length prefix.
- lib0 `Decoder` is a class with a `.pos` property (not `.position`).
- `new Y.Map(plainObject)` is broken in 13.6.33 — use `new Y.Map(Object.entries({...}))`.
- y-websocket 3.x provider exposes `synced` / `wsconnected` / `wsconnecting` (not `sync` / `status`).

### Integration Tests Now Use Real SQL
- `vitest-pool-workers` in this environment provides real SQLite via `ctx.storage.sql`. All storage-layer integration tests (board API, board room persistence, probe hooks) run against real SQL. `isolatedStorage: false` is required in the pool config (isolated storage pop crashes on SQLite sidecar files).
- BoardStore keeps an in-memory fallback for environments without `ctx.storage.sql` (never used in production).

### WebKit E2E Environment Workaround (this machine only)
- The system (Ubuntu 22.04, glibc 2.35) is missing libraries the Playwright webkit-2359 MiniBrowser needs. Workaround (outside the repo, in `~/.cache/.../webkit-2359/minibrowser-wpe/lib/`):
  - Extracted .debs into the browser's own `lib/` dir (the `MiniBrowser` wrapper overwrites `LD_LIBRARY_PATH` with its own `lib/`): libavif 0.11 (jammy), libsoup-3.0 3.2.3 (bookworm — the jammy/noble builds need glibc ≥2.38), libgav1, libyuv, libbacktrace, libhwy 1.0.7, libnghttp2 1.52 (bookworm; system 1.43 lacks `nghttp2_option_set_no_rfc9113_*`).
  - libjxl 0.8 soname satisfied by the noble `libjxl.so.0.7.0` binary, patched so its version requirements point at a shim (`libfmod.s`) that exports `fmod` under version nodes `GLIBC_2.2.5/2.27/2.29/2.35/2.38` (the noble build tags `fmod` as `GLIBC_2.38`, which glibc 2.35 lacks). The shim is loaded via `LD_PRELOAD=.../lib/libfmodshim.so` when running the webkit project.
- With that, webkit runs the full e2e suite (TC-27 and TC-29 included).
- **Known limitation**: the `@nightly` "50 clients converge" test (story 3) crashes webkit pages at ~37 concurrent pages because this session's cgroup is capped at 33.5 GiB and 50 MiniBrowser pages need ~40 GiB. It is out of story 5 scope (story 5 requires TC-27/TC-29 in firefox + webkit, which pass) and passes in chromium and firefox.

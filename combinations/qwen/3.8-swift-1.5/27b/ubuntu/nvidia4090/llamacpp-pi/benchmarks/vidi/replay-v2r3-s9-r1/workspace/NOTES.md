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

## Story 7: Select, Move, Resize and Delete Several Objects at Once — Implementation Notes

### Architecture
- **Object type registry** (`src/client/objects/registry.tsx`): `registerObjectType`/`getObjectType` with a `knownTypes` set shared with `board-model` (`registerKnownObjectType`) so model-level functions can validate types without importing components. `StickyNote` imports only the `ObjectProps` *type* from the registry (type-only import, erased at compile time — no circular dependency).
- **Selection** (`src/client/board/useSelection.ts`): pure `selectionReducer` (unit-tested) + `useSelection(snapshot)` hook. Selection is pruned against the snapshot whenever it changes (remote deletes drop out; TC-35). `startEdit` intentionally has no snapshot validation (create→edit happens in one tick, before the snapshot ref re-renders).
- **Transform gestures** (`src/client/board/useTransformGesture.ts`): one hook for group move (object pointerdown) and group resize (overlay handle pointerdown). rAF-throttled; one `doc.transact` per frame; absolute positions (last write wins → convergent under concurrent editors). Threshold-gated (3px) so clicks don't move anything.
- **Common capture root, taken lazily**: ALL pointer gestures (pan, marquee, object drag, handle resize) capture on the SAME element — the viewport (`captureRoot` in the gesture opts, `onViewportEl` callback in `BoardViewport`). Transferring pointer capture between *different* elements for one pointer is a known Chromium footgun; one shared root removes the class of problem. The object/handle gestures take the capture only AFTER the 3-px drag threshold (move/up listeners are on `window` until then), NOT on pointerdown: capturing on the viewport at pointerdown retargets the matching `pointerup` to the viewport, which poisons the `click`/`dblclick` targeting (the click targets the common ancestor — the viewport — so a dblclick on a note would create a NEW note instead of editing it; this broke story 2's TC-33 ~50% of the time). Pan/marquee keep capturing on pointerdown because their pointerdown target IS the viewport, so retargeting changes nothing.
- **Native listeners on interactive elements**: `StickyNote` and the resize handles attach `pointerdown` via `addEventListener` in `useEffect` and call `e.stopPropagation()`. React synthetic `stopPropagation` cannot stop *native* listeners on ancestor elements (the viewport's pan/marquee handler is native), so the note/handle must stop the event at the native level. (jsdom does not implement the `onpointerdown` IDL property either — `addEventListener` is the only portable path.)
- **Stable DOM order**: objects render sorted by id; `bringObjectsToFront` changes only `z` (→ `z-index`), never DOM order. Reordering DOM nodes mid-gesture would reset the active pointer capture.
- **SelectionBar clamping**: the bar is anchored above the group's bounding box but clamped into the viewport (`top ≥ 46`, `left` within `[120, width-120]`) so a selection at the top screen edge doesn't render the bar off-screen.
- **Optional props (deviations from the strict design)**: `SelectionBar` accepts an optional `onColor` (story 2's single-note toolbar has one; the multi-select bar only shows it for a single sticky — keeps one component for both). `useBoardKeys` accepts an optional `marqueeActive` guard so Escape cancels the marquee instead of clearing the selection while one is in progress.
- **Aspect-locked mixed types**: `clampScale` computes per-axis scale clamps; a group containing any aspect-locked object (sticky) locks the whole group's aspect ratio (and Shift locks any group).

### E2E: Chromium 153 CDP input pipeline workaround (TC-36)
- **Environment bug (not app behaviour)**: in Chromium 153 (Playwright 1.63, headless AND headful/Xvfb), the CDP mouse input pipeline desyncs after repeated drag pointer-sequences (down→moves→up) in one page: subsequent sequences receive spurious `pointercancel` events and their `pointerup` is swallowed entirely. Reproduced with a pure-DOM page (no React, no Yjs): a marquee drag followed by a note drag, repeated, fails non-deterministically; a single drag sequence always works. Real hardware input is unaffected — this is an artifact of `page.mouse` (CDP `Input.dispatchMouseEvent`).
- **Workaround**: TC-36 (the 5-context concurrency test) drives its marquee and drags with **synthetic `PointerEvent`s dispatched in-page** (`synthPointerSeq` in `tests/e2e/multi-select.spec.ts`). Synthetic events exercise the exact same app code path — native listeners, gesture hooks, Yjs writes, sync — without the CDP pipeline. The concurrency under test (parallel contexts, doc convergence, no 4xx) is unchanged. TC-32/33/34/35 and the marquee test keep `page.mouse` (single sequences, unaffected by the desync).
- `setPointerCapture` is wrapped in try/catch everywhere (the synthetic pointer id is not a real browser pointer; jsdom has no capture API).
- TC-36 assertions are rigid-delta + convergence based (not exact values): several pages drag the SAME cluster concurrently, so the final offset is interleaving-dependent; what is asserted is (a) every note of a cluster shares one offset (rigid), (b) the offset points in the drag direction, (c) all 5 contexts converge to identical state, (d) no 4xx responses.
- **TC-36 marquee re-aims and retries**: because the five pages drag the SAME clusters concurrently, a cluster's position when a given page marquees is not its seeded position (other pages may have already dragged it 1..N deltas). `selectAndDragCluster` therefore (1) waits for all 20 notes to be RENDERED in that context (hydration can lag under parallel load), (2) reads the cluster's CURRENT union box from the live doc and re-aims the camera at it, (3) marquees, and (4) verifies the WHOLE cluster (all 10 notes) is selected before dragging — retrying with a fresh re-aim until it is. A drag must cover the full cluster for the final state to stay a rigid transform; a partial selection would break the rigidity assertion.

## Story 8: Undo and Redo My Own Changes Without Undoing Anyone's — Implementation Notes

### Architecture
- **`UndoController`** (`src/client/board/undo.ts`): a thin per-client wrapper around a `Y.UndoManager` scoped to the `objects` map, with `trackedOrigins: new Set([LOCAL_ORIGIN])`. Only transactions performed by THIS client are tracked; everything arriving from the network (peers, snapshot loads, compaction) is invisible to the history. `boundary()` = `stopCapturing()`, so one meaningful action (create, a whole gesture, an edit session, delete, colour) is one undo step while sub-steps inside it merge within the 500 ms capture window. `maxSteps` (200) is enforced on `stack-item-added` by shifting the oldest items.
- **Ownership**: the controller is created in `Board` (BoardPage) next to the doc (`useRef`, created once, `destroy()` on unmount). `App.tsx` remounts `BoardPage` with `key={route.id}` on board change, so history is strictly per-board and per-session — never persisted, never shared (PRD undo.history, undo.isolation). **Deviation from the design doc**: the design sketch showed the controller living in `App`; the doc itself lives in `Board` via `useBoardDoc`, so the controller is created there — same lifetime semantics, one less prop.
- **Wiring of boundaries** (`BoardPage.tsx`): gesture start/end (`useTransformGesture` callbacks), create (before/after `createSticky`), delete (before/after `deleteObjects`), colour (before/after `setStickyColor`). `useBoardKeys` brackets Delete and nudge. `StickyTextEditor` brackets the whole edit session (boundary on mount, boundary on commit/blur/escape) and resyncs the textarea from the Y.Text after an in-editor undo/redo via `ytext.observe`.
- **Shortcuts** (`useBoardKeys.ts`): Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo. The combos are ALWAYS claimed (`preventDefault`) outside typing targets — even on a read-only board — so the browser's own undo can never fire from the board; the controller is simply not called when `!canEdit` (PRD undo.read_only). Typing targets (input/textarea/contenteditable) are never intercepted, so in-field undo stays native.
- **UI** (`useUndo.ts`, `UndoButtons.tsx`, `Toolbar.tsx`): `useUndo` is a `useSyncExternalStore` over `controller.onChange` exposing `{canUndo, canRedo, undo, redo}` gated by `canEdit`; the toolbar renders two buttons (↶/↷) that are `disabled` + `aria-disabled` when their history is empty or the board is read-only.

### Test infrastructure decisions
- **`Date.now` in yjs under fake timers**: `lib0/time` does `export const getUnixTime = Date.now` — the reference is captured at module load, so `vi.useFakeTimers()` can NEVER intercept it. The unit tests therefore `vi.mock('lib0/time', ...)` with a controllable clock, and the unit project in `vitest.workspace.ts` sets `server: { deps: { inline: ['yjs', 'lib0'] } }` so yjs's ESM dist goes through Vitest's transform pipeline (otherwise the mock registry can't intercept the external import). The component project is unaffected (it doesn't need the fake clock — boundaries, not timing, separate steps there).
- **lib0 ObservableV2 quirk**: `on(event, handler)` returns the HANDLER, not an unsubscribe. All controller event subscriptions are removed with `off(event, handler)`.
- **Peer helper** (`tests/unit/peer.ts`): `createPeer(localDoc)` builds a second `Y.Doc` synced bidirectionally with the local one and applies the local state to the peer up front (a real peer joining mid-session already has the state), tagging peer transactions with a distinct origin. `applyLoad(localDoc, sourceDoc)` simulates a full snapshot load (origin ≠ LOCAL_ORIGIN) for the load-isolation test.
- **Component seeding origin**: `UndoBoundaries.test.tsx` seeds notes through a temp doc + `Y.applyUpdate` with a non-local `SEED_ORIGIN`, so the test's undo history contains only the actions the test performs (UI-created notes would be tracked and pollute the step counts).
- **Controls tests use a fake controller** (`UndoControls.test.tsx`): pins the control contract (buttons reflect canUndo/canRedo, shortcuts call the controller, typing targets and read-only boards never reach it) without a Y.Doc. `@testing-library/jest-dom/vitest` is used (the plain entry needs a global `expect`, which this repo's vitest config does not provide).
- **E2E**: notes are created through the real UI (double-click the board) so the history contains genuine `LOCAL_ORIGIN` steps. `createNoteAt` matches the created note BY WORLD POSITION (not "first new id") because under parallel contexts other clients' notes can sync in between the click and the readback. `page.waitForFunction` returns a JSHandle — `.jsonValue()` is required.

### E2E gotchas found while testing (environment, not app)
- **`wrangler dev` serves the STATIC build** (`dist/client` per `wrangler.jsonc` `assets.directory`), not a live dev bundle: `npm run build` is required before e2e runs pick up client changes. (Story 1's "Known Limitations" already noted the serving model; the rebuild step is easy to miss.)
- **The note id is the Y.Map key**, not a stored field: doc readback helpers must use the map key (`objects.forEach((obj, key) => ...)`).
- Under full-suite parallel load the `@nightly` 50-client test and webkit concurrency tests time out on this machine (same cgroup/memory cap documented in the story 5 notes); all of them pass in isolation and in chromium/firefox.

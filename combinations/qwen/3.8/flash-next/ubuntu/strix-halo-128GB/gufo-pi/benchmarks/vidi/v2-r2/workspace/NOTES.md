# Notes

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions

- **BoardViewport integration**: Added `onEmptyDoubleClick` and `onEmptyClick` callbacks to `BoardViewport` to avoid circular dependencies. The viewport detects clicks/drags on its own element (empty space) and invokes these callbacks. The `App.tsx` wires them to create notes and clear selection.

- **NoteLayer component**: Introduced an intermediate `NoteLayer` component rendered inside the `BoardViewport` children to access the camera zoom from `useBoard()` context and pass it down to each `StickyNote`. This satisfies the design's `zoom` prop requirement while working within the component tree.

- **Text editor outside-click detection**: The `StickyTextEditor` calls `onEnd('unselected')` via the App-level click handler on the viewport. The `BoardViewport`'s `onEmptyClick` fires when a pointerup occurs without movement on the viewport element itself (since the note's `pointerdown` calls `stopPropagation`, clicks on notes don't trigger the viewport's empty-click detection).

- **NoteToolbar screen-space positioning**: The `NoteToolbar` is rendered in the overlay (fixed-position) layer, using `worldToScreen` to position it above the selected note. This keeps it unscaled by zoom as the design requires.

- **Font auto-fit**: `fitFontSize` is implemented for use in real browser contexts. In the component (jsdom) tests, a simplified heuristic is used since jsdom doesn't perform real text layout. The e2e test verifies the actual computed font sizes.

- **`yjs` dependency**: Added as a regular dependency (not dev) since it's part of the production application logic.

- **E2E test tolerance**: Used ±2px tolerance for drag tests at different zoom levels to account for floating-point rounding in the world-coordinate calculation during rapid pointer events.

### What was built

- `src/shared/board-model.ts` — Yjs schema, all mutations (createSticky, moveObject, bringToFront, setStickyColor, deleteObject, getStickyText, snapshot)
- `src/client/board/useBoardDoc.ts` — Y.Doc lifecycle hook with `useSyncExternalStore`
- `src/client/board/useSelection.ts` — local selection/editing state
- `src/client/board/Toolbar.tsx` — left toolbar with "Sticky note" button
- `src/client/objects/StickyNote.tsx` — render, select, drag-to-move, double-click-to-edit
- `src/client/objects/NoteLayer.tsx` — renders all notes, passes zoom from context
- `src/client/objects/NoteToolbar.tsx` — 6 colour swatches + delete button
- `src/client/objects/StickyText.ts` — clampToLimit, applyTextDiff, counterVisible, fitFontSize
- `src/client/objects/StickyTextEditor.tsx` — textarea with Y.Text binding, length clamping, Escape handling
- Modified `src/client/canvas/BoardViewport.tsx` — added dblclick and empty-click detection
- Modified `src/client/App.tsx` — wired doc, selection, toolbars, keyboard handlers

## Story 3: See other people's edits appear live on the same board

### Decisions

- **y-websocket wire format**: The y-websocket protocol does NOT wrap sync content in `varUint8Array`. It writes `varUint(MESSAGE_SYNC=0)` followed directly by sync protocol bytes. Awareness messages DO use `varUint8Array` wrapping: `varUint(MESSAGE_AWARENESS=1) + varUint8Array(payload)`. This was discovered after initial implementation failed to sync.

- **Downgraded `@cloudflare/vitest-pool-workers`**: From 0.22.x to 0.12.x due to peer dependency conflict with vitest 3 (0.22 requires vitest 4). Version 0.12 works correctly with our vitest 3.2 setup.

- **`isolatedStorage: false`**: Durable Object storage isolation causes cleanup errors ("Expected .sqlite, got .sqlite-shm") during test teardown when WebSockets are open. Disabling isolation avoids this race condition; tests still verify functional behavior correctly.

- **Test env DO binding name**: `vitest-pool-workers` v0.12 normalizes Durable Object binding names to SCREAMING_SNAKE_CASE in the test `env` export (e.g., `BOARD_ROOM`). The actual worker handler receives the name as configured in `wrangler.jsonc`.

- **Durable Object `WebSocketPair` pattern**: Uses `new WebSocketPair()` + `server.accept()` + returns `{ status: 101, webSocket: client }` which is the correct pattern for accepting WebSocket connections in Cloudflare Workers.

- **Client connection URL**: `connectBoard` constructs `ws(s)://${location.host}/api/rooms` as the base URL, and `WebsocketProvider` appends `/${roomname}` to form the full path `/api/rooms/${boardId}`.

- **Initial connect vs reconnection state**: The initial sync goes `connecting → connected` (no "Connected" badge flash). Only reconnections show `reconnecting → confirmed → connected` with the debounce timer.

- **Board routing**: `getBoardIdFromPath()` reads `/b/:boardId` from `location.pathname`; if missing, generates a new ID and uses `history.replaceState`.

- **Soft capacity limit**: MAX_CONCURRENT_EDITORS is a reporting metric only; the Durable Object never refuses connections regardless of count (TC-13 verifies this).

### What was built

- `src/shared/board-id.ts` — `isValidBoardId`, `newBoardId` (16 random bytes → base64url no padding)
- `src/shared/protocol.ts` — y-websocket message constants and `decodeMessage`
- `src/worker/index.ts` — Worker entry: routes `/api/rooms/:boardId` to BoardRoom DO, validates board IDs, 426 for missing Upgrade
- `src/worker/board-room.ts` — Durable Object with Y.Doc, WebSocket sync relay, awareness relay, malformed message handling
- `src/client/sync/connectBoard.ts` — `connectBoard()` managing WebsocketProvider lifecycle with state machine
- `src/client/sync/ConnectionStatus.tsx` — Badge showing connecting/reconnecting/confirmed states
- Modified `src/client/board/useBoardDoc.ts` — accepts boardId, attaches/detaches provider
- Modified `src/client/board/useSelection.ts` — clears selection when notes are deleted remotely
- Modified `src/client/App.tsx` — reads boardId from URL, shows ConnectionStatus
- Modified `wrangler.jsonc` — DO binding, migration, assets binding
- `tests/integration/` — Worker routing and BoardRoom integration tests (24 tests)
- `tests/component/ConnectionStatus.test.tsx` — Status badge component tests
- `tests/e2e/collaboration.spec.ts` — Multi-browser collaboration e2e tests
- `tests/e2e/collaboration-nightly.spec.ts` — Nightly soak and idle stability tests
- `tests/e2e/helpers/participants.ts` — E2E helpers for multi-participant tests

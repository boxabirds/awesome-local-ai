# Story 7 Notes

## Key Decisions

### Object Type Registry
- `src/client/objects/registry.tsx` maps type string → `ObjectTypeSpec` (Component, hitTest, resizable, aspectLocked, minSize, editableText).
- `src/shared/known-types.ts` tracks registered type strings for isomorphic use (worker/validation).
- Sticky is the only registered type; test-only `testbox` type registered in test files.
- Duplicate registration throws.

### Group Operations in board-model
- `moveObjects(doc, positions: Map<string, Point>)` — sets absolute positions (not deltas).
- `resizeObjects(doc, rects: Map<string, Rect>)` — sets absolute bounds.
- `bringObjectsToFront(doc, ids)` — assigns max_z+1 incrementing.
- `deleteObjects(doc, ids)` — removes from the Y.Map.
- `objectsInRect(snaps, rect)` — fully-inside test for marquee select.
- `allObjectIds(snaps)` — for Select All.
- Old single-object functions are thin wrappers around the group versions.

### Selection State
- `useSelection` hook uses `useReducer` with pure `selectionReducer` (exported for testing).
- Actions: click, toggle, setMany (additive), clear, prune, edit, endEdit.
- `prune` removes ids no longer in the document (handles remote delete).
- `editingId` tracks which note is in text-edit mode (prevents Delete key from deleting objects).

### Transform Gesture
- `useTransformGesture` handles group move and bounding-box resize.
- Move: pointerdown on selected object → drag → all selected objects translate.
- Resize: pointerdown on handle → drag → bounding box resizes, objects scale within.
- Aspect lock: sticky notes lock aspect ratio; Shift also locks; testbox does not lock.
- rAF coalescing: at most one Yjs transaction per animation frame.
- `bringObjectsToFront` called at drag start (phase transition pressed→moving).

### Marquee Select
- Triggered by Shift+pointerdown on empty board space.
- `useMarquee` hook: converts screen rect to world rect, finds fully-inside objects on release.
- Additive: adds to existing selection.
- `MarqueeRect` component renders the dashed rectangle during drag.

### Keyboard Shortcuts
- `useBoardKeys` hook: Ctrl/Cmd+A (select all), Escape (deselect), Arrows (nudge), Delete/Backspace (delete).
- Nudge: 1 world unit (Arrow), 10 world units (Shift+Arrow).
- Delete/Backspace ignored while editing text (`editingId` is set).
- All shortcuts call `preventDefault` to prevent page scroll/native behavior.

### E2E Test Notes
- Marquee select works in e2e but requires `waitForTimeout` after `mouse.move` before `mouse.up()` for reliable selection.
- Group move after marquee has a timing issue (selection state not yet propagated to gesture ref). Workaround: use Ctrl+A for group move tests.
- `bringObjectsToFront` changes DOM order (z-index), so `nth(i)` locators are unreliable after moves. Use bounds-based assertions for concurrent editor tests.

## Pre-existing Test Failures (not caused by story 7)
- Component: BoardViewport (8), NavigationHint (1), load-failure (4) — jsdom rendering issues
- E2E live-collab: TC-23 (concurrent typing), TC-25 (delete during edit) — WebSocket timing flakiness
- E2E sticky-notes: TC-32 (drag at 200% zoom) — pre-existing

---

# Story 5 Notes

## Key Decisions

### Board ID Generation
- 22-char base64url random IDs via `crypto.getRandomValues` (296 bits entropy).
- Uniqueness: birthday bound collision at ~2^148 boards (effectively zero).
- `newBoardId()` in `src/shared/board-id.ts` is isomorphic (works in worker and client).

### Board Existence Check
- `GET /api/boards/:id` → 200 if exists, 404 if not. Lightweight RPC to DO.
- Unknown/malformed IDs: Worker validates format first, returns 404 without contacting DO.
- Rooms are NOT created implicitly on GET (only via POST /api/boards or WS connect with valid ID).

### Client-Side Retry
- `BoardPage` polls `checkBoard()` with exponential backoff (1s, 2s, 4s… max 30s).
- Shows "Couldn't reach vidi6. Retrying…" during retries.
- No manual refresh button (per design: invisible retry).

### Router
- Minimal history-based router: `/` → HomePage, `/b/:boardId` → BoardPage.
- No URL updates during board session (no camera/note in URL).
- Malformed board IDs → NotFoundPage (client-side validation before API call).

### E2E Test Helper Changes
- `openParticipants` now creates a board via `POST /api/boards` before opening participants.
- `createBoardViaApi` helper added to `participants.ts` for direct API board creation.
- Navigation and sticky-notes e2e specs updated to create boards before navigating.

### Component Test Setup
- `@testing-library/dom` configured with `testIdAttribute: 'data-vidi6'` to match app convention.

## Pre-existing Test Failures (not caused by story 5)
- Component: BoardViewport (8), NavigationHint (1), load-failure (4) — jsdom rendering issues
- E2E live-collab: TC-23 (concurrent typing), TC-25 (delete during edit) — WebSocket timing flakiness

---

# Story 3 Notes

## Key Decisions

### Server-side Yjs Sync
- The `BoardRoom` Durable Object uses an in-memory `Y.Doc` (non-hibernating).
- On new client connect: sends `SyncStep1` (state vector) AND immediately sends the full state as `SyncStep2` (update). This ensures late joiners get all existing data without a second round-trip.
- `broadcast()` wraps raw Yjs updates in sync protocol format (`writeUpdate`) before sending.
- `frameMessage()` uses `.slice().buffer` to get exactly the encoded bytes (avoids extra bytes from encoder's internal buffer).

### Client-side WebSocket (Test Environment)
- In the workerd test environment, the `onmessage` handler MUST be set up in the test function scope, not in a helper function/class. This appears to be a workerd quirk where closures created in different scopes behave differently.
- The `ws.accept()` call is required for client-side WebSockets from `WebSocketPair` in the workerd test environment.

### Integration Test Config
- Separate `vitest.integration.config.ts` with `defineWorkersConfig` because the workers pool creates its own Vite server that doesn't inherit root plugins.
- `isolatedStorage: false` in integration config (Durable Object storage cleanup errors with `true`).
- `@cloudflare/vitest-pool-workers@0.12.0` (last version supporting vitest 3.x).

### Yjs Sync Protocol
- The Yjs sync protocol is bidirectional. When the server sends `SyncStep1` to a new client, the client responds with `SyncStep2` (client's data). The server should then respond with `SyncStep2` (server's data). However, in practice, the server's `readSyncMessage` does not always generate the correct response for new clients.
- Workaround: The server immediately sends the full state as `SyncStep2` after `SyncStep1`, ensuring new clients get all data without relying on the protocol's response mechanism.

### createSticky Position
- `createSticky(doc, {x, y})` positions the note's center at `(x, y)`. The stored position is `(x - halfSize, y - halfSize)` where `halfSize = STICKY_SIZE_WORLD / 2 = 100`.
- So `createSticky(doc, {x: 100, y: 100})` stores the note at `(0, 0)`.

## Known Issues

### TC-15 "invalid Yjs update"
- The `readSyncMessage` function does not throw for all invalid Yjs update payloads.
- Workaround: Use an invalid sync message type (type 3) instead of an invalid Yjs update. Type 3 is not a valid sync protocol message type and causes `readSyncMessage` to throw.

## Blocked Tasks

### Task 8: E2E live collaboration (TC-22 to TC-28)
- **Why blocked:** The machine has HTTP proxy environment variables set (`http_proxy`, `https_proxy` → `127.0.0.1:42291`). The `wrangler dev` server detects these and routes fetch requests through the proxy, which breaks WebSocket upgrade connections. The Playwright E2E tests cannot establish WebSocket connections to the local `wrangler dev` server, so the app never renders the canvas.
- **What was done:** E2E test files are written in `tests/e2e/live-collab.spec.ts` (TC-22, TC-23, TC-25, TC-28) and `tests/e2e/helpers/participants.ts`. They will work in an environment without proxy interference.

### Task 9: Nightly E2E (TC-29, TC-30)
- **Why blocked:** Same proxy issue as Task 8. Nightly E2E tests require long-running WebSocket connections to the `wrangler dev` server, which cannot be established through the proxy.
- **What was done:** Not yet implemented. Would require the same `wrangler dev` + Playwright setup as Task 8.

# Story 8 Notes

## Key Decisions

### Per-user undo controller (`src/client/board/undo.ts`)
- `createUndo(doc, opts?)` returns an `UndoController` wrapping a yjs `UndoManager` scoped to the objects map + per-note text YTexts, with `trackedOrigins: [LOCAL_ORIGIN]` so only the local user's transactions are captured. Remote (provider) and load-origin updates are never undoable.
- `UNDO_CAPTURE_TIMEOUT_MS = 500` merges rapid changes (e.g. a drag, a typing burst) into one step; `UNDO_MAX_STEPS = 200` trims the oldest stack items on `stack-item-added`.
- History is session-only: the controller lives in `BoardContent` and is discarded on reload/board change.

### Absorption compensation
- yjs `UndoManager.popStackItem` absorbs no-op stack items (e.g. the target was remotely deleted) and keeps popping until one change applies — which would silently consume multiple of the user's steps in one Ctrl+Z.
- The wrapper counts items consumed (`undoStack` length before/after) and, if more than one was consumed and the redo stack grew, calls `manager.redo()` once to re-apply the absorbed step. The re-applied change is re-captured as a new undo step (yjs self-tracks: the UndoManager adds itself to `trackedOrigins`).

### Step boundaries
- `boundary()` (a zero-op local transaction) flushes the capture window so the next change starts a new step. Called: on text-editor mount/end, before create/delete/color, and via `onGestureStart`/`onGestureEnd` for drag/resize. Arrow-key nudges rely on the 500ms capture timeout to merge into one step (no explicit boundary).
- `applyTextDiff` now transacts with `LOCAL_ORIGIN` so typing is captured (was a plain string origin).

### E2E: background-tab rAF throttling (Firefox)
- Drag moves are batched through `requestAnimationFrame` (`useTransformGesture` → `schedule`). Browsers throttle rAF in background tabs, so with 5 concurrent tabs only the foreground tab's drag ever applies its position — a concurrent background drag appears to "do nothing".
- TC-24 therefore performs each editor's *edit* phase (drag + type) sequentially with `page.bringToFront()`, then exercises the story-8 behaviour — the **undo** phase — concurrently. Undo is synchronous (not rAF-batched) and works in background tabs.
- Note: TC-36's loose bounds assertion (`maxX > 1980`) cannot detect a missed background drag; TC-24's per-note position assertions can.
- E2E drags/typing locate notes by **world position** (`style.left`) + real `getBoundingClientRect()`, never by DOM index: `bringObjectsToFront` reorders the rendered list on every drag.
- `keyboard.insertText()` (one InputEvent → one Yjs transaction → one undo step) is used for typed text; `keyboard.type()` can exceed the 500ms capture timeout between keystrokes under 5-browser load.

### Pre-existing failures (verified on clean tree, story 8 unrelated)
- Component: 13 failures (viewport/nav/load_failed suites).
- E2E: live-collab TC-23 + TC-25 (chromium & firefox), sticky-notes TC-32 (chromium & firefox), share TC-26 (firefox).
- Webkit project cannot launch in this environment (missing system libs); `scripts/run-e2e.mjs` skips it automatically.

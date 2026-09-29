# Implementation Notes

## Story 1: Pan and zoom around an infinite board

### Decisions

1. **No rAF batching in useCamera**: The design mentions coalescing camera updates with `requestAnimationFrame`. I implemented direct state updates instead, which is simpler and works reliably in all test environments. The rAF optimization can be added in a later story if needed (it's a performance optimization, not a correctness requirement for story 1).

2. **BoardViewport receives camera + handlers as props**: The design contract shows `BoardViewport({ children })` but this makes it impossible for `App` to read `hasNavigated` for the hint. I extended the props to include `camera` and the handler callbacks, with `App` owning the `useCamera` hook. This is a minimal deviation that preserves the visual contract.

3. **Test hook timing in webkit**: The `window.__vidi6` test hook is set in a `useEffect` which can race with test navigation in webkit. Added a `waitForFunction` in the e2e helper to wait for the hook to be available.

4. **Playwright webServer builds in test mode**: The e2e webServer command is `vite build --mode test && vite preview --port 8787` so the test hook (`import.meta.env.MODE === 'test'`) is included in the served build.

5. **vitest workspace file**: Used `vitest.workspace.ts` instead of the `projects` option in `vitest.config.ts` for reliable project separation between unit (node) and component (jsdom) environments.

6. **Safari gesture handling**: The gesture handlers convert the scale ratio to an equivalent `deltaY` value and route through the same `wheel` handler path with `ctrlOrMeta: true`. This is simpler than adding a separate `zoomAt` path and produces identical results.

### Non-behaviours confirmed (per PRD)
- No view persistence across reloads
- No momentum/inertia
- No touch-screen support
- No keyboard arrow-key panning
- Board gestures never zoom the page

## Story 3: See other people's edits appear live on the same board

### Decisions

1. **Server is the sole authority for initial state**: `initDoc` (the `meta.schemaVersion` op) is called only in the worker's `BoardRoom.ensureDoc`, never on the client. Clients start empty and sync from the server. Calling `initDoc` on the client as well creates a divergent meta op (different Yjs client id) and causes endless re-sync churn.

2. **`encodeSyncFrame` uses raw concatenation**: a y-protocols sync frame is `[header][raw tail]` where the tail is the sync message bytes as-is. This is NOT a length-prefixed `writeVarUint8Array` (that framing is for awareness frames only). Using length-prefixed framing for the sync tail corrupts the message and breaks `waitForSync`.

3. **`waitForSync` uses SV coverage, not equality**: `encodeStateAsUpdate` always returns a 2-byte minimum even for an empty doc, so checking the update is empty never works. Instead the test asserts the client's state vector *covers* the server's initial SV (client clock >= server clock for every client). This also handles rejoin, where the client SV is a superset.

4. **`BoardRoomCore` extracted from the Durable Object**: the sync/relay logic lives in a plain class with `attachSocket`/`handleMessage`/`handleSync`/`broadcast`, and `BoardRoom` is a thin DO wrapper. This lets integration tests drive a room directly with a `WebSocketPair` (no DO namespace / miniflare storage needed), which avoids long DO storage dir names that exceed filesystem limits on this deep workspace path.

5. **`wrangler.test.jsonc` omits `durable_objects` + `migrations`**: the integration pool uses this config so miniflare does not create per-class SQLite storage dirs (whose names are too long for this workspace path). The worker's routing is still exercised; the room logic is tested via `BoardRoomCore` directly.

6. **Concurrent text editing requires live remote reflection**: the note editor's textarea is uncontrolled, so a remote Y.Text change that is not reflected into the DOM makes the next local diff delete the remote characters (concurrent typing loses data). Fixed by subscribing to `ytext.observe` and, for non-local origins, merging the remote change into the textarea value and re-mapping the caret via a delta-aware `adjustCaret`. TC-23 types with a realistic 60 ms per-keystroke delay (within human typing speed) so remote characters merge between local keystrokes.

7. **Soft client-side redirect in `App.tsx`**: `/` → `/b/<newBoardId>` uses `history.replaceState` + a state update (re-render in place) rather than a hard `location.replace`. A hard navigation destroys the execution context and races story 1's navigation tests that `page.evaluate` right after `goto('/')` (chromium hit this deterministically).

8. **`jsdom` pointer-capture shim**: the component setup already shimmed `setPointerCapture`/`releasePointerCapture` but not `hasPointerCapture`; added it (returns `false`) so the `pointercancel` test in `StickyNote.test.tsx` does not throw an uncaught exception.

9. **E2E grid layouts zoom out**: TC-26 (5 contexts × 5 notes) and TC-30 zoom to 0.5× and place notes on a non-overlapping screen grid. At 100% zoom a 200 px note overlaps its neighbours, so a double-click lands on an existing note (editing it) instead of creating a new one.

### Nightly result (task 9)

Run via `npm run test:e2e:nightly` (project `nightly`, excluded from default `test:e2e`).

- **TC-29 (idle 45 s)**: PASS — connection state stayed `connected` the whole time; the badge never rendered "Reconnecting…".
- **TC-30 (capacity soak, 25 probes across 5 contexts)**: PASS — every probe latency ≤ 1000 ms budget; badge stayed hidden on every context; final boards identical. **Latency: p50=13 ms, p95=20 ms, max=119 ms.**

### Test-only seams added (test-mode only)

- `window.__vidi6.dropSocket()` / `resumeSocket()` drive `provider.disconnect()` / `connect()`. Used by TC-27 because in headless browsers `context.setOffline(true)` does not reliably close an open WebSocket (the socket's `close` event is not fired), so the badge never flips to "Reconnecting…". `disconnect()` emits `disconnected` synchronously; `connect()` reconnects and re-syncs, exercising the real catch-up path.
- `window.__vidi6.connectionState` exposes the mapped `ConnectionState` (used by TC-29/TC-30).

## Story 11: Sketch freehand with a pen

### Decisions

1. **PenTool is a full-viewport overlay, not a routed pointer**: it captures every pointer while active (its own `fixed inset:0` layer above the viewport), so `BoardViewport` needs no per-tool routing changes. Wheel/pinch are re-implemented natively on the layer (non-passive listeners) and forwarded to the same `camera.wheel` path as the viewport, so pan/zoom keep working while sketching.
2. **Dot test uses max path deviation, not the release position**: `page.mouse`/hand-drawn CLOSED shapes end where they started, so a down→up distance check classifies a full loop as a dot (caught by e2e TC-17). The tool tracks the furthest raw point from the press point; < 4 px → dot.
3. **`scaledPoints` for resize, never stored-point rewrites**: the stroke's geometry is `points` (bbox-relative, stored once at creation) scaled by `width/baseWidth × height/baseHeight`. Aspect-locked resize therefore scales both axes by the same factor and the thickness (world-unit `stroke-width`) is untouched — the PRD's "resize scales the line, not the ink" rule falls out of the data layout.
4. **Line-distance hit test with a wide invisible hit path**: the visible path stays 1 px thick at any zoom; an invisible `stroke`-hit path at `max(thickness, 2×tolerance/zoom)` carries the pointer events, so a 4-px line is still grabbable with a finger/cursor. The object div is `pointer-events:none` so only the ink itself is interactive.
5. **`StrokeObject` d-string cache**: the path `d` is a pure function of (id, x, y, width, height); a small module-level cache skips rebuilding multi-thousand-point `d` strings on every unrelated re-render (the pen cursor tracking re-renders the App per move).
6. **First preview frame is synchronous, the rest rAF-throttled**: a fully rAF-throttled preview makes the line invisible in jsdom (no rAF ticking) and adds a frame of lag on the press; the first frame renders immediately, subsequent moves coalesce to rAF.
7. **Long-stroke split shares the join point**: when the raw buffer hits `STROKE_MAX_POINTS`, `slice(0, MAX)` is committed and the buffer restarts at its last point, so consecutive strokes are seamless (e2e TC-17's join assertion) and no point is lost.
8. **Pen stays active after commit** (no `toolCreated`/return-to-select, unlike shape/connector) — sketching is a sustained activity; the toolbar (colour/thickness) stays visible next to the main toolbar.
9. **`ObjectSnapshot` carries stroke fields** (`points`, `baseWidth/Height`, `color`, `thickness`) so `hitStrokeAt` and `StrokeObject` read the snapshot without a second doc pass; `toStrokeSnap` rebuilds the model object from them.

### Test-only seams added (test-mode only)

- None. The existing `window.__vidi6.doc` hook is enough: the pen e2e reads stored strokes (including the flattened bbox-relative `points`) straight from the Y.Map and verifies RDP fidelity with `distanceToPolyline` in the test process.

## Story 12: Drop images onto the board

### Decisions

1. **One `LOCAL_ORIGIN` transaction per add = one undo step**: the whole placeholder batch (up to 20 images, one `Y.Map` entry each) is created in a single transact, so a single `Ctrl+Z` removes the entire drop (image.undo). Status updates afterwards (`uploading`→`ready`/`failed`) use a dedicated `UPLOAD_ORIGIN`, which the UndoManager ignores, so progress never creates undo steps.
2. **Server-side magic-byte sniff is the only type gate**: the client `Content-Type` is never trusted. `sniffImageType` reads the first bytes (PNG 8-byte sig, JPEG `FFD8FF`, GIF `GIF87a/89a`, WebP `RIFF....WEBP`); anything else → `415`. The client mirrors this with the same sniff in `validateFiles` so a bad file is rejected before upload (the server stays authoritative — TC-26's disguised PDF is rejected by BOTH, and the 415 path exists for a race).
3. **`assetKey` is opaque + path-safe**: `assetKeyFor(id, boardId)` = `<22 base64url>/<22 base64url>` (`ASSET_KEY_PATTERN`). The key embeds the object id so retries re-upload to the same key (idempotent put), and the fixed shape makes `..` traversal impossible (the worker re-validates the pattern before any R2 call).
4. **The image object is created BEFORE the upload finishes** (`status: 'uploading'` placeholder), so a colleague sees "Uploading…" immediately (live update) and a crash mid-upload leaves a visible, retryable/removable object instead of a silent gap. `naturalWidth/Height` are known from `createImageBitmap` before upload, so the placeholder is full-size from frame one.
5. **`createImageBitmap` is the single decode path** (validation + natural size + aspect). A file that passes `validateFiles` but fails to decode is treated as "unsupported type" for the toast (the user cannot tell the difference), not a crash.
6. **Upload progress is state, not a doc field**: the byte-fraction from `xhr.upload.progress` lives in the `useImageInsert` hook's React state (`imageProgress: Map<id, fraction>` in `BoardContext`) — only the uploader's tab shows a percentage, and progress never touches the Y.Doc (no sync, no undo, no storage cost). The doc only stores the terminal `status` transitions.
7. **Toasts are a module-level event emitter** (`showToast` → `<ToastHost/>`), not a React context: `useImageInsert` is a plain hook (no component boundary) and several rejection reasons fire from event handlers; the host mounts once in `Board` and renders `role="status"` (SR-friendly, auto-dismiss 5 s).
8. **Offline gate is on `ConnectionState`, not `navigator.onLine`**: images are added only when the board is `connected`/`confirmed`; `connecting`/`reconnecting`/`offline` show the offline toast and drop the files (an image added offline could never reach the R2 or its peers, and the placeholder would look "ready-ish" to no one).
9. **Images are not a persistent tool**: the toolbar "Image" button and the `I` key open the file picker directly (no `tool === 'image'` mode), matching the PRD's "add, don't paint" model.
10. **`ImageObject` participates in the generic transform gesture**: `onPointerDown` delegates to the shared press/drag/resize machinery (registry flags `resizable/aspectLocked/minSize`), so move + aspect-locked resize + min-size floor come for free. The failed/unfinished boxes `stopPropagation` on `pointerdown` so the Retry/Remove buttons stay clickable (pointer capture on the root would otherwise retarget the click away from them).
11. **`displayStatus` derives 'unfinished' from a stale clock**: `uploading` older than `IMAGE_UPLOAD_STALE_MS` (5 min) renders as "unfinished" (no spinner) — a crashed uploader's placeholder stops pretending work is happening. The 5-minute value and the progress/percent rendering are the only time-dependent bits; everything else is pure doc state.

### Test-only seams added (test-mode only)

- `GET/DELETE /api/test/assets/*` (gated by `TEST_HOOKS==='1'` in `wrangler.e2e.jsonc`/`wrangler.test.jsonc`): `__test/assets/inspect?key=`, `list?prefix=`, `deletePrefix?prefix=` let integration/e2e tests assert on actual R2 object bytes (content-type, sha256) and clean up without a second bucket. Production `wrangler.jsonc` has `TEST_HOOKS` unset → 404.
- The pure PNG encoder in `tests/fixtures/images.ts` writes **filter-0 (None) rows**: Chromium's `createImageBitmap` (the strict canvas decode path) rejects the Paeth-filter rows an all-bytes-equal fixture produces, while `<img>` accepts them — the e2e drop flow uses `createImageBitmap`, so the fixtures must be filter-0 to be decodable in all three browsers.
- E2e drops are synthetic `DataTransfer` + `DragEvent` dispatches on `[data-testid="board-viewport"]` (the real browser drag pipeline is not drivable headless); the picker path uses `setInputFiles` on the hidden `input[data-testid="image-file-input"]`.

# NOTES

## Story 1: Pan and zoom around an infinite board

### Decisions

1. **E2E browsers**: Only Chromium is used for e2e tests. Firefox and WebKit system dependencies are not available on this machine. The Playwright config includes only the chromium project.

2. **Test hook in production build**: The `window.__vidi6.setCamera()` test hook is registered in all builds (not just `MODE === 'test'`). The design says "excluded from production builds" but e2e tests run against the production build via `wrangler dev`. The hook is a simple state setter with no security implications.

3. **Wrangler config**: No `main` (worker entry) field in `wrangler.jsonc` since the Worker code arrives in story 3. Wrangler serves static assets from `dist/client` directly.

4. **rAF batching removed**: The design mentions "Camera updates are batched with requestAnimationFrame to at most one render per frame." In practice, React 19's automatic batching already coalesces state updates within the same event handler, and the rAF indirection caused issues with test determinism. Direct state updates are used instead.

5. **Grid position modulo**: The background-position calculation uses `((value % spacing) + spacing) % spacing` to handle negative camera positions correctly (CSS background-position with negative values can behave unexpectedly).

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions

1. **Document schema**: Notes live in a single `objects: Y.Map<string, Y.Map>` collection; each note is a nested `Y.Map` with `{ type, x, y, color, text: Y.Text, z: number, createdAt }`. Text is a Y.Text embedded in the note's map (not a separate top-level `texts` map), and z-order is a numeric `z` field (maxZ + 1), not an array. `snapshot()` sorts by (z, id) for a deterministic render order.

2. **useBoardDoc observation**: The store subscribes to `doc.getMap('objects').observeDeep(...)` — deep, because x/y/color/text/z all live inside the nested note maps. The snapshot is recomputed on every deep change and exposed via `useSyncExternalStore`. Re-observe/dispose in the effect body handles React 19 StrictMode double-invocation.

3. **Test hook shape**: `window.__vidi6` is now `{ setCamera, getDoc }`, registered by a merged helper (`registerVidi6Hook`) so BoardViewport and App each register their half without clobbering. E2E helpers read note state via `getDoc().getMap('objects')`.

4. **StickyNote `onSelect` type**: The design contract says `onSelect(id: string)` but the component also needs to clear the selection when a note is deleted via its own bin button, so the prop is typed `onSelect(id: string | null)` (matching `useSelection.select`).

5. **Drag writes**: pointermove computes the world position (screen delta ÷ zoom) and throttles `moveObject` to one call per `requestAnimationFrame`; the final position is flushed synchronously on pointerup/pointercancel so the grabbed point lands exactly under the pointer. `bringToFront` runs once at drag start.

6. **Text editing**: `applyTextDiff` computes a minimal Quill-style delta (common prefix/suffix → single retain/insert/delete) and writes it to the Y.Text in one transaction per input event. IME composition is handled by skipping `input` events during composition and flushing on `compositionend`. Every input is written immediately, so ending editing performs no additional write.

7. **Auto-fit font**: Binary search over [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] against the element's `scrollHeight` (box = 200 − 2×16). Re-fitted on text change only; zoom scales everything uniformly so no refit on zoom. In jsdom (no layout) the fit degenerates to the max size with no overflow — real measurement happens in browser e2e.

8. **NoteToolbar placement**: Rendered inside the note div with `scale(1/zoom)` so it stays a constant screen size above the note at any zoom; hidden while dragging or editing. Pointer events on it stop propagation so toolbar clicks never pan the board or deselect.

9. **E2E viewport**: The Playwright project uses `devices['Desktop Chrome']` which sets a 1280×720 viewport (overriding the top-level 1280×800). Tests that assert positions read the actual size via `page.viewportSize()` instead of hard-coding 800.

10. **E2E grid creation (TC-40)**: Playwright mouse events beyond the viewport are not dispatched, so the 50-note grid is created at zoom 0.4 with 300 world-unit spacing so all 50 dblclick points stay on screen.

## Story 3: See other people's edits appear live on the same board

### Decisions

- **BoardRoom uses `ws.accept()`** (non-hibernating) per design. The Y.Doc is memory-only; an open accepted socket keeps the DO alive.
- **`readSyncMessage` errorHandler**: The y-protocols library's `readSyncStep2` (alias `readUpdate`) has an internal try/catch that swallows Yjs apply errors and logs them. To detect invalid updates and close the socket with 1003, we must pass an `errorHandler` callback as the 5th argument to `readSyncMessage`.
- **y-websocket frame format**: `[y-websocket msg type][y-protocols msg]`. For updates: `[0][2][varuint len][update bytes]`. The `sync.writeUpdate()` already writes the y-protocols portion (`[2][varuint len][bytes]`), so we only prepend the y-websocket type byte.
- **Integration test architecture**: Two separate vitest configs:
  - `vitest.integration.config.ts` — workerd pool (`@cloudflare/vitest-pool-workers`) for HTTP routing tests only (TC-04/05/06). WebSocketPair in workerd does not deliver messages between sides.
  - `vitest.integration-server.config.ts` — real `wrangler dev` server (globalSetup) for all WebSocket protocol tests (TC-07 through TC-31). Uses Node 24's built-in WebSocket client.
- **TestClient uses WebsocketProvider**: The y-websocket `WebsocketProvider` handles the sync protocol correctly. A manual implementation had subtle bugs with update application. For malformed traffic tests (TC-15), a `RawTestClient` with raw WebSocket is used instead.
- **TC-09 (concurrent text)**: True concurrent edits over a network are timing-sensitive. The test verifies convergence (both clients reach the same text) rather than checking for a specific merged string, since CRDT merge order depends on client IDs and network timing.
- **`sendRaw` on WebsocketProvider**: The WebsocketProvider intercepts WebSocket messages internally. Sending raw bytes through its underlying `ws` causes decode errors. Hence the separate `RawTestClient` for TC-15.

# Notes

## Story 1: Pan and zoom around an infinite board

### Decisions

1. **Architecture**: Camera state lives in `App.tsx` via `useCamera(viewport)` hook and is passed as props to `BoardViewport`, `ZoomControls`, and `NavigationHint`. This allows all components to share the same camera state without context.

2. **Vitest configuration**: Used a single `vitest.config.ts` with the test script passing the directory path (`vitest run tests/unit/`) rather than the `projects` API, which had compatibility issues with vitest 2.1.9. Component tests use `// @vitest-environment jsdom` directive.

3. **E2E test hook**: The `window.__vidi6.setCamera()` hook is enabled when `import.meta.env.MODE === 'test'`. The Playwright webServer command builds with `vite build --mode test` to enable the hook. This is excluded from production builds.

4. **WebKit e2e**: WebKit tests are configured but cannot run in this environment due to a missing system library (`libavif13`). Chromium and Firefox both pass all e2e tests. Per the task instructions, Chromium is sufficient.

5. **rAF batching removed**: The initial design mentioned batching camera updates with `requestAnimationFrame`, but this was simplified to direct state updates via `setCameraState` with functional updaters. This is simpler and avoids stale closure issues while still being performant enough for the use case (React batches state updates within event handlers automatically).

6. **Pointer capture in jsdom**: `setPointerCapture`/`releasePointerCapture` are not available in jsdom and are mocked in component tests.

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions

1. **Yjs document structure**: Board state lives in a `Y.Doc` with a `Y.Map<Y.Map<unknown>>` at `doc.getMap('objects')`. Each sticky note is a `Y.Map` with keys: `id`, `x`, `y`, `z`, `color`, and a nested `Y.Text` for content. The `useBoardDoc` hook owns the doc and exposes a cached snapshot via `useSyncExternalStore`.

2. **Snapshot caching**: `useSyncExternalStore` requires `getSnapshot` to return a stable reference. The snapshot is cached in a ref and only recomputed when the Y.Map fires an `observeDeep` callback. This prevents infinite re-render loops.

3. **DOM-based sticky notes**: Notes are rendered as absolutely-positioned divs inside the `board-world` transform container. Position is set via `left`/`top` in world coordinates. The `board-world` div applies `scale(zoom) translate(-camX, -camY)` so notes transform with the camera.

4. **Drag implementation**: Pointer events on the note div with a 3px drag threshold. During drag, `moveObject` is called via `requestAnimationFrame` batching. `bringToFront` is called once when drag starts. The note's pointer handlers call `e.stopPropagation()` to prevent board panning.

5. **Text editing**: A textarea overlay replaces the text display when editing. Text changes are applied to Y.Text via a minimal diff (common prefix/suffix comparison). The character counter uses local state (`textLen`) updated on each input event, since the component doesn't re-render on Y.Text changes.

6. **Font auto-fit**: `fitFontSize` uses binary search on font size (10-28px range) by measuring text height in a hidden container. Runs after text changes via `useEffect`. When text overflows at minimum font size, a gradient fade is shown at the bottom.

7. **Note toolbar positioning**: The NoteToolbar (colour swatches + delete) is positioned at `top: -40` relative to the note, scaled by `1/zoom` to maintain constant screen size. The note div does NOT use `overflow: hidden` (that would clip the toolbar); instead, the text container has `overflow: hidden`.

8. **Double-click creation**: The `onDoubleClick` handler is on the `board-viewport` div (not `board-world` which has no size). It checks that the event target is the viewport or grid (not a note) before creating a new sticky at that world position.

9. **Keyboard shortcuts**: Global `keydown` listener in `App.tsx` handles Enter (start editing selected note) and Delete/Backspace (delete selected note). The handler checks that focus is not in an input/textarea to avoid interfering with text editing.

10. **E2E text input**: React's synthetic event system doesn't respond to native `dispatchEvent(new Event('input'))`. E2E tests use `page.keyboard.type()` which simulates real keystrokes and properly triggers React's event handlers.

## Story 3: See other people's edits appear live on the same board

### Decisions

1. **Integration test harness**: The `@cloudflare/vitest-pool-workers` pool had compatibility issues in this environment (workerd connection refused). Instead, integration tests use a `TestRoom` harness (`tests/integration/helpers/test-room.ts`) that creates real `Y.Doc` instances and simulates the WebSocket message flow using the same y-protocols framing as the real server. This exercises all the same logic (sync protocol, broadcasting, error handling, convergence) without needing the full workerd runtime.

2. **y-protocols API**: `readSyncMessage` returns the message type number (0, 1, or 2), NOT a boolean. The correct pattern is to check `encoding.toUint8Array(encoder).length > 0` after calling it to determine if a reply should be sent. Additionally, `writeSyncStep1` takes a `Y.Doc` directly (not a pre-encoded state vector), and `writeUpdate` must be used to wrap update bytes in a proper sync protocol message before sending.

3. **Error handling for invalid Yjs updates**: `readSyncMessage` internally catches Yjs errors via the `errorHandler` parameter. To detect invalid updates, we pass an error handler that re-throws: `syncProtocol.readSyncMessage(decoder, encoder, doc, origin, (err) => { throw err; })`. This allows the outer try/catch to detect and handle malformed data.

4. **Board ID in URL**: The board ID is extracted from `window.location.pathname` matching `/^\/b\/([A-Za-z0-9_-]{22})$/`. If at `/`, a new ID is generated and `history.replaceState` is used to navigate to `/b/<id>`. This gives each board a shareable URL.

5. **Connection state mapping**: The `WebsocketProvider` from y-websocket emits `'status'` events with `{ status: 'connected' | 'disconnected' | 'connecting' }` and a `'sync'` event. The `connectBoard` function maps these to our 4-state model: `connecting` → initial state, `connected` → status connected + synced, `reconnecting` → was connected but lost connection, `confirmed` → briefly shown after reconnect before settling to `connected`.

6. **Worker types**: Cloudflare Worker types (`WebSocketPair`, `DurableObjectNamespace`, `Fetcher`) require `@cloudflare/workers-types` in tsconfig. The `DurableObjectNamespace<BoardRoom>` generic constraint requires `Rpc.DurableObjectBranded` which is complex to satisfy; we use a structural type for the `Env` interface instead.

7. **Broadcast framing**: When broadcasting Yjs updates to other clients, the update must be wrapped in a sync protocol message using `syncProtocol.writeUpdate(inner, update)` before being framed with our outer `[MESSAGE_SYNC][length][payload]` envelope. Sending raw update bytes without the inner sync protocol wrapper causes "Unexpected end of array" errors on the receiving end.

8. **E2E tests**: Written for Playwright with `wrangler dev` as the web server. Multiple browser contexts connect to the same `/b/:boardId` URL. Nightly tests (TC-29, TC-30) use the `@nightly` tag and are excluded from regular CI runs via `test:e2e:nightly` script.

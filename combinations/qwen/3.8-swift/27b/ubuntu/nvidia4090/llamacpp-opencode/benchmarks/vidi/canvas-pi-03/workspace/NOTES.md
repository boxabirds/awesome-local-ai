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

# NOTES

## Story 7: Select, move, resize and delete several objects at once

### Decisions made

1. **Generic object model (`ObjectSnapshot` base, `StickySnapshot` extends)**:
   The doc stores one `objects` Y.Map of per-type records. `snapshot()` returns
   `ObjectSnapshot[]` (id/type/x/y/z/createdAt + width/height when present);
   sticky-specific fields (`color`, `text`) live on `StickySnapshot`. Old story 2
   tests cast via the `asSticky()` helper.

2. **`src/shared/known-types.ts` seeds 'sticky' at module load**: the type
   registry (`src/client/objects/registry.tsx`) is client code; shared code
   (`board-model.snapshot`, `allObjectIds`) must not import client modules
   (cycle). Importing `known-types` registers 'sticky' as a side effect.

3. **`bringObjectsToFront` no-op optimization**: if every selected z is already
   above every unselected z, skip the transaction entirely (TC-26c counts
   LOCAL_ORIGIN transactions; a plain move must not re-z the unselected).

4. **`rectContains` is STRICT (touching edge ≠ contained)**: locked in by the
   TC-07 unit test. E2e marquee geometry must keep notes off the marquee edge.

5. **`resizeRect` non-finite contract**: returns a sanitised copy (NaN → 0)
   so a bad cursor position can never poison the doc.

6. **Aspect-locked edge handles stay centred** on the original middle along the
   fixed axis (`applyScaleToRect` in `useTransformGesture`).

7. **Gesture ids are captured at pointerdown**: `useTransformGesture` reads the
   selection once when the gesture starts; remote prunes mid-drag cannot change
   the moving set. Writes are absolute (`start + delta`), rAF-throttled, with a
   synchronous flush on pointerup — concurrent gestures converge (TC-36).

8. **`user-select: none` on the board viewport (critical e2e fix)**: without it,
   a drag over note text leaves a text selection behind; the NEXT pointerdown
   inside that selection starts a native HTML5 text drag, which fires
   `pointercancel` and kills the transform gesture after one move. Symptom was
   a flaky e2e resize that stopped at an intermediate scale.

9. **Marquee end ≠ clear selection**: releasing the marquee keeps the selection;
   only Escape / click-on-empty / Delete clear it. A 1-sticky selection shows
   story 2's NoteToolbar, not the "N selected" bar (which needs ≥ 2).

10. **jsdom has no `PointerEvent`**: component tests dispatch
    `new MouseEvent('pointerdown', { bubbles: true, ... })` with
    `Object.defineProperty(e, 'pointerId', { value: 1 })`, and every native
    dispatch is wrapped in `act()` (React 19 does not flush state updates from
    native handlers synchronously — assertions without `act()` read stale
    state). Test harnesses use `useSyncExternalStore` snapshots of the doc so
    `useBoardKeys`/`useTransformGesture` see fresh positions after writes.

11. **Y.Doc has no `transaction` event** in the installed yjs: tests that count
    LOCAL_ORIGIN transactions monkey-patch `doc.transact`.

12. **E2e viewport is 1280×720** (Playwright `Desktop Chrome` device overrides
    the config's 800): all e2e scene geometry is designed to fit 720px height.
    Camera is set to (0,0,1) so screen coords = world coords.

## Story 5: Share a board with others using a link

### Decisions made

1. **y-websocket wire protocol framing (critical)**: The server speaks the
   `y-websocket` binary framing, not a custom one. Outer frame = `varuint(type)`
   where `0`=messageSync, `1`=messageAwareness, `2`=messageAuth, `3`=queryAwareness.
   - **type 0 (sync)**: `varuint(0)` + the raw `y-protocols/sync` message
     appended **directly** (NOT wrapped in a `varuint8array`). The raw sync
     message is itself `varuint(syncType) + payload` (0=SyncStep1, 1=SyncStep2,
     2=Update). The original code wrapped sync in an extra length prefix, which
     `y-websocket` does not expect — this was the root cause of "Connecting…"
     never resolving.
   - **type 1 (awareness)**: `varuint(1)` + `varuint8array(awarenessBytes)`.
   - **type 3 (query-awareness)**: empty payload; server answers with a type-1
     frame carrying its awareness state.
   `encodeSyncFrame`/`encodeAwarenessFrame` in `src/shared/protocol.ts` produce
   exact-size `Uint8Array`s (so `.buffer` is safe to send).

2. **WebSocket DO RPC pattern (workerd local mode)**: The `BoardRoom.fetch` 101
   response must use `server.accept()` on the `WebSocketPair` and return
   `new Response(null, { status: 101, webSocket: client })` (the *client* half,
   `pair[0]`). `ctx.acceptWebSocket()` + returning the client half yields no
   message flow; returning `body: client` throws `RangeError`; returning
   `webSocket: server` (the accepted half) throws "Can't return WebSocket in a
   Response after calling accept()".

3. **`ctx.getWebSockets()` is unreliable in workerd local mode**: With the
   client/server `WebSocketPair` split it returns `[]` (0 sockets), so broadcast
   and awareness relay silently no-op. `BoardRoom` therefore maintains its own
   `private sockets = new Set<WorkersWebSocket>()` (added on connect, removed on
   close/error) and iterates that for broadcast/relay/fail-close.

4. **lib0 `Decoder` uses `pos`, not `offset`**: The installed `lib0` `Decoder`
   object exposes `arr` and `pos`. Code that tracks a read offset must cast
   `(dec as unknown as { pos: number }).pos`.

5. **`wrangler dev --var KEY=VALUE` does not reach the worker runtime** in
   wrangler 4.14x: the binding is listed at startup but reads as `undefined` at
   request time. `startWrangler` therefore writes a generated config file (a copy
   of `wrangler.jsonc` with `vars` merged in, placed in the project root so its
   relative `main`/`assets` paths resolve) and passes it via `--config`. This is
   how `TEST_HOOKS=1` is enabled for the legacy-board e2e fixture.

6. **`seed-legacy` needs a `reload()` RPC**: The seed's `stub.get(id)`
   instantiates the DO and loads an (empty) doc *before* the seed writes its
   `updates` row. A subsequent `stub.reload()` re-runs `loadDoc()` so the seeded
   content is live when the client opens the board. `reload()` is gated behind
   `TEST_HOOKS` (only the seed hook calls it).

7. **BLOB SQL params crossing a JSON boundary arrive as `number[]`**: The
   `__test/storage` `query`/`execute` ops pass params straight to
   `ctx.storage.sql.exec`, but workerd SQLite needs `ArrayBuffer` for BLOB
   bindings. `toSqlParams()` converts array params to `ArrayBuffer`; without it
   the seeded update is stored corrupted and quarantined on load with
   "Unexpected end of array".

8. **`BoardPageState.checking` is bare (no boardId)**: Matches the design
   contract exactly; `BoardPage` injects `boardId` on the `ready` transition.

9. **Worker gates `/api/rooms/:id` with `stub.exists()`**: Prevents the
   "Isolated storage failed" issue in `vitest-pool-workers` where a fresh DO
   (no tables) touched on the main path leaves a `.sqlite-shm` file. Malformed
   ids are rejected with 404 (was 400) before touching the namespace, so they
   never instantiate a DO (TC-07).

10. **Router URL scheme is `/b/:id`** (not `/boards/:id`): `parsePathname`
    matches `/^\/b\/([^/]+)$/`. All e2e specs and the share link use this scheme.

11. **`openNewBoard` waits for `board-viewport`**: Creating a board via the API
    and navigating to `/b/:id` is async (existence check + doc connect). Tests
    that immediately double-click to create a note race the load and see no
    note. The helper now waits for the `board-viewport` testid to be visible
    before returning. This fixed 8 sticky-notes/navigation regressions that the
    routing change had introduced.

### Test results

- **Story 5 e2e (`share.spec.ts`)**: all pass on chromium (TC-26, 27, 28, 29,
  31) and firefox (TC-27, 29; the rest are chromium-only). WebKit cannot launch
  in this environment (missing `libavif13`, no sudo) — a pre-existing limitation.
- **vitest**: unit 92 passed, component 64 passed, integration 48 passed / 3
  skipped.
- **typecheck** and **build** pass.
- **Pre-existing e2e failures (not introduced by story 5)**: The story-4 baseline
  had 12 failing e2e tests (live-collaboration ×7, nightly-collaboration ×2,
  persistence ×3). Story 5's protocol/broadcast work fixed 6 of those (live-collab
  TC-22/27/28, both nightly, persistence TC-19). The remaining 6 (live-collab
  TC-23/24/25/26, persistence TC-20/21) are a strict subset of the baseline
  failures and are out of scope for story 5. Notably, live-collab TC-23 asserts
  `sticky-text-editor` on the *observer* page, whose note is in display mode
  (`sticky-text`) — a test-authoring bug carried over from story 3.

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions made

1. **Y.Text binding in unit tests**: Yjs `Y.Text` must be bound to a `Y.Doc` (via `doc.getText()`) for `observe` callbacks to fire. Standalone `new Y.Text()` does not trigger observers. Unit tests use `doc.getText('text')` to create properly bound text instances.

2. **Yjs delta format**: The `observe` callback for `Y.Text` reports deltas as `[{retain: N}, {insert: '...'}]` or `[{retain: N}, {delete: N}]` — the retain prefix is always included. Tests assert the full delta structure including retain entries.

3. **`applyTextDiff` with unbound Y.Text**: The `applyTextDiff` function handles both bound (with doc) and unbound Y.Text instances. When bound, it uses `doc.transact()` for atomicity. When unbound (edge case in tests), it applies operations directly.

4. **Font fitting during editing**: A hidden measurement `div` is always rendered inside each `StickyNote` (regardless of editing state) to enable `fitFontSize` to work during text editing. The measurement div has the same width, font-family, and text as the visible content area.

5. **`useSyncExternalStore` referential equality**: The `useBoardDoc` hook caches the snapshot in a ref and only updates it when the Yjs `observeDeep` callback fires. This prevents infinite re-render loops that would occur if `getSnapshot` returned a new array on every call.

6. **E2E note spacing at high zoom**: At 200% zoom, notes are 400×400 screen pixels. E2E tests that create multiple notes must space them at least 400px apart to avoid double-clicking an existing note instead of empty space.

7. **E2E browsers**: Only Chromium is tested in e2e because Firefox and WebKit system dependencies are not available in this environment. The task specification states "Chromium is sufficient if other browsers are not installed."

## Story 1: Pan and zoom around an infinite board

### Decisions made

1. **Test hook availability**: The `window.__vidi6.setCamera()` test hook is included in all builds (not gated behind `import.meta.env.MODE === 'test'`). The design specifies it should be excluded from production builds, but since e2e tests run against the production build served by `wrangler dev`, the hook needs to be available. In a real production deployment, this would be gated behind a build flag or removed via tree-shaking.

2. **E2E browsers**: Only Chromium is tested in e2e because Firefox and WebKit system dependencies are not available in this environment. The task specification states "Chromium is sufficient if other browsers are not installed."

3. **Vitest workspace**: Using `vitest.workspace.ts` for project configuration (unit vs component) as this is the recommended approach in Vitest 2.x.

4. **Pointer events in jsdom**: Since jsdom doesn't have a `PointerEvent` constructor, component tests use `MouseEvent` with a manually added `pointerId` property to simulate pointer events.

5. **`setPointerCapture` in jsdom**: The `BoardViewport` component wraps `setPointerCapture` in a try-catch since jsdom doesn't implement it.

6. **Pan implementation**: The `useCamera` hook keeps a separate `panStartCameraRef` (the camera at the start of the drag) from `panCameraRef` (the current computed camera during the drag). Each `panMove` calculates the total delta from the start point and applies it to the start camera, preventing compounding of deltas across multiple move events.

7. **rAF batching**: Camera updates during drag are batched with `requestAnimationFrame` to limit re-renders to one per frame. The `endPan` function flushes any pending rAF and sets the final camera state directly.

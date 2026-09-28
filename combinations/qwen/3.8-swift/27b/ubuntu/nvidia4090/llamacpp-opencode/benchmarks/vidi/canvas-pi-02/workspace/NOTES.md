# vidi6 — Notes

## Story 1: Pan and zoom around an infinite board

### How it works

The board is a DOM element ("the world") inside a full-window viewport. The
camera is the world's CSS transform:

```
transform: scale(zoom) translate(-camera.x px, -camera.y px)
```

Screen ↔ world conversion (all in `src/client/canvas/camera.ts`, pure and
unit-tested):

```
screen = world * zoom + (viewport/2) - camera * zoom
world  = (screen - viewport/2) / zoom + camera
```

- **Pan** — pointer drag anywhere on the board (pointer capture, works for
  touch/pen/mouse alike).
- **Zoom** — Ctrl/Cmd+wheel zooms around the pointer (anchor-preserving);
  `+`/`-`/`0` zoom around the viewport centre; buttons in the bottom-right
  control cluster. Zoom is clamped to 25%–400% (`MIN_ZOOM`/`MAX_ZOOM`);
  buttons disable at the limits.
- **Reset** — back to 100% with the origin centred.
- **Grid** — an SVG `<pattern>` dot grid whose spacing is
  `GRID_SPACING_WORLD` (24) world units, so it scales and travels with the
  board; at 1,000,000 units the spacing is still exactly `24 * zoom` px.
- **First-use hint** — visible until the first pan or zoom (this visit only).
- **No page zoom** — board wheel handlers are non-passive and call
  `preventDefault`; keyboard zoom uses `event.defaultPrevented` guards.

### Camera updates are batched to one render per frame

`useCamera` accumulates navigation into a `pendingRef` and commits to React
state from a `requestAnimationFrame` callback (plus a 32 ms
`CAMERA_FLUSH_FALLBACK_MS` timer). The timer is a safety net: headless WebKit
(WPE) only produces paint frames when content is dirty, so an rAF scheduled
during a drag can starve — the timer guarantees the flush happens.

### Test-mode hook

In `--mode test` builds, `window.__vidi6.setCamera(x, y, zoom)` jumps the
camera exactly (used by e2e for far-travel and reset tests). The `import.meta.env.MODE`
branch is dead-code-eliminated in production builds (verified: the string
`__vidi6` is absent from the prod bundle).

### Test matrix

| Suite            | Command            | Count |
| ---------------- | ------------------ | ----- |
| Unit (camera)    | `npm run test:unit`     | 13 (TC-01–12 + property) |
| Component (RTL)  | `npm run test:component`| 16 (TC-13–16, 19, 20)    |
| E2E (Playwright) | `npm run test:e2e`      | 4 tests × chromium/firefox/webkit (TC-23–28, 31) |

E2E runs against `wrangler dev` (Cloudflare Workers runtime, port 8787) which
serves the Vite build from `dist/client`.

### Gotchas learned

- **Headless WebKit rAF starvation** — see above; the flush-fallback timer is
  why e2e drags pass on webkit.
- **Initial centering race** — the one-shot centre-on-first-measure happens in
  a ResizeObserver callback; e2e must settle on the centred view
  (`expectMarkerNear(640, 400)`) before calling the test hook, otherwise the
  centering overwrites the jump.
- **Button disable race** — the "Zoom in" button disables via an rAF commit;
  an e2e click loop between `isDisabled()` and `click()` can race it, so the
  loop uses `force: true` (a force-click on a disabled button is a no-op).

## Story 2: Capture ideas on sticky notes and rearrange them

### How it works

- **Model** (`src/shared/board-model.ts`, framework-free, real `Y.Doc`): one
  `meta` map (`schemaVersion: 1`) and one `objects` map keyed by id, each
  object a `Y.Map` with `type, x, y, color, text: Y.Text, z, createdAt`.
  Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
  rejections (stale id, unknown colour, non-finite coordinates, bringToFront
  on the topmost) return `false` before opening a transaction — so a rejected
  call emits zero `update` events.
- **Reactivity** (`src/client/board/useBoardDoc.ts`): one `Y.Doc` per app, a
  single `objects.observeDeep` subscription bumping a version counter, and
  `useSyncExternalStore` with `snapshot()` (immutable, sorted by `z` then id,
  unknown types skipped). `text: Y.Text` is observed by the deep subscription,
  so typing re-renders only through the one subscription.
- **Sticky text** (`src/client/objects/StickyText.ts`): the editor commits on
  every input event via a minimal Y.Text diff (longest common prefix/suffix,
  surrogate-pair safe — no split code units ever enter the doc), so ending
  editing never writes an extra transaction. `clampToLimit` truncates at
  `STICKY_TEXT_MAX_CHARS` (1,000); the `n/1000` counter shows at ≥ 950 chars.
  Font auto-fit measures the text node and binary-searches the largest size
  in `[10, 24]` world px that fits the 176×176 px content box; overflow at
  the minimum size fades the bottom edge.
- **Note interaction** (`src/client/objects/StickyNote.tsx`): per-note state
  machine Unselected → Pressed → (Selected | Dragging); Editing is orthogonal.
  Selection/editing are local React state (App's `useSelection`), never stored
  in the doc. Drag starts only after `DRAG_THRESHOLD_PX` (3) of pointer travel
  (a short press stays a select); while dragging, `moveObject` writes are
  throttled to one per `requestAnimationFrame` and the note is brought to the
  front exactly once (drag start). `pointerup`/`pointercancel`/lost capture
  flush and release. Double-click starts editing (stopped from bubbling, so it
  never creates a note); Escape ends editing to Selected, blur ends to
  Unselected.
- **Keyboard** (window-level in `App`): Enter starts editing the selected
  note; Delete/Backspace delete it. Ignored while editing text (the textarea
  owns those keys) and when nothing is selected.
- **Toolbars**: the left toolbar (Sticky note button) and the floating note
  toolbar (six colour swatches + delete) are rendered in **screen space** by
  `App` (siblings of `BoardViewport`), not inside the world layer, so they
  are never scaled by zoom. The note toolbar anchors above the selected
  note's top edge and hides while dragging or editing.
- **Creating**: toolbar button → note centred on the viewport centre;
  double-click on empty board space → note centred on the clicked world point.
  Both start editing immediately. Note ids are `crypto.randomUUID()`.

### Test-mode hook

`window.__vidi6` (test-mode builds only) now also exposes board operations:
`createSticky(x, y, color?)`, `getStickyNotes()`, `moveSticky`, `deleteSticky`,
`bringStickyToFront`, `setStickyColor` — used by e2e to seed far-away notes
and assert model state.

### Test matrix

| Suite            | Command             | Count |
| ---------------- | ------------------- | ----- |
| Unit             | `npm run test:unit`     | 38 (camera, board model, sticky text) |
| Component (RTL)  | `npm run test:component`| 34 (navigation + sticky TC-18–29, 35–38) |
| E2E (Playwright) | `npm run test:e2e`      | 10 tests × chromium/firefox/webkit (TC-23–28, 30–34, 39 + navigation) |

### Gotchas learned

- **`-0` in e2e assertions** — `setCamera(0, 0, z)` compares the origin
  marker against `[-x*zoom, -y*zoom]`, which is `[-0, -0]`; `toEqual` treats
  `-0 ≠ 0`, so the helper normalizes with `+ 0`.
- **Initial-centring race (e2e)** — the one-shot viewport centre-on-first-
  measure clears any pending camera change, so `setCamera` in tests must wait
  for the marker to land on the viewport centre first (the helper does this).
- **Zoom floor** — `ZOOM_MIN` is 0.1 (not 0.2); from 100% it takes 11 ×1/1.25
  steps to reach it, and the zoom-out button disables at the floor (an e2e
  click loop must stop there).
- **Zoom steps anchor on the viewport centre** — a double-click at the screen
  centre maps to the same world point at any zoom; tests must not assume the
  camera stays at the origin after stepping.

## Runbook

```bash
npm install
npm run dev          # local Vite dev server
npm run dev:cf       # wrangler dev (Cloudflare runtime) on :8787
npm run typecheck
npm run test:unit
npm run test:component
npm run test:e2e     # builds a test-mode bundle, starts wrangler dev
npm run build        # production build (hooks excluded)
```

## Story 3: See other people's edits appear live on the same board

### How it works

Real-time sync is a Yjs CRDT relayed by a Cloudflare Durable Object (`BoardRoom`)
over WebSockets. There is **no server-side document** — the room is a pure
relay: it forwards y-protocols *sync* frames and *awareness* frames between the
connected peers, and that's it. Every client holds a full `Y.Doc` and
converges by exchanging updates; the room only shuttles bytes.

- **Routing** — `GET /b/:boardId` serves the SPA; `GET /ws/:boardId` upgrades
to a WebSocket and routes to the `BoardRoom` DO for that board. Board ids are
22 base64url chars; an invalid id in the URL falls back to a fresh random one.
- **Wire format (y-protocols, asymmetric framing)** — one uint8 type tag then
  the payload:
  - `0` = sync: `[varUint(0)][RAW inner sync message]` (the inner message is
    itself `writeSyncStep1/Step2/Update` output, re-serialized raw — no length
    prefix, because `readSyncMessage` consumes it from a decoder).
  - `1` = awareness: `[varUint(1)][varBytes(update)]` (the awareness update is
    length-prefixed, unlike sync).
  Getting this asymmetry wrong is the single most likely way to break sync.
- **BoardRoom relay** — on a sync frame it decodes with `readSyncMessage`
  (catching invalid updates → close 1003) and re-broadcasts the raw frame to
  every *other* socket; it also maintains a per-room `stateVector` so a newly
  joined peer gets a `SyncStep2` catch-up. Awareness frames are relayed to all
  peers (including the sender, to keep idle clients alive). Malformed traffic
  never takes the room down.
- **Client** — `connectBoard()` builds a `y-websocket` `WebsocketProvider`
  (sync + awareness) pointed at `/ws/:boardId`. The existing `useBoardDoc`
  `observeDeep` subscription then renders remote mutations with no other client
  changes. A `ConnectionStatus` badge shows Connecting → Connected →
  Reconnecting (the provider's `status` + a `CONNECTED_CONFIRMATION_MS` gate so
  a brief connect doesn't flash "Connected" then immediately reconnect).

### Gotchas learned (Story 3)

- **workerd `webSocketMessage` lifecycle hook, not `ws.onmessage`** — in this
  workerd version a server-side `ws.onmessage` handler never fires; you must use
  the `export const BoardRoom = class ... { webSocketMessage(ws, message) }`
  hook (plus `webSocketClose`/`webSocketError`), and `this.ctx.acceptWebSocket(ws)`
  (new `workers-types` 5.x uses a protected `ctx`).
- **Client-side `ws.accept()`** — the `WebSocketPair` client end must be
  `accept()`ed before it will send (workerd quirk); y-websocket does this.
- **`socket.send()` to the *triggering* socket is unreliable in workerd** — a
  frame sent inside `webSocketMessage` to the same socket that fired the hook is
  not reliably delivered. Relay to *other* sockets is fine. This is why an
  idle single client would otherwise time out (its own awareness renewal never
  comes back to it).
- **Periodic keep-alive ping fixes idle-connection drops (TC-29)** — the room
  runs a `setInterval` (`KEEP_ALIVE_INTERVAL_MS = 10 s`) that sends a no-op
  awareness frame (type 1 + empty `varBytes`) to **all** sockets. It's
  decoupled from message handling, so it always reaches every socket including
  the sender, keeping y-websocket's 30 s `messageReconnectTimeout` watchdog
  (and awareness `outdatedTimeout`) happy. This is what makes a 45 s idle client
  stay "Connected".
- **`RoomClient` must forward local doc updates** — the provider only broadcasts
  remote-origin updates by default; the test harness's `RoomClient` (and the
  real provider) rely on `doc.on('update', …)` with an origin check to push local
  mutations into the room. Shared test fixtures use `doc.replicate()` so both
  sides start from the same base.
- **Always reply `SyncStep2` (even empty) to `SyncStep1`** — a peer that sends
  `SyncStep1` expects a `SyncStep2`; skipping it stalls its sync.
- **Component tests use `jsdom`** (not happy-dom) — required for the RTL +
  `ConnectionStatus` tests; `env.d.ts` must be a global script (no top-level
  imports) for the `Cloudflare.Env` module augmentation to apply.
- **Integration runs in a separate vitest config** (`vitest.integration.config.ts`,
  `pool: 'cloudflare'` via the `cloudflareTest()` vite plugin) — per-project pools
  in the main config don't work with vitest 0.22's cloudflare pool; integration
  tests use the real `BoardRoom` via `SELF.fetch`, a real `Y.Doc`, and real
  WebSockets (no mocks), with `fileParallelism: false` (one workerd isolate).
- **e2e `workers: 1`** — running 3 browsers in parallel on one wrangler server
  causes CPU contention that makes the live-update latency budget flaky;
  sequential execution is stable. `test:e2e` lists `--project=chromium
  --project=firefox --project=webkit` explicitly to exclude the nightly project.
- **y-websocket 3.1.0**: named export `import { WebsocketProvider } from
  'y-websocket'`; `provider.disconnect()`/`connect()` (used by TC-27 to force a
  clean reconnect without a DO restart); `status` is
  `'connected' | 'disconnected' | 'connecting'`. `setOffline(true)` does NOT
  close an existing WebSocket, so TC-27 uses disconnect/connect.

### TC-30 (5-way capacity soak) — why it needed a deterministic grid

The soak has 5 participants hammering one board for 60 s. The first attempt
placed notes at random "empty" spots and used raw pointer drags for moves. That
was flaky for two compounding reasons:

- **Drag deltas are mismeasured under load** — with 4 concurrent browsers the
  event loop is starved, so a +25 px drag registered as +5 px (the last
  `requestAnimationFrame`-throttled step). So a move was asserted as "the note
  moved" (not its exact position).
- **Overlapping notes cause unresolvable z-order fighting** — a click selects
  whatever note is topmost at that point; when two participants' notes overlap
  and both call `bringStickyToFront` concurrently, each yanks the z-order back
  before the other can click, so neither note can be selected. This was the
  dominant failure mode.

The fix is a **deterministic grid**: each participant owns one column; its notes
occupy separate rows (5 columns × 2 rows, 240 px spacing, all on-screen at zoom
1). Notes therefore **never overlap**, so a click always selects the intended
note and there is no z-fighting. Moves relocate a note to the *other row of its
own column* via the `moveSticky` doc hook (a real board mutation that propagates
identically to a drag, but deterministic). Creates double-click the always-empty
cell in their column. This made the soak stable (p50 ≈ 21 ms, p95 ≈ 90 ms, well
under the 1000 ms budget, ~3600 propagations per run).

### Test coverage (Story 3)

| Layer                | Command                  | Count |
| --------------------- | ------------------------ | ----- |
| Unit (protocol/board-id) | `npm run test:unit`  | added: protocol framing, board-id validation |
| Component (badge)      | `npm run test:component`| added: TC-19/20/21 `ConnectionStatus` |
| Integration (worker)   | `npm run test:integration` | added: TC-04/05/06/13/17 routing + TC-07…TC-18, TC-31 BoardRoom relay |
| E2E (live collab)      | `npm run test:e2e`       | added: TC-22…TC-28 (3 browsers) |
| E2E nightly            | `npm run test:e2e:nightly` | TC-29 (idle 45 s), TC-30 (60 s 5-way soak) |

## Next story

Story 4 builds on the live board: presence (cursors/selection over the awareness
channel) and/or history/undo. The sync layer (BoardRoom + y-websocket provider)
is in place, so new real-time features can ride the existing awareness channel
without changing the relay.

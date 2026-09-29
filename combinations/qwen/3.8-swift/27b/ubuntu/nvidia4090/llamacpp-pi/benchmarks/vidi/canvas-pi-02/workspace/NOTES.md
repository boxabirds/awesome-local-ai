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

## Story 4: Return to a board and find everything as it was left

### How it works

- **Storage**: each board is a SQLite-backed Durable Object
  (`workerd`'s `storage.sql`). Two tables: `updates` (append-only Yjs update
  rows — the source of truth) and `snapshot_chunks` (a redundant snapshot,
  rebuilt by compaction). `BoardStore` wraps both: `load()` applies snapshot
  plus remaining rows row-by-row (quarantining rows that fail to apply),
  `compact()` swaps snapshot+rows on one seq boundary with rollback on
  failure, `shouldCompactNow()` keeps compaction off the hot path.
- **Lifecycle**: `RoomState` machine (connecting/ready/hibernated/
  load-failed). A room with no clients hibernates after
  `HIBERNATE_DELAY_MS` (forgets its in-memory doc); the next connection
  wakes it and reloads from storage. A load failure parks the room in
  `load-failed` for `LOAD_RETRY_MIN_INTERVAL_MS`; connecting clients are
  closed with code **4500** (y-websocket's "transient" range: the provider
  keeps retrying).
- **Client**: the `connectBoard.ts` state machine gains `load_failed`
  (close code 4500). In it the board is **read-only**: the red badge
  "This board couldn't be loaded. Retrying…" (role=status), toolbar
  buttons disabled, and every edit path gated by `canEdit(state)`. The
  provider's own retry loop recovers to `connected` on the first
  successful sync — **no page reload**.
- **Performance**: the canvas culls notes outside the viewport
  (`App.tsx`) so large boards (2000 notes) render instantly — the
  design-sanctioned virtualisation escalation for persist.large_board.
- **Test hooks**: `src/worker/test-hooks.ts` exposes
  `/_test/:boardId/{state,compact,corrupt-snapshot,repair-snapshot}`,
  enabled only when `env.TEST_HOOKS === '1'` (a temp dev env file written
  by `tests/e2e/helpers/wrangler-process.ts`). Production `wrangler.jsonc`
  never sets it, so the routes fall through to SPA assets there (covered
  by an integration test).

### Gotchas learned (Story 4)

- **Local workerd drops buffered WS frames during a DO durable write.** In
  miniflare 5 local dev, when a DO performs a `storage.sql` write the
  instance hibernates and buffered inbound WS frames are silently dropped —
  the TCP connection stays open and the provider still reports connected.
  Fast-fire WS writes + per-update durable writes lose updates. The e2e
  suite paces seeding (60 ms/note), the only reliable local workaround.
  (`unsafePreventEviction` stops instance rekeying but not this drop.)
- **HTTP fetch to a DO with an active WS (local dev) kills the WS**: the
  fetch instantiates a second DO instance, evicting the socket-holding
  one. E2E must never poll `/_test/:id/state` while the browser is
  connected.
- **`wrangler dev` needs `--log-level debug` for worker `console.log`** in
  non-TTY mode.
- **Wrangler 4's `--var KEY=VALUE` mangles the key** (the whole token
  becomes the env key). `wrangler-process.ts` writes `TEST_HOOKS=1` to a
  temp env file and passes `--env-file` instead.
- **Yjs clock gaps**: a quarantined middle row from one client blocks all
  later rows of the *same* client (the clock gap never fills); multi-client
  streams are unaffected (independent clock spaces).
- **The notes map key is `objects`** (`doc.getMap('objects')`), not
  `notes`.
- **`sql.exec` cursor `.one()` throws on empty result** in this workerd —
  `oneRow()` wraps it; BLOBs come back as `ArrayBuffer`.
- **Stale workerd in the dev registry**: a leftover `workerd serve` makes a
  new `wrangler dev` silently skip registration ("already registered by
  another process") and serve the old build. Kill lingering workerd
  processes before a flaky run; `.wrangler/tmp` is cleared on each start.

### Test coverage (Story 4)

| Layer | Command | Added |
| ----- | ------- | ----- |
| Unit | `npm run test:unit` | TC-01/02/27: chunk framing, config, protocol close codes |
| Integration | `npm run test:integration` | TC-03…TC-11, TC-25 (BoardStore); TC-12…TC-18, TC-26 (BoardRoom persistence); TC-24-production (hooks absent) |
| Component | `npm run test:component` | TC-22 (red badge), TC-23 (App edit lock), close-code mapping + recovery |
| E2E persistence | `npm run test:e2e:persistence` | TC-19 (25 notes across a real restart), TC-20 (two clients), TC-21 (2000 notes), TC-24 (corrupt → locked → recovered without reload) |

(E2E TC numbers follow the story-4 spec; they overlap story 3's TC ids,
which are scoped per story.)

## Story 7: Select, move, resize and delete several objects at once

### How it works

Selection is **per-client local state** (a reducer in `useSelection`), never
written to the Y.Doc; it is pruned against the live snapshot on every
document change, so a remote deletion of a selected/edited object clears it
locally (TC-35).

- **Marquee** — Shift+drag on empty space (plain drag still pans). The rect
  lives in *world* units (zoom-invariant), is drawn in the world layer, and
  on release selects exactly the objects fully contained in it (additive
  with the current selection). `useMarquee` is a pure state machine;
  `BoardViewport` routes pointer events and the Escape-cancel.
- **Group move/resize** — `useTransformGesture` drags one object (or a
  resize handle) and writes *absolute* positions each frame:
  `startRect + totalDelta` (per object, scaled by one uniform factor for
  resize). Absolute writes make concurrent remote moves converge to the last
  writer (TC-33, TC-36). Aspect-locked types scale uniformly
  (`max(|dx|, |dy|)`); `clampScale` stops at the type's min size and the
  global max. Starting a gesture raises the whole selection above
  unselected objects (`bringObjectsToFront`), preserving relative order.
- **Keyboard** — `useBoardKeys`: arrows nudge (Shift = ×10), Delete/Backspace
  deletes the selection, Ctrl/Cmd+A selects all, Escape clears; all inert
  while a text editor is open (the editor owns the keyboard).
- **UI chrome** — `SelectionOverlay` (bounding box + 8 handles as real
  buttons, visible only when the type is resizable and ≥1 selected) and
  `SelectionBar` ("N selected" + Delete for ≥2; the story-3 NoteToolbar for
  exactly one sticky).

### Generic multi-type model

`board-model.ts` gained type-agnostic group ops over an `objects` Y.Map:
`objectsSnapshot`, `objectBounds` (implicit-size stickies fall back to
`STICKY_SIZE_WORLD`), `objectsInRect`, `moveObjects`, `resizeObjects`,
`bringObjectsToFront`, `deleteObjects`. `KNOWN_TYPES` + `registerBoardType`
let the client registry (and tests) declare types with a min size and
aspect lock; `tests/fixtures/testbox.tsx` exercises a second type end to
end. `snapshot(): StickySnapshot[]` is unchanged (worker/integration compat).
`geometry.ts` holds the pure resize/contain/scale math (unit-tested, no DOM).

### Handle alignment gotcha

`.selection-overlay` must not use a CSS **border**: the border insets the
padding box, so absolutely-positioned handles land 1.5 px inside the true
corners and drags come out ~0.3 % off (TC-33 caught it). The box is drawn
with `outline`/`outline-offset: -1.5px` (layout-neutral) and the handle
buttons are `box-sizing: border-box` so an 8 px button is centred exactly on
the corner.

### Test matrix (story 7)

| Layer | Command | Added |
| ----- | ------- | ----- |
| Unit | `npm run test:unit` | 30: geometry TC-01…04 (+7), group ops TC-05…10 (+2), registry TC-11/12 (+3), selection reducer TC-13…15 (+2) |
| Component | `npm run test:component` | 16: TC-16…31 (marquee, transform, bar, keys, overlay) |
| E2E | `npm run test:e2e` | 5: TC-32 (marquee containment), TC-33 (group move/resize/clamp), TC-34 (nudge+Delete), TC-35 (remote-delete prunes selection), TC-36 (5-way concurrent convergence) |

TC-36 is scoped to chromium by the spec ("All pass in chromium; TC-32 also
in firefox and webkit"); it is skipped on the other two. Its drag distance
is kept below the inter-group gap so concurrent drag paths never cross
another group's marquee start point.

Note: live-collab TC-23/TC-25 (chromium/webkit) fail identically on the
pre-story-7 baseline — pre-existing timing flake, not a regression.

## Story 8: Undo and redo my own changes without undoing anyone else's

### How it works

`createUndo(doc)` (in `src/client/board/undo.ts`) wraps yjs's `Y.UndoManager`
over the `objects` map with `trackedOrigins = { LOCAL_ORIGIN }` and
`captureTimeout = UNDO_CAPTURE_TIMEOUT_MS` (500 ms). Only this tab's own
transactions are ever captured: remote (provider-origin) edits and story-4
LOAD updates arrive under a different origin and are invisible to the stacks,
so my undo/redo can never reverse a colleague's change (TC-01, TC-02, TC-03,
and the e2e trio TC-22…24).

- **Session only** — the controller lives in `BoardPage` for the life of one
  board doc; it is destroyed on unmount/board change, so a reload starts with
  empty stacks (TC-11).
- **Step boundaries** — `boundary()` (a `stopCapturing()`) is called around
  each user action so the model transactions of one gesture merge into one
  step: transform gesture start/end (incl. pointercancel), sticky create,
  delete, colour change, and text-editor mount/end. Inside the editor, the
  Ctrl/Cmd+Z shortcuts are intercepted (`preventDefault`) and routed to the
  controller so native textarea undo never diverges from Y.Text; typing bursts
  within 500 ms merge, longer pauses split (TC-12…17).
- **Redo clears on new work** (yjs default), `stack-item-added` trims to
  `UNDO_MAX_STEPS` (200) and drives `onChange` (TC-09/TC-10).
- **Safe no-ops** — undoing a step whose target was remotely deleted applies
  an inverse that lands on nothing: yjs auto-consumes the (now empty) top
  item and never throws; the next undo still works (TC-07, e2e TC-23).
- **Controls** — `useUndo` exposes `canUndo`/`canRedo` (false when not
  editable) plus `undo`/`redo`; `UndoButtons` render the toolbar pair
  (`aria-label` Undo/Redo with shortcut tooltips); `useBoardKeys` binds
  Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y, ignored while typing in a non-board
  input or editing a sticky (TC-18…21).

### E2E gotchas

- The camera centres the world origin on a 1280×800 viewport (screen = world
  + (640, 400) at 100%), and off-screen notes are **culled from the DOM** —
  seed/interact only inside the visible rect, and never `waitFor()` DOM for
  a note that may be culled.
- Marquee selection requires **full containment** (story 7): span the whole
  viewport rather than guessing a tight rect.
- `createSticky(x, y)` centres the note; the entry's x/y are the top-left
  corner (center − `STICKY_SIZE_WORLD/2`).
- For "history exhausted → Undo disabled", seed the fixture notes from the
  *other* participant so the actor's only captured step is the delete.
- Multi-participant final-state checks must **poll for convergence** within
  `LIVE_UPDATE_LATENCY_BUDGET_MS`; a one-shot read races the last sync.

### Test matrix (story 8)

| Layer | Command | Added |
| ----- | ------- | ----- |
| Unit | `npm run test:unit` | 24: history TC-01…11 (+`peer.ts` RemotePeer), boundaries TC-12/13 + no-op |
| Component | `npm run test:component` | 8: TC-14…17 (gesture/typing boundaries), TC-18…21 (shortcuts, buttons, edit lock) |
| E2E | `npm run test:e2e` | 3: TC-22 (delete/undo/redo vs. colleague's note), TC-23 (colleague deleted my object), TC-24 (5-way concurrent move+type+2×undo → identical boards) |

The e2e spec passes in chromium, firefox and webkit. The pre-existing
live-collab TC-23/TC-25 flake is unchanged.

## Story 9: Write free text anywhere on the board

### How it works

- **Model** (`src/shared/objects/text.ts`): a text object stores `text`,
  `size` (`S|M|L|XL`), the measured `width`/`height` and `widthMode`
  (`auto` | `fixed`). `createText` inserts an empty object with the default
  auto box. `setTextWidthFixed` (drag) and `setTextSize` (toolbar) remeasure
  through the client and write `width`/`height` back; `deleteIfEmpty`
  removes a text whose content was cleared. All writes go through
  `LOCAL_ORIGIN` transactions so personal undo history stays clean (story 8).
- **Layout** (`src/client/objects/textLayout.ts`): a pure word-wrap over a
  `TextMeasureContext` (canvas `measureText` in the browser, a
  `TEXT_GLYPH_WIDTH_RATIO` estimate fallback in jsdom). Auto width is
  `min(longest line + 2×padding, TEXT_MAX_AUTO_WIDTH_WORLD)` and height is
  `line count × fontPx × TEXT_LINE_HEIGHT`. Fixed width clamps to
  `TEXT_MIN_WIDTH_WORLD`.
- **Tool** (`useTool`): `select` (default) and `text` (one-shot — creating
  a text reverts to `select`). `V`/`T` shortcuts; `Escape` reverts `text`
  to `select`; `N` still creates a sticky at the centre (regression kept).
  Creation: Text tool + click → `createTextAtScreen` at the world point.
- **Editing**: double-click (or clicking a text with the Text tool) opens
  the shared `TextEditor` (a `textarea`, `white-space: pre-wrap`, no
  placeholder, no char counter). Enter inserts a newline (no commit),
  Escape commits. `StickyTextEditor` is now a thin wrapper over the shared
  editor, preserving its test ids and centred styling.
- **Sizing** (`useTextBoxSync`): every text render remeasures through the
  client's canvas and writes `width`/`height` back only when they drift
  from the stored values — so typing, resizing and font changes keep the
  box in sync, and remote text arrives with its box already measured.
- **Toolbar**: a single text selection shows the text toolbar (S/M/L/XL +
  Delete text). `size` is a first-class field (not a derived CSS class) so
  undo/redo and the toolbar stay in sync; changing size re-measures the box.
- **Resize**: a single text exposes **horizontal-only** handles (`e`/`w`;
  the registry spec `handles: 'horizontal'` drives `SelectionOverlay`).
  The `textWidth` gesture sets `widthMode: 'fixed'` and re-measures height.
  Mixed sticky+text selections still resize with the 8-handle sticky path
  (aspect-locked for stickies; text keeps its own width).
- **Abandoned text**: creating with the Text tool and pressing Escape
  before typing calls `deleteIfEmpty` (inside the creation's undo
  boundary), so an empty click leaves no object and nothing to undo.

### Caveats

- Component tests run in jsdom, which has no real canvas `measureText`:
  the layout falls back to the `TEXT_GLYPH_WIDTH_RATIO` estimator there,
  so exact pixel widths are asserted only in e2e (real canvas) and in
  unit tests (fake measurer). The estimator keeps component tests
  deterministic.
- The `dev:test` Vite build exposes `getTextObjects`/`setTextObjectText`
  test hooks (dead-code-eliminated in production).
- E2E runs against `wrangler dev`, which occasionally returns
  `500 Network connection lost` from the board-initialise endpoint under
  load; re-running a test that fails at `openBoard`/`newBoard` with that
  exact error is a flake, not a product regression.
- The pre-existing live-collab flake (TC-23/TC-25/TC-26 in
  `live-collab.spec.ts`) is unchanged by this story.

### Test matrix (story 9)

| Layer | Command | Added |
| ----- | ------- | ----- |
| Unit | `npm run test:unit` | text model (TC-01…06 + stale id), layout (TC-07…11, 32) |
| Component | `npm run test:component` | box sync (TC-12/13), tool (TC-14…18), text objects (TC-19…25) |
| E2E | `npm run test:e2e` | TC-26 (long annotation width/lines), TC-27 (e/w rewrap), TC-28 (title + marquee + delete + undo), TC-29 (two contexts typing), TC-30 (5-way concurrent creation), TC-31 (abandoned text) |

The e2e spec passes in chromium, firefox and webkit.

## Next story

Story 6 (presence: cursors and "who's here") rides the same provider;
the awareness channel is available on the BoardRoom connection.

## Story 10: Draw shapes and connect them with arrows that follow

### Shape and connector model

Both are plain entries in the `objects` Y.Map, registered with the board
schema:

- **Shape** — common fields plus `kind` (rect/ellipse/diamond), `fill`,
  `stroke`, `label: Y.Text`. `createShape` normalises the dragged rect:
  null or below `SHAPE_MIN_SIZE_WORLD` in either dimension becomes the
  standard `SHAPE_DEFAULT_SIZE_WORLD` square centred on the click point;
  `square` (Shift) anchors the larger dimension at the drag origin.
- **Connector** — two `Endpoint` Y.Maps: `{kind:'attached', objectId,
  fallback}` or `{kind:'free', x, y}`. Endpoints are never resolved when
  stored; `resolveEndpoints` computes the live line from the LIVE
  rectangles of the targets — an attached end sits on the side of its
  object nearest the other end (`nearestSide`, a 45° switch in
  normalised space), so moving/resizing a shape redraws its arrows
  without any writes (conn.follow). A target that vanished
  concurrently falls back to the stored `fallback` anchor.
- **Delete** — `deleteObjects` detaches connectors to the deleted ids
  inside its one transaction (`detachConnectorsTo`): the attached end
  becomes free at the anchor nearest the OTHER end (the stored fallback
  when the target is the only reference). A connector whose target is
  deleted on one client while its other end is reattached on another
  converges — the free end's exact point is order-dependent by design.

### Type registration (viewer-client gotcha)

`objectsSnapshot` filters entries by `isKnownBoardType`, and the board
schema registration was lazy (inside each object module's entry points)
because of the board-model ↔ connector import cycle (module-load-time
registration would hit the TDZ on `KNOWN_TYPES`). Lazy is not enough:
a client that only RECEIVES shapes/connectors (never creates them) never
runs `ensureType`, and remote objects render as invisible. Fix: public
`ensureShapeType()`/`ensureConnectorType()` seams, called at module load
from `src/client/objects/registry.tsx` — that module evaluates after
board-model, shape and connector, so the registration is TDZ-safe on
every client before the first remote object can arrive.

### Tools

`useActiveTool` (replaces the story-7 `useTool`) owns V/T/S/L and
Escape→Select; plain keys only, guarded by `canEdit` (creation tools) and
`isEditing` (all keys). The creation tools are one-shot: the created
object is selected and the tool reverts to Select. Selection of the
just-created object uses `selection.selectCreated` — an unguarded click,
because the guard (present-ids from the last snapshot) cannot know about
an object created in the same tick (same rationale as `startEdit`).

The Shape and Connector tools are screen-space overlay divs above the
viewport (z 10, between the viewport and the selection overlay), so they
block board gestures while active. The Connector tool shows the four
side-midpoint dots of the hovered object; while dragging over a target,
the TARGET's dots replace the start object's and the nearest side
highlights. Free endpoints: release over empty board, or drag a
ConnectorObject handle (its `onReattachEnd` gives BoardPage the client
point; BoardPage hit-tests world objects excluding the other end's
target, then attaches or leaves free).

### Caveats

- The pre-existing flakes (live-collab TC-23/TC-25, text TC-28 under
  full-suite load; wrangler `500 Network connection lost` at
  `openBoard`) are unchanged by this story — they fail identically on
  the clean tree.
- `seedCheckoutFlow`/`createConnectorBetween`/`reattachConnectorEnd`
  test hooks are exposed by the `dev:test` build only.

### Test matrix (story 10)

| Layer | Command | Added |
| ----- | ------- | ----- |
| Unit | `npm run test:unit` | shape model (TC-01…06 + label clamp), connector model + geometry (TC-07…14, TC-29) |
| Component | `npm run test:component` | ShapeTool (TC-15…17, TC-28), ConnectorTool (TC-18…21), useActiveTool (TC-22) |
| E2E | `npm run test:e2e` | shapes.spec (TC-24…26), connectors.spec (TC-25, TC-27) |

The e2e specs pass in chromium, firefox and webkit.

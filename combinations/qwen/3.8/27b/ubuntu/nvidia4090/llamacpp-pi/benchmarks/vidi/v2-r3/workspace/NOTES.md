# NOTES — Stories 4–7 (and the story 1–3 gap fill)

## 1. The repository was empty: stories 1 and 2 had to be gap-filled

No code from story 1 (board skeleton + pan/zoom) or story 2 (sticky notes) was
ever committed, but story 3 ("see other people's edits appear live") is
meaningless without a board to edit. Rather than stub, mock, or fake the
underlying product, I implemented the story 1 and story 2 product surface to the
extent story 3 depends on it, matching the story 1/2 design files (named
settings, exported interfaces, exact UI text and `aria-label`s). This is a
**gap fill**, not new scope for story 3.

What was built so live collaboration has something to collaborate on:

- **Story 1 (canvas):** `src/client/canvas/*` (camera model, pan by drag,
  wheel/button zoom with `ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_STEP_FACTOR`/
  `WHEEL_ZOOM_SENSITIVITY`, world-space dot grid at `GRID_SPACING_WORLD`),
  `src/client/board/Toolbar.tsx`, `src/client/App.tsx`, `src/client/main.tsx`,
  `src/client/styles.css`, `index.html`.
- **Story 2 (sticky notes):** `src/client/objects/*` (note creation by
  double-click or toolbar, drag to move with `DRAG_THRESHOLD_PX`, inline text
  editor with `STICKY_TEXT_MAX_CHARS` and the character counter, 6-colour
  palette `STICKY_COLORS`, delete, selection model), and the shared CRDT
  board model `src/shared/board-model.ts` (`initDoc`, `createSticky`,
  `moveObject`, `setStickyColor`, `deleteObject`, `bringToFront`, `snapshot`,
  `getStickyText`).
- **Shared:** `src/shared/config.ts` (all named settings for stories 1–3),
  `src/shared/board-id.ts`, `src/shared/protocol.ts`.

These are real, working product features — the e2e suite drives them through
the real UI (double-click to create, drag to move, type text, recolour,
delete), not through test hooks. The `window.__vidi6` test hooks (test builds
only) expose just `setCamera` and `connectionState`, as the story 3 design
specifies.

## 2. Wire-format fix: sync frames are raw, not length-wrapped (the real bug)

The single most important correctness fix. y-websocket's on-the-wire framing is
**type-specific**:

- `MESSAGE_SYNC` (0): `varUint(0)` followed by one or more **raw** y-protocols
  sync messages (no length prefix).
- `MESSAGE_AWARENESS` (1): `varUint(1)` + a `varUint8Array`-wrapped payload.
- `MESSAGE_QUERY_AWARENESS` (3): `varUint(3)`, no payload.

`src/shared/protocol.ts` originally wrapped *every* payload in a
`varUint8Array`, so the room mis-parsed a real `WebsocketProvider`'s first
frame (the on-open step1) as an empty sync payload and closed the socket with
`1003 unsupported data`. The browser client then reconnected in a loop and the
badge never left "Connecting…". Because the integration test client
(`tests/integration/ws-client.ts`) used the *same* (wrong) `encodeFrame` on
both ends, the integration suite was self-consistent and passed while the real
client could not sync. Fix: `protocol.ts` now matches the y-websocket client
byte-for-byte, and the room/client process **every** sync message in a frame
(a step2+step1 reply is one frame carrying two messages). Verified end-to-end
against the stock `WebsocketProvider` in the e2e suite.

## 3. workerd Durable-Object WebSocket quirks (integration + e2e both rely on these)

- **Close handshake is not echoed automatically.** workerd's DO socket does not
  complete the close frame on its own; the peer sees an abnormal `1006`. The
  room answers explicitly: on `close` it calls `ws.close(ev.code, ev.reason)`.
- **Sends before the 101 flush are dropped.** The room's on-connect step1 is
  deferred with `setTimeout(50)` and kept alive with `ctx.waitUntil`.
- **The client announces its own step1 on open** (mirroring y-websocket), so a
  fresh client receives the room's step2 and marks synced.

## 4. Integration tests: real `wrangler dev` instead of the vitest workers pool

The design names `@cloudflare/vitest-pool-workers` with a `SELF.fetch`
pattern. That pool runtime cannot deliver WebSocket *upgrade* frames to test
clients (verified: a pool WS client stays in `CONNECTING` forever). So
`tests/integration/global-setup.ts` boots the **same production Worker +
Durable Objects** on a local `wrangler dev` server (port 29042, inspector
29043) and the tests drive it over the network with `tests/integration/ws-client.ts`
(a faithful y-websocket client). The Worker under test is byte-for-byte the
production code; only the transport is a real TCP socket instead of the pool.
Node's undici `WebSocket` delivers binary frames as `Blob`, so the client
normalises `Blob → ArrayBuffer`. (TC-04 uses `node:http` because undici's
`fetch` rejects an `Upgrade: websocket` header.)

## 5. Test placement details (e2e)

- **Non-overlapping anchors.** Notes are 200 world units; at zoom 1 a
  double-click on occupied space edits the existing note instead of creating a
  new one. Multi-note tests therefore zoom out (`setCamera`) and place notes on
  a grid whose spacing exceeds the on-screen note size, and each editor owns a
  private row/column so concurrent editors never target the same pixel.
- **End edit mode before dragging.** `createNoteAt` leaves the note in edit
  mode (focused textarea); a subsequent drag would hit the textarea, not the
  note body. Tests press `Escape` (keeps selection) before moving/recolouring.
- **TC-27 offline detection.** Under Playwright `context.setOffline(true)` the
  browser does *not* fire the WebSocket `close`, so disconnection is detected by
  y-websocket's no-message watchdog (`messageReconnectTimeout` = 30 s). That is
  longer than `CATCH_UP_TEST_OUTAGE_MS` (30 s), so the test overlaps the
  offline edits with the detection wait rather than adding a second full
  outage. The badge still transitions `Connected → Reconnecting → Connected`
  exactly as specified.
- **TC-29 (idle) is safe.** The room relays each client's awareness *back to
  that client*, so idle sockets keep receiving traffic and the 30 s watchdog
  never fires while online — a 50 s idle probe shows zero unexpected
  `reconnecting` flips.

## 6. Board ids

`BOARD_ID_BYTES = 16` (128 bits → 22 base64url chars). The worker rejects any
id that is not exactly this shape, so tests generate 16-byte ids.

## 7. Named settings (all in `src/shared/config.ts`, as designed)

- Story 1: `ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP_FACTOR`,
  `WHEEL_ZOOM_SENSITIVITY`, `GRID_SPACING_WORLD`, `UNBOUNDED_PAN_TESTED_EXTENT`.
- Story 2: `STICKY_SIZE_WORLD`, `STICKY_TEXT_MAX_CHARS`,
  `STICKY_COUNTER_THRESHOLD_CHARS`, `STICKY_FONT_MAX_PX`, `STICKY_FONT_MIN_PX`,
  `DRAG_THRESHOLD_PX`, `STICKY_COLORS`, `DEFAULT_STICKY_COLOR`.
- Story 3: `MAX_CONCURRENT_EDITORS`, `LIVE_UPDATE_LATENCY_BUDGET_MS`,
  `RECONNECT_MAX_BACKOFF_MS`, `CONNECTED_CONFIRMATION_MS`,
  `CATCH_UP_TEST_OUTAGE_MS`, `E2E_EVENTUAL_TIMEOUT_MS`.

## 8. Out of scope (deliberately not built)

Stories 6 and 13–17: no presence/selection-cursor UI, no sign-in, no dashboard,
no comments, no export. The awareness channel exists only to keep idle sockets
alive and to carry no product-visible state in this story.

## 9. Story 4 — persistence decisions

- **`WranglerProcess` (e2e) must kill the whole process group.** `wrangler dev`
  spawns workerd as a *grandchild* of the `npx` we spawn. Killing only the top
  process leaves workerd holding the port, so every later “restart” silently hit
  a stale orphan (symptom: `/__test/...` returned a 500/HTML from a dead-code
  worker instead of JSON). Fix: spawn `detached: true` (child becomes the group
  leader, `pgid === pid`) and stop with `process.kill(-pid, SIGTERM)` then
  `SIGKILL`, and wait until the port actually stops answering before returning.
  This mirrors the integration `global-setup.ts`. Durable Object SQLite is
  durable per transaction, so an ungraceful kill loses no committed data.
- **Seeding via `store-append-many` leaves the running room stale.** The hook
  writes straight to SQLite and updates the hook’s own scratch doc, not the
  already-constructed room’s in-memory doc. So the persistence e2e restarts the
  process (or calls `room-reset`) after seeding, so the room rebuilds its doc
  from disk before we observe it. TC-21/TC-24 both seed → restart → compact.
- **TC-24 recovery needs `room-reset` after repair.** After `corrupt-snapshot`
  (which already resets) the room is `load-failed`; a plain `repair-snapshot`
  would only reload on a connection ≥ `LOAD_RETRY_MIN_INTERVAL_MS` (5 s) after
  the failure, and each failed reload resets that clock. We call `room-reset`
  after repair so the *next* client reconnect reloads immediately
  (`storage-failed` → reload), independent of the 5 s gate. The client
  reconnect backoff can reach `RECONNECT_MAX_BACKOFF_MS` (10 s), so the
  recovery poll uses a 30 s timeout (correctness, not speed, is under test).
- **Client recovery maps straight to `connected`.** Close 4500 →
  `load_failed` (red message, editing off). The first successful `sync` after
  `load_failed` goes directly to `connected` (no `reconnecting`/`confirmed`
  detour, no page reload); `onStatus` early-returns while `load_failed` so
  retry status events don’t clear the red badge. Other close codes (1011,
  1003, network) → `reconnecting` (board stays readable, editing on) because
  the client re-sends unsaved changes on reconnect.
- **Production hook check.** The default wrangler environment has no
  `TEST_HOOKS`, so `index.ts` never routes `/__test/...` to the hooks; requests
  fall through to the assets binding — `POST` → 405, `GET` → SPA `index.html`
  (200 `text/html`) — never `application/json`. `npm run check:production-hooks`
  builds the production client, starts `wrangler dev` (no `--env test`) on
  29046/29047, and asserts this for `store-status`, `corrupt-snapshot` and
  `repair-snapshot`, plus a sanity SPA serve.
- **TC-21 timing is logged, never asserted.** Model, browser and server share
  one machine; a 2000-note open measured ~7.9 s here (over the 3000 ms
  `BOARD_LOAD_BUDGET_MS`) and that is reported, not failed, per the task.
- **Port allocation (29040–29055).** 29040/29041 shared e2e; 29042/29043
  integration; 29044/29045 persistence e2e (`WranglerProcess`); 29046/29047
  production hook check. All servers we start pass an explicit
  `--inspector-port` in range.

## 10. Story 5 — share a board with a link

- **Deviation — `nextBoardPageState` signature.** The design gives
  `(state, result, attempt)`; that shape cannot produce
  `{ kind: 'ready', boardId }` because the reducer never knows which board it
  is checking. The implementation is `(state, boardId, result, attempt)` —
  first parameter added, everything else per design (same states, same
  backoff arithmetic, same terminal outcomes).
- **TC-09 ordering: upgrade check before existence check.** A request for an
  *unknown* board must be 404 *when it carries an `Upgrade: websocket`
  header*, but story 3 TC-05 still requires 426 for a non-upgrade request to
  a *valid* board. `fetch` therefore orders: malformed id → 404; missing
  upgrade header → 426; unknown board → 404; then the room handshake. Both
  stories hold.
- **`existsReadOnly` legacy rules (design line 45).** `true` when
  `storage_meta.created_at` exists, or (legacy) `updates` has any row, or
  (legacy) `snapshot_chunks` has any row; `false` when the board has no
  tables at all. Each table query is guarded by the table list, so a
  partially-migrated board (e.g. only `updates`) cannot crash the check.
- **workerd internal table `__miniflare_do_name`.** workerd creates this
  internal table in every DO database, so `name NOT LIKE 'sqlite_%'` would
  report *every* board as existing. `boardTables()` uses an explicit
  whitelist: `name IN ('updates', 'snapshot_chunks', 'quarantined_updates',
  'storage_meta')` (worker store and test hook share the same list).
- **Migration moved out of the constructor.** `new BoardStore(storage)` no
  longer migrates. Tables are created by `initialize()` (board creation) and
  lazily by the first `append()` to a table-less board (legacy upgrade path,
  which writes the schema version but no `created_at` — exactly the TC-08(a)
  shape). The room constructor's `load()` therefore never mutates storage; a
  table-less board loads as an *empty* board (`{ok, quarantined: 0}`), which
  is the "unknown board" case the room 404s on before the upgrade.
- **TC-12 (initialize throws → 500, nothing persisted).** Board-level
  injection can't be reached from the worker (the room is a different DO
  class instance), so `create-board.ts` exposes
  `injectInitializeForTests` (a worker-process variable) and the hook route
  `POST /__test/faults/create-board` sets `mode: 'throw' | 'exists' |
  'clear'`. The test exercises the real `POST /api/boards` handler end to
  end.
- **`raw-sql` hook op (TC-08(b)).** Seeding a *legacy* board (an `updates`
  row with no schema version, no `created_at`) is impossible through
  `store-append*` (its session migrates first). `POST /__test/boards/:id/
  raw-sql` runs one parameterized statement against the board's SQLite
  database; it is only mounted under `TEST_HOOKS`.
- **E2E: `apiCreateBoard(request, baseUrl?)` helper (helpers.ts).** Rooms no
  longer materialize on first connect, so every e2e test that opens a board
  creates it via `POST /api/boards` first. `live-collaboration` and the
  nightly soak use the shared `webServer` (the context `request` fixture's
  baseURL); `persistence` passes its own `proc.url`. The only ids still made
  raw are the ones that must *not* exist (bad-link test) and the
  hook-seeded legacy boards (persistence TC-21/24 — the seed creates their
  tables, so they are "existing" boards by data, story 4-era simulation).
- **TC-31 needs `room-reset` after seeding.** The `store-append-many` hook
  itself constructs the room (to get storage) — at that moment the board is
  empty, so the constructed room holds a stale empty doc. Same caveat as
  persistence TC-21/24: reset after seeding so the first real connection
  reloads from disk.
- **`store-status` extended, not changed.** All story 4 fields keep their
  names; added `tables: string[]` and `createdAt: string | null`. The
  integration `StoreStatus` type mirrors this.
- **Integration `global-setup` now builds the client.** Story 5's server
  serves the SPA (`/`, `/b/:id`) from `dist/client`, so the setup runs
  `vite build --mode test` before starting wrangler (same as the e2e
  `webServer`).
- **`app-load-failed.test.tsx` renders `<Board>` directly.** `App` now hosts
  the router (home page at `/`), so the story 4 "load failed" test mounts
  `<Board boardId="test-load-failed" />` — the exact same component the
  board page would mount. `canEdit` is re-exported from `App.tsx` for the
  story 4 test import.
- **TC-21 (component) fake timers.** The retry loop uses real timers in the
  test only through `vi.advanceTimersByTime`; `await act(async () => {})`
  flushes the microtask queue between advances, and assertions use `act` +
  synchronous queries (no `findBy*` — those spin their own timer loop and
  deadlock under fake timers).
- **Firefox/WebKit not covered (environment limitation).** The tasks list
  TC-27/TC-29 "in firefox and webkit too", but this machine has only
  Chromium installed (`~/.cache/ms-playwright` holds chromium builds only;
  installing other browsers is not possible offline). The Playwright config
  therefore keeps a single chromium project (extended to match
  `(live-collaboration|share)\.spec\.ts`); no firefox/webkit projects are
  declared, so no suite fails for a missing browser. The share flows are
  DOM/clipboard only (no browser-specific APIs beyond `navigator.clipboard`,
  which is exercised on Chromium), so porting is a config change.
- **Clipboard in component tests.** jsdom has no `navigator.clipboard`;
  `SharePanel.test.tsx` defines it via `Object.defineProperty` per test
  (allow / reject variants). e2e TC-26 uses a context with
  `permissions: ['clipboard-read', 'clipboard-write']` for the real API and
  reads the link back with `navigator.clipboard.readText()`; TC-29's init
  script replaces `writeText` with a rejecting promise to force the manual
  fallback and asserts `window.getSelection()` equals the full link.
- **Click→board budget is logged, never asserted** (TC-26 e2e): the
  2000 ms `CREATE_BUDGET_MS` is a UX target; the measured value is printed
  with a within/over marker.
- **No new ports.** Story 5 reuses the existing allocation (29040–29047);
  29050/29051 were used only for manual debugging during development.

## 11. Story 7 — multi-select, move, resize, delete

- **Generic `ObjectSnapshot` (base shape).** `board-model.snapshot()` now
  returns `ObjectSnapshot[]` (`{ id, type, x, y, width?, height?, color?,
  text?, z, createdAt }`) instead of sticky-only records. Group operations
  (`objectBounds`, `objectsInRect`, `moveObjects`, `resizeObjects`,
  `bringObjectsToFront`, `deleteObjects`) and the client selection/registry all
  key off this, so a future object type needs no changes to the selection or
  transform code — only a registry entry.
- **Single-tier type registry.** `src/client/objects/registry.tsx` holds the
  render map (`registerObjectType` / `getObjectType`) and the sticky is
  registered at module load. `board-model` keeps a separate `knownTypes` set
  (`registerKnownObjectType` / `isKnownObjectType`) so the CRDT layer can
  ignore/validate types it does not own. The two are deliberately independent:
  the registry is client-rendering, the known-types set is model-integrity.
- **Selecting a just-created note is deferred.** A note written by
  `createSticky` is not in the snapshot (hence not in the selection reducer's
  `presentIds`) at the moment of the write, so a synchronous `selection.click`
  / `startEdit` is rejected by the reducer (the reducer *must* reject unknown
  ids — the TC-13/TC-15 unit tests assert that). Fix: `Board` records the new
  id in `createdIdRef` and an effect (registered *after* `useSelection`'s
  prune, so `presentIds` is current) selects + edits it once the id appears in
  the snapshot. The select is retried across renders until it lands because the
  prune's own dispatch is queued behind the effect that first observes the id.
- **E2E marquee needs a `clearSelection` first.** The shift-marquee is
  *additive* (unions the captured ids into the current selection). Creating a
  note leaves it selected (see above), so an un-cleared leftover note would be
  unioned into the marquee result and the "N selected" assertions would count
  one extra. The e2e helper `clearSelection` clicks empty canvas
  (`(100,750)` — `(1240,780)` is the `zoom-controls` widget, not canvas) before
  each shift-marquee. This is a test-harness concern, not a product bug.
- **`resizeRect` corner vs edge aspect lock.** Aspect-locked resize keeps the
  ratio only for *corner* handles; edge handles change one dimension freely.
  `clampScale` stops the group at `STICKY_MIN_SIZE_WORLD` so a shrink cannot
  invert or zero the bounding box. (Story 6/7 stickies are aspect-locked, so a
  group corner-resize keeps every note square.)
- **jsdom `setPointerCapture` guard.** jsdom (v30) has no `setPointerCapture` /
  `releasePointerCapture`. `BoardViewport` and the transform gesture guard both
  calls with `typeof el.setPointerCapture === 'function'` (best-effort, in a
  `try/catch`) in *product* code — not a test polyfill — so the same code runs
  unchanged in Chromium and jsdom. Pointer up/move are listened on `window`
  (the gesture target may move out from under the pointer).
- **Transform gesture applies synchronously (not rAF-throttled).** The
  gesture writes the new geometry straight to the doc on each pointer move.
  This keeps jsdom component tests deterministic (no rAF flushing); the board is
  small enough that per-move writes are fine, and the CRDT coalesces them.
- **Firefox/WebKit not covered (environment limitation).** TC-32 says "also in
  firefox and webkit"; this machine has Chromium only (offline), so the
  Playwright config keeps a single chromium project. The multi-select flows are
  DOM/pointer only (no browser-specific API), so porting is a config change.
- **No new ports.** Story 7 reuses 29040 (e2e `webServer`) like story 3.

## 12. Story 8 — undo and redo my own changes without undoing anyone else's

- **Per-user history = a `Y.UndoManager` scoped to the objects map that
  tracks only the local origin.** `createUndo(doc)` builds
  `new Y.UndoManager(doc.getMap('objects'), { trackedOrigins: new Set([LOCAL_ORIGIN]),
  captureTimeout: UNDO_CAPTURE_TIMEOUT_MS })`. Every product mutation is one
  `doc.transact(fn, LOCAL_ORIGIN)`, so only this tab's own transactions are
  captured; remote (provider-origin) changes and story 4 load updates are never
  in the stack (`undo.own`). One controller per `Y.Doc`, created in
  `useUndo(doc)` inside `<Board>` (the doc lives in `useBoardDoc`), destroyed on
  unmount — a reload gets a fresh, empty stack (`undo.session_only`).
- **`LOCAL_ORIGIN` is a unique `Symbol`**, not a string. Yjs's default
  (empty) `trackedOrigins` would capture *everything*, and a string origin does
  not round-trip the symbol the model uses — so the manager is told the exact
  symbol the model writes with. (An empty `trackedOrigins` + a string origin is
  the combination that silently captures nothing; the manager needs the same
  object identity the transactions carry.)
- **The corruption bug (root-caused & guarded).** Undoing a step whose object a
  *remote* peer has since deleted made Yjs re-insert a struct whose parent was
  already gone, and the **entire `objects` map emptied** (total corruption) for
  everyone. The trigger: the object's *creation* was tracked locally **and** a
  remote peer deleted it, then a local undo targeted it. Fix: a **safety
  guard** in `undo.ts` (`stepIsSafe`) runs before every `manager.undo()/redo()`. For
  the top stack item it walks every struct in both `insertions` and `deletions`
  up to its top-level object key (`topLevelKey`, following `._item` until the
  parent is the objects scope) and refuses the step unless that key is still
  alive in the scope *or* being re-inserted by the same step. An unsafe step is
  **popped as a no-op** (consumed, `onChange` emitted) instead of applied — so
  undo stays safe and never throws, and the next undo still works. Only
  structural liveness is checked; the public `scope.has(key)` is used (no
  reliance on Yjs internals beyond `_item`/`parentSub`, which are stable).
- **Step boundaries.** A *gesture* (group move/resize) is one step:
  `useTransformGesture` calls `undo.boundary()` (`stopCapturing()`) on start and
  end, so a 30-frame drag is a single undo. Colour/delete in the note toolbar
  and create-in-`Board` are single model calls already (one `LOCAL_ORIGIN`
  transact each). The text editor calls `boundary()` on mount and unmount and
  writes via `applyTextDiff(..., LOCAL_ORIGIN)`; fast typing (within the capture
  timeout) merges into one step. Nudge/delete in `useBoardKeys` are bounded the
  same way.
- **`ObjectProps` gained `undo: UndoController`.** Objects (stickies) need the
  controller to (a) pass it to `StickyTextEditor` for the in-field Ctrl+Z
  interception and (b) put boundaries around colour/delete. `Board` passes
  `undoState.controller` into every rendered object. This is an additive prop,
  so the existing object component tests (which don't set it) were unaffected.
- **Keyboard + buttons.** `useBoardKeys` takes the controller and, after the
  existing editing/field guards, maps Ctrl/Cmd+Z → undo and Ctrl/Cmd+Shift+Z or
  Ctrl/Cmd+Y → redo (each `preventDefault`). `StickyTextEditor` intercepts the
  same combos on the textarea (`preventDefault` + `stopPropagation`) so an undo
  inside the field edits the *text* via the controller, not the board. The
  toolbar `UndoButtons` are `aria-label` "Undo"/"Redo", disabled when
  `!canUndo`/`!canRedo`/`disabled` (load-failed locks the whole bar).
- **Controller state is React-observable.** `useUndo` subscribes to
  `onChange` (fired on stack-item-added/popped, including guarded no-ops) to
  recompute `canUndo`/`canRedo` and re-render the buttons; `boundary`/`undo`/
  `redo` are stable (via refs) so effect deps don't thrash.
- **Test-first, and `vi.mock('lib0/time')` needs yjs inlined.** TC-01..TC-13
  were written first against a simulated remote peer (`tests/unit/peer.ts`). The
  capture-timeout tests (TC-12/13) freeze `lib0/time.getUnixTime` (yjs measures
  "now" through it, captured by reference at import). For that mock to reach
  yjs's *internal* import, yjs and lib0 must be **inlined** in the unit config:
  `server.deps.inline: ['yjs','lib0']` (externalised by default, where Node's
  native ESM bypasses the vitest mock). Component tests render the full
  `<Board>` (real controller + real gesture hook) with notes seeded under a
  **non-`LOCAL_ORIGIN` origin** so the seeded notes are never in the caller's
  undo stack — only the interactions performed in the test are.
- **E2E seeding uses a non-`LOCAL_ORIGIN` origin too.** `seedNotesRemote` writes
  into `window.__vidi6.doc` under origin `'remote-seed'`; the y-websocket
  provider re-broadcasts it, so every participant sees the notes but *no one's*
  undo manager captures them — exactly the "board already had content" case
  where undo must not touch it. `__vidi6` exposes `doc` and the `Y` namespace
  (hence `Board` imports `yjs` as a value, not `type-only`) so tests can build
  and apply such updates. `deleteObjectById` deletes under a local (non-
  provider) origin to model a real local delete from a second participant.
- **Yjs 13.6.33 gotchas (no behaviour change, just what the build lacks).**
  `Y.encodeUpdateAsBinary` does not exist in this build — use
  `Y.encodeStateAsUpdate`. Root named types have `_item === null` (access
  through `doc.share`, not an item). `doc.store.clients` is
  `Map<number, Array<GC|Item>>` and `DeleteSet.clients` is
  `Map<number, Array<{clock,len}>>`; the guard's structural types mirror these.
  The namespace does not export `DeleteSet`/`StackItem`/`TransactionOrigin` as
  types, so `undo.ts` declares local structural types (`StackItemLike`,
  `DeleteSetLike`, `StructStoreLike`).
- **Config added:** `UNDO_CAPTURE_TIMEOUT_MS = 500` (merge window for a step),
  `UNDO_MAX_STEPS = 200` (front-trimmed on `stack-item-added`).
- **No new ports.** Story 8 e2e reuses 29040 (shared e2e `webServer`).

## 13. Story 10 — draw shapes and connect them with arrows that follow when moved

- **No gap fill from stories 1/2 was needed.** Everything story 10 builds on
  (camera, selection, transform gesture, marquee, the object registry,
  `window.__vidi6`) already existed from stories 1–9, so nothing had to be
  back-filled to their design. Nothing from stories 6 or 13–17 was stubbed or
  hooked either (out of scope).
- **Shape model (`src/shared/objects/shape.ts`).** `createShape` stores
  `kind/fill/stroke/label` (a `Y.Text`, so concurrent labelling merges like
  sticky text) plus the shared base fields. A dragged rect below
  `SHAPE_MIN_SIZE_WORLD` in either dimension is treated as a click and becomes
  a `SHAPE_DEFAULT_SIZE_WORLD` square centred on the click; `square` (Shift)
  makes a square of the larger dragged side anchored at the drag origin. Every
  mutation is one `LOCAL_ORIGIN` transact; invalid input returns `null`/
  `false` with no transaction. `setShapeStyle` only touches the given colour
  keys and rejects names outside the palettes. `getShapeLabel` returns the
  `Y.Text` for the editor.
- **Connector model + geometry (`src/shared/objects/connector.ts`,
  `src/shared/geometry/connector-geometry.ts`, `src/shared/geometry/polyline.ts`).**
  An endpoint is `{kind:'attached', objectId, fallback}` or `{kind:'free', x,
  y}`. Attached endpoints always carry a `fallback` point: set at attach time
  to the side anchor of the side nearest the other end, and used to render the
  end when the target object is absent (the orphaned-end case). `x/y/width/
  height` are stored as `0` and re-derived in `snapshot` from the resolved
  endpoints, so a connector never carries stale bounds. `nearestSide` is
  aspect-aware (compares `|dx|·h` vs `|dy|·w`; the 45° tie goes horizontal).
  `detachConnectorsTo` converts every attached endpoint on a deleted object to a free endpoint at
  the *current* side anchor and is run inside `deleteObjects`' transaction, so
  deleting a shape keeps its arrows (now with a free end) rather than
  deleting them.
- **`ObjectSnapshot` extended, not changed.** The base snapshot gained
  optional `kind/fill/stroke/label/from/to` (connector endpoints) and the two-
  pass `snapshot` (collect rects, then resolve connectors) so connectors get
  real bounds. Existing sticky/text snapshots are byte-identical.
- **Active tool replaces the old `useTool`.** `src/client/tools/useActiveTool.ts`
  owns the `ToolId` (`select|sticky|shape|connector`), the shortcut map
  (`TOOL_SHORTCUTS`: V/N/S/L), and the return-to-Select-after-creating rule
  (`toolCreated`). The old `src/client/board/useTool.ts` was deleted. `N` keeps
  its story-2 behaviour (create a sticky at view centre) as an *action*, not a
  tool switch. Escape cancels an armed tool back to Select without creating.
- **Registry `hitTest` widened to `(obj, worldPoint, zoom, rects)`.** Sticky/
  text ignore `zoom`/`rects` (bounding box). The connector hit-tests the
  *resolved* polyline with a screen-px tolerance: `distanceToPolyline ≤
  CONNECTOR_HIT_TOLERANCE_PX / zoom`, so "6 screen px" is constant across zoom
  (the TC-20 boundary at 100/50/200%). `buildRects` + `findObjectAt` were added
  to the registry so tools and objects can resolve world points to ids.
- **`handles: 'none'` on the connector spec.** Connectors are selected by their
  wide invisible hit stroke, not a bounding box; `SelectionOverlay` renders the
  selection rectangle but no resize handles when every selected object is
  `handles: 'none'`. Endpoint re-attach is done by the connector's own two
  handles (`data-connector-handle`), dragged in screen space and re-resolved
  (attach to the object under the release point, else free at the release
  world point).
- **Component tests (TC-15…TC-22, TC-28)** live in
  `tests/component/{ShapeTool,Connector,useActiveTool}.test.tsx`. The board
  harness renders the real `<Board>`; the connector hit-test case calls the
  registry's `hitTest` directly with synthetic zoom/rects (the deterministic
  boundary the task asks for).
- **E2E fixture (`tests/fixtures/checkout-flow.ts`).** The "draw a flow" board
  (4 labelled shapes + 3 connected connectors + 1 free-tail connector) is built
  with the *real* shared model calls against a local `Y.Doc`, then shipped to a
  page as `Y.encodeStateAsUpdate` bytes and applied to `window.__vidi6.doc`.
  Applying it through a participant's connected provider broadcasts the whole
  board to every other participant over the server — no test-only seeding hook
  in the worker. Two gotchas: (a) the Node-side builder must call
  `registerKnownObjectType('shape'|'connector')` first, because `snapshot`/the
  live-rect lookups inside `createConnector` only see types the client registry
  has registered (in the browser that happens at load); (b) placeholder
  `(0,0)` fallbacks are fine because `createConnector` re-settles them from the
  live rects (all targets exist in the fixture doc).
- **E2E camera is `(0,0,1)`** for the shape/connector specs (unlike the story-3
  `CAM`), so screen coordinates equal world units and positions are asserted
  exactly (±1 px, ±2 px for the round linecap). The specs use real drags
  (`mouse.move/down/up`) through the real tool layers and the real transform
  gesture — no test hooks for creation.
- **TC-27 delete race is forced deterministically, not by WS route delays.**
  Playwright cannot delay a *connected* WebSocket's frames (`context.route`
  only sees the HTTP upgrade, not the y-websocket data frames), so a route
  delay cannot overlap Sam's delete with Dana's create. Instead: Dana goes
  offline (`context.setOffline(true)`), drags an arrow onto B and releases —
  her create is attached to B with B's side anchor as fallback — while Sam
  (still online) deletes B. On reconnect Dana's create reaches the server
  *after* Sam's delete, so the connector ends attached to a now-missing object
  and renders at its fallback. This exercises the same orphaned-end path a
  true network overlap would produce, deterministically. (Both orderings —
  create-then-delete and delete-then-create — converge on "arrow renders at
  the fallback"; this ordering additionally proves the orphan path. No
  uncaught console errors are asserted on Dana's page.)
- **Single-shape delete is via the `Delete` key.** The "Delete selection" bar
  only renders for ≥2 selected objects and a single shape's `ShapeToolbar` has
  no delete button, so the e2e `deleteAt` helper selects (click) then presses
  `Delete` (the `useBoardKeys` delete path). This matches how a user deletes
  one shape in the real UI.
- **Firefox/WebKit not covered (environment limitation).** TC-24 says "also in
  firefox and webkit"; this machine has Chromium only (offline, as in
  stories 3/5/7/9), so the Playwright config keeps a single chromium project
  (testMatch extended to `|shapes|connectors`). The flows are DOM/pointer only,
  so porting is a config change.
- **No new ports.** Story 10 reuses 29040 (shared e2e `webServer`).

## 14. Story 11 — sketch freehand with a pen

- **Mid-draw unmount cancels (no commit).** Escape mid-stroke arms Select and
  unmounts `PenTool`. Story 10's design says "Escape cancels an in-progress
draw", so an *intentional* tool switch discards the points; the PRD's
  "keep the stroke" rule is for *system* interrupts (`pointercancel` /
  `lostpointercapture`), which commit what has been drawn. The unmount effect
  just clears the draw state — no `commitPart` call.
- **Coalesced events.** On pointermove the tool processes
  `e.getCoalescedEvents()` and *then* appends the current event (the spec says
  the current event is not in the coalesced list). jsdom has no
  `getCoalescedEvents`, so component tests see exactly one point per event.
- **Preview is rAF-driven and stores the full draw state.** The in-progress
  points, colour and thickness are locked at pointerdown (a gesture can't
  change options mid-draw); the rAF loop renders the smooth path from
  `drawRef` into `data-pen-preview`. Component tests fake
  `requestAnimationFrame` and flush with `act(() => vi.advanceTimersByTime(16))`
  (safe: `connectBoard` is mocked and nothing else in `<Board>` uses rAF or
  timers during mount). Real e2e (TC-17) samples the preview `d` via a rAF
  promise *in the page* while the mouse drag runs in parallel.
- **TC-12 float precision.** `scaledPoints` rebuilds absolute points as
  `origin + relative * (size/base)`; IEEE arithmetic does not guarantee
  `x + (p.x - x) === p.x`, so the join-point assertion uses `toBeCloseTo(..., 8)`
  (the parts are still the same doubles — well inside a pixel at any zoom).
- **TC-16 (jsdom) is a two-part assertion.** jsdom performs no geometric
  hit-testing, so the test proves (a) the registry `hitTest` rejects a point
  inside the bbox but far from the line, and (b) clicking the element a browser
  would actually reach there (the sticky below) selects the sticky — not the
  stroke. The real browser proof is e2e TC-20 (click selects the line itself).
- **E2E pen camera is `(0,0,1)`** (like story 10): screen = world. The fixture
  paths (`tests/fixtures/pen-paths.ts`) sit inside the 1280x800 viewport at
  that camera. `playwright.config.ts` testMatch extended with `|pen`.
- **Wheel pans map-style with the pen active.** The pen layer intercepts
  pointer events but not wheel: the wheel bubbles to the viewport's native
  (non-passive) listener, which pans `(-deltaX, -deltaY)` — wheel deltaY +100
  moves the content *up* (TC-19 asserts that convention).
- **Pre-existing e2e flakes under load.** `live-collaboration` TC-23 and
  `multi-select` TC-33 occasionally fail when the full suite runs on the shared
  test machine (they pass in isolation and on re-run); both are
  timing-sensitive pre-existing specs untouched by this story. The final full
  run was green (35/35).
- **No new ports.** Story 11 reuses 29040 (shared e2e `webServer`).

## 15. Story 12 — drop images onto the board

- **Asset ids are 22-char board ids, not UUIDs.** The spec prose says "uuid",
  but TC-02 asserts a 22/22-char key is *valid* while the asset-key pattern
  (`ASSET_KEY_PATTERN`) accepts `<22>/<22>`; a UUID (36 chars) would fail the
  pattern. The worker therefore mints asset ids with `newBoardId()` (22 chars),
  and `assetKeyFor(boardId, assetId)` validates both halves as 22-char ids.
- **Raw-path routing for `/api/assets` (defense in depth).** workerd normalises
  dot segments in the URL *before* the fetch handler, so `../` traversal is
  invisible at the wire level in integration tests. The worker still matches
  the assets route on the raw request path (`req.url.slice(req.url.indexOf('/', 8))`)
  and the handler itself 404s any non-matching/relative segment. The
  integration test asserts the observable property ("the traversal response is
  not an image"); the handler-level unit test proves the literal 404.
- **`UPLOAD_ORIGIN` is untracked by the UndoManager.** Upload-settle writes
  (placeholder → ready/failed) are separate transactions with their own origin;
  the story 8 UndoManager only tracks `LOCAL_ORIGIN` + the remote origin, so
  "add images" stays exactly one undo step regardless of how many uploads
  settle afterwards.
- **Persistent client identity.** `vidi6.clientId` in localStorage (randomUUID
  fallback) so the uploader recognises their *own* failed/stale image after a
  reload and offers Remove instead of Retry (the in-memory File is gone).
  New objects carry this identity.
- **Object ids are the objects-map keys** (codebase convention: `createSticky`
  and friends never write an `id` field). Image placeholders follow suit;
  component/e2e tests read ids from the map keys, not from a field.
- **Paste inserts only image MIME types.** Clipboard content whose files are
  not in `IMAGE_ACCEPTED_TYPES` is silently ignored (no toast) — text pastes
  are left to the text editor; drops and the picker run the full
  `validateFiles` (type/size/count toasts).
- **The 30-second render clock runs only while something uploads** (for the
  `displayStatus` "unfinished" derivation, stale > 5 min), so idle boards pay
  no re-render cost.
- **e2e drops use the real `DragEvent` constructor with a `DataTransfer`**
  built from fixture bytes inside the page (`tests/e2e/drop-files.ts`);
  Playwright has no API to put files into a DataTransfer from Node. jsdom
  (component tests) has neither, so those tests dispatch plain Events with a
  duck-typed `dataTransfer`.
- **e2e pins the camera to (0,0,1) after `openBoard`** (openBoard itself uses
  the -640,-400 camera of the shared helpers; screen==world is required for
  the exact placement/resize assertions).
- **Failed-state controls fit only above ~48px of object height.** The box
  keeps the object's size (overflow hidden), so on very small images the
  Retry/Remove row clips. e2e TC-28 deliberately uses a 320x240 image so the
  controls are clickable; the design contract (box == object size) is kept.
- **TC-26 relies on browser content sniffing** for `<input type=file>`: a PDF
  renamed `.png` reports `application/pdf` in Chromium/Firefox/WebKit and is
  refused client-side with the exact type toast (the worker's magic-byte
  sniff is the trust boundary; the client check is UX).

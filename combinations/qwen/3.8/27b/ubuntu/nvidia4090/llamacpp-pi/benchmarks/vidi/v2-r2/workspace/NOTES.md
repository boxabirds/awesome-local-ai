# Story 1: decisions and environment notes

_(Story 2 decisions are at the bottom of this file.)_

# Story 2: Capture ideas on sticky notes — decisions

## Environment

- **E2E runs on Chromium only.** The sandbox pre-installs only the
  Chromium Playwright browser (`chromium-1243` + headless shell) under
  `~/.cache/vidi-agent-ms-playwright`; Firefox and WebKit binaries are not
  present and cannot be downloaded (no network to the Playwright CDN, no
  root). `playwright.config.ts` therefore keeps all three projects per the
  design, and `npm run test:e2e` selects the `chromium` project
  (`playwright test --project chromium`). On a machine with all three
  browsers, `npx playwright test` would run everything.
- **`scripts/ensure-browsers.mjs`** runs before the e2e suite and makes
  `PLAYWRIGHT_BROWSERS_PATH` work no matter how the environment sets it: it
  keeps the current value when it contains a Chromium binary, otherwise
  falls back to the sandbox cache locations.
- **Ports.** All servers stay inside `$AGENT_PORT_FIRST..$AGENT_PORT_LAST`
  (defaults 29104-29119): `vite dev` on 29104, the e2e `wrangler dev`
  webServer on 29105 (config asserts the port is in range).

## Implementation decisions

- **CameraContext.** `useCamera` lives in `App` (which also owns the
  viewport size) and is provided via `CameraContext`; `BoardViewport`
  consumes it. This keeps the viewport's public API as `{children}` while
  the board input, zoom controls and hint all drive the same camera.
- **rAF coalescing.** Every camera mutation is enqueued and applied once
  per animation frame (`useCamera`), so fast wheel/drag bursts cause at
  most one render per frame. `endPan` flushes synchronously so a drag ends
  on the exact pointer position.
- **ZoomControls enabled-guards.** Buttons carry the native `disabled`
  attribute and additionally check `canZoomIn/Out` before calling their
  callbacks, keeping the design contract ("call callbacks only when
  enabled") true even for synthetic events (jsdom fires `click` on
  disabled elements — TC-32).
- **`setPointerCapture` guard.** Called only when available (jsdom lacks
  it; every supported browser has it).
- **Test hook.** `window.__vidi6.setCamera` is installed only when
  `import.meta.env.MODE === 'test'`; verified absent from the production
  bundle (`grep __vidi6 dist/client/assets/*.js` → 0 matches).
- **E2E pixel target.** The origin marker is a 12px world-space crosshair
  centred on (0,0); its centre is exactly `worldToScreen(0,0)`, so
  movement assertions are ±1px camera assertions. TC-27/TC-26 travel to
  `UNBOUNDED_PAN_TESTED_EXTENT` via the test hook; the marker's layout box
  is readable even far off-screen.
- **TC-18 (keys)** is tested in `BoardViewport.test.tsx`: the Ctrl/Cmd
  keydown listener lives on `window` inside BoardViewport. (The design
  lists TC-18 under both the BoardViewport and ZoomControls test files.)

## Component-test environment quirks (handled in `tests/component/setup.ts`)

- **No `PointerEvent` in jsdom** — a minimal `PointerEvent` (over
  `MouseEvent`, adding `pointerId`/`pointerType`) is installed so
  Testing Library's pointer events carry `clientX/Y`/`button`.
- **No `requestAnimationFrame` without `pretendToBeVisual`** — a
  timer-based fallback is installed; under `vi.useFakeTimers()` the
  underlying `setTimeout` is faked, so tests advance 16ms in `act` to
  flush the coalesced camera update.
- **RTL `fireEvent` returns `dispatchEvent`'s boolean**, not the event;
  tests that assert `defaultPrevented` build the event with
  `createEvent` and dispatch it with `fireEvent`.
- **RTL auto-cleanup needs vitest globals** (off here), so `cleanup` runs
  in an explicit `afterEach`.

## Story 2 implementation decisions

- **Stable DOM render order — the drag-capture bug.** Rendering notes in
  snapshot (z, id) order means `bringToFront` mid-drag re-sorts the list
  and React reorders the DOM (remove + reinsert). In Chromium, moving a
  node that holds `setPointerCapture` releases the capture and fires
  `lostpointercapture`, killing the drag after its first move. Fix: the
  board renders notes in a **stable `(createdAt, id)` order**
  (`renderOrder` in `board-model.ts`); stacking is expressed purely by
  CSS `z-index: note.z`, which can change without touching DOM order.
  `snapshot()` still returns (z, id) order for the model and tests.
- **Unit-test Y.Text must be doc-bound.** `applyTextDiff` operates through
  `ytext.doc.transact`; a standalone `new Y.Text()` has no doc. The unit
  tests use a `makeYText(initial)` helper (`new Y.Doc()` +
  `doc.getText('text')`) so every level tests the real Y.Doc, and
  `applyTextDiff` keeps a null-doc guard (applies directly without a
  transact) as a defensive fallback.
- **Yjs delta shape.** The observed delta uses separate `{ delete: n }`
  chunks (not `{ retain: n, delete: true }`) and omits the unchanged
  trailing suffix; the test summarizer handles both forms.
- **Editor "outside" detection.** The textarea finds its own note root
  via `ta.closest('[data-sticky-note]')`; a pointerdown whose target is
  inside the own note (padding, swatches) stays in editing, while a click
  on any other note or the board ends editing as *unselected* (design
  sticky.edit_outside).
- **`finishDrag(flush)` semantics.** A clean `pointerup` cancels the
  pending rAF and flushes it, so the grabbed point ends exactly under the
  pointer (TC-31/TC-32). `pointercancel`/`lostpointercapture` do **not**
  flush — the note stays where it was last displayed (TC-37). The rAF is
  also cancelled in the unmount cleanup so a deleted note never leaves a
  stale drag id or a pending frame.
- **Drag math is origin-based.** The pending world position is
  `pointerdown origin + (pointer - origin) / zoom`, recomputed every move
  and applied at most once per rAF; it stays exact even if the camera
  zooms mid-drag because both terms use the live zoom.
- **E2E model hook.** `window.__vidi6.getObject(id)` returns
  `{x, y, z, color, text}` in test builds (absent from production), so
  e2e tests assert on the model (exact world deltas, z-order, colour,
  length-clamped text) rather than pixel-guessing.
- **TC-32 overlap geometry.** At 200% zoom the two notes' creation points
  are chosen so the second dblclick lands *outside* the first note's box
  (otherwise it edits instead of creating) while the boxes still overlap;
  the drag grabs the bottom note at a point not covered by the top one.
- **`longParagraph()`** produces exactly 1,000 characters of English prose
  (repeated sentence pool, sliced to length) so the auto-fit test crosses
  the 1,000-char limit and exercises the clamp + counter + fade.

## Story 2 test counts

- Unit: 40 (16 board-model + 11 sticky-text + 13 camera)
- Component: 32 (9 StickyNote + 4 StickyTextEditor + 3 Toolbars + 9
  BoardViewport + 5 ZoomControls + 2 NavigationHint + ...)
- E2E (Chromium): 11 (7 story-1 navigation + 4 story-2 sticky notes)

# Story 4: Return to a board and find everything as it was left — decisions

## Environment

- **Ports.** The shared e2e `wrangler dev` webServer keeps its slot (offset 1,
  29105). Each persistence test (TC-19/20/21) runs its OWN `wrangler dev` on its
  OWN port (offset 2/3/4 = 29106/29107/29108): distinct ports mean a lingering
  `workerd` from one test can never shadow another test's board (sharing one
  port was observed to make the next test's first WebSocket hang on a stale
  process). The TC-24 broken-board process runs on offset 5 (29109) and the
  production-hook-verification process on offset 6 (29110). Every port is
  built from `AGENT_PORT_FIRST` and asserted in-range
  (`tests/e2e/helpers/wrangler-process.ts`, like `vite.config.ts` and
  `playwright.config.ts`). `WranglerProcess.start()`/`stop()` drive the port
  to a known-free state (waiting, then `fuser -k <port>/tcp` for stragglers),
  and spawn `wrangler dev` detached so `stop()` kills the whole group
  (wrangler + workerd).
- **Cold-DO open is slow under e2e load.** The first WebSocket to a fresh room
  (cold Durable Object instantiation) can stay in CONNECTING for 10-25s when
  the e2e machine is loaded by prior tests. `NodeWsClient.connect` therefore
  budgets 60s for the open (not asserted, just generous), and TC-21 sets its
  own test timeout. This is environmental, not a bug: the identical sequence
  opens in ~1.5s in a standalone Node process.
- **E2E wrangler env (TC-24 damage hooks).** The TC-24 wrangler is started
  with `--var TEST_HOOKS:1`; the worker registers the `/__test/boards/:id/
  (corrupt-snapshot|repair)` routes ONLY when `env.TEST_HOOKS === '1'`, so the
  production-hook check (a *separate* wrangler with no such var) proves the
  routes are absent there (POST → 405 from the static-asset server, GET → the
  SPA `index.html`).
- **wrangler `--var` uses COLON-separated `KEY:VALUE`, not `KEY=VALUE`.**
  Verified in `wrangler-dist/cli.js` (`collectKeyValues` splits on `:`): with
  `--var TEST_HOOKS=1` the whole string `TEST_HOOKS=1` becomes the *key* with
  an empty value, so `env.TEST_HOOKS` is `undefined` and the hook routes never
  register (they fall through to ASSETS → 405). `--var TEST_HOOKS:1` sets
  `env.TEST_HOOKS === '1'` correctly. `WranglerProcess` formats every var as
  `${key}:${value}`.

## Implementation decisions

- **Where the pure functions live.** `chunkBytes` / `joinChunks` /
  `shouldCompact` (design: "in board-store.ts") and `nextRoomState` (design:
  "room-state.ts") live in `src/shared/storage-chunks.ts` and
  `src/shared/room-state.ts` because the root `tsconfig.json` *excludes*
  `src/worker` (its globals conflict with the DOM lib) and therefore unit
  tests can never import from `src/worker/*` under `npm run typecheck`.
  `src/worker/board-store.ts` re-exports the chunk helpers so the module
  boundary the design names is preserved.
- **Room-owned `meta.schemaVersion`.** The client no longer calls `initDoc`
  (removed from `useBoardDoc` and the `WsClient` fixture): the *room* applies
  it, under a dedicated `LOAD_ORIGIN`, after every successful load. Because
  `LOAD_ORIGIN` updates are never stored, a fresh board's first open stores
  no rows at all (TC-25), and the meta item can never be quarantined or
  re-broadcast as a client edit. `initDoc(doc, origin?)` gains an optional
  origin parameter for this.
- **Emulating room reconstruction.** workerd gives no API to force-evict a
  Durable Object mid-test, so "a new room instance on the same storage" is
  emulated by calling `BoardRoom.rebuildDoc()` inside
  `runInDurableObject`: it is the exact code path the constructor runs on
  every wake (fresh `Y.Doc`, update handler attached, state = loading,
  migrate + load from storage). The live instance stays the runtime's
  handler target, which matches what a post-eviction wake would do.
- **`BoardStore.storage` is public.** TC-14 (write failure) and TC-26 (SQL
  failure) wrap the store's `storage` (`{ sql, transactionSync }`) to inject
  failures deterministically; the room's write path treats a thrown `append`
  as "storage failed" without propagating the exception through Yjs's emit
  loop.
- **Corruption fixtures.** A truncated Yjs update (10 bytes off the end) and
  same-length random bytes are both rejected by `Y.applyUpdate`
  ("Unexpected end of array"); verified empirically (200/200 random
  same-length byte arrays rejected). The corrupt-snapshot hook overwrites
  chunk 0 with a deterministic LCG-derived byte string of the same length
  and keeps the original for `repair`.
- **Close codes.** `CLOSE_BOARD_LOAD_FAILED = 4500`: y-websocket 3.1.0 treats
  codes 4500-4499 as permanent, everything at/above 4500 as transient, so the
  client's provider reconnects with its normal backoff — that is exactly the
  "retry until repair, no reload" path TC-24 needs. `CLOSE_STORAGE_FAILURE =
  1011` (IETF "Internal Error") marks a write-failure room reset; the state
  mapping treats it like any transient loss (reconnecting, board editable).
- **Hibernation.** The room switches from its own `Set<WebSocket>` to
  `ctx.acceptWebSocket()` / `ctx.getWebSockets()`. The awareness relay
  (story 3) already counts as traffic on every accepted socket, which is what
  keeps idle-but-connected clients alive through hibernation.
- **Edit lock (TC-23).** `canEdit(state)` is exported from `App.tsx`
  (`state !== 'load_failed'`). App gates create (double-click + toolbar),
  color and delete callbacks; `Toolbar` gains a `disabled` prop; `StickyNote`
  gains an `editable` prop (selection still works; drag, edit and Enter are
  no-ops); `useStickyKeyboard` gains an `editable` option. The design's file
  table lists only App.tsx/ConnectionStatus/connectBoard, but drag and edit
  start live inside StickyNote, so the prop was added there as the mechanism.
- **TC-16 interval.** The test drives the retry clock directly instead of
  waiting the real 5 s: it corrupts the snapshot, pins the room to
  `load-failed` with a known fresh `lastLoadAttemptMs` (`t0`), and asserts a
  too-early connection is closed 4500 *with the clock still `t0`* (proof no
  reload was attempted). It then repairs the snapshot, pins the clock to
  `now - 10 min` (retry due), and asserts the next connection reloads the now
  healthy storage and syncs the 25 notes. The live room's public fields
  (`state`, `lastLoadAttemptMs`, `loadFailureReason`, `store`) are what make
  this deterministic.
- **Large-board seeding (TC-21).** A Node-side `NodeWsClient` (plain global
  `WebSocket`, mirroring the integration `WsClient` protocol) builds the
  `PERSIST_TESTED_NOTES`-note board locally and streams each note's update as
  its own frame, so the room's log really crosses the compaction threshold
  and the board is stored as a chunked snapshot (D1 = "Snapshotted"), not one
  giant log row.
- **`isolatedStorage: false`** (set in story 3) plus fresh random board ids
  per test keep the per-test-file SQLite push/pop safe; storage is shared
  across tests in a file but never across boards.
- **DO SQLite API in this environment is `exec`-based, not `prepare`-based.**
  workerd 1.20260310 (vitest pool) and 1.20261006 (root wrangler 4.148) both
  expose `storage.sql.exec(query, ...bindings)` returning a cursor
  (`toArray()`, `one()`, `next()`, `rowsRead/rowsWritten`); `sql.prepare`
  does not exist at runtime (verified in-worker). BLOBs bind as
  `Uint8Array` and come back as `ArrayBuffer` (wrap in `new Uint8Array`).
  `one()` throws on zero rows ("Expected exactly one result"), so first-row
  reads use `toArray()[0] ?? null`. Multi-statement `exec` works (migrate
  runs all four CREATE TABLEs in one call). `transactionSync` gives atomic
  rollback (TC-11 relies on it). The installed @cloudflare/workers-types
  (5.20261008.1) matches this shape but declares the statement class empty,
  so `BoardStore` defines a structural `BoardSql`/`BoardSqlCursor` interface
  and `fromStorage()` adapts the DO storage.
- **`fromStorage` must bind `transactionSync` to its original receiver.**
  Detaching the native method onto the wrapper object makes workerd throw
  "Illegal invocation" when the transaction runs.
- **Only store real deltas, not Yjs's empty update.** A no-op sync message
  (the per-connection handshake) still makes `Y.encodeStateAsUpdate(doc,
  before)` return a 2-byte `00 00` "empty" update, so gating persistence on
  `delta.byteLength > 0` stored two empty rows per connection. `BoardRoom`
  now compares the delta against a module-level `EMPTY_YJS_UPDATE` (the
  canonical empty encoding) and skips the store on a match. A state-vector
  comparison is *not* a valid gate: Yjs deletes are tombstones that do not
  change the per-client clocks, so `encodeStateVector` is unchanged by a
  delete and the comparison would silently skip storing real deletions
  (this broke story 3's TC-11/TC-12 when first tried).
- **`reload()` is the room's wake path (renamed from `rebuildDoc`).** It is
  `async` and *awaited*: `onSocketOpen` awaits it before deciding whether to
  sync or close the new socket, so no handler ever sees a half-loaded room.
  The constructor cannot await, so it runs `void this.ctx.blockConcurrencyWhile(
  () => this.loadBoard())`; `blockConcurrencyWhile` must be handed a
  `() => Promise<T>` callback, not a `() => void` one.
- **Self-initiated `ws.close()` does not surface a client-side `close`
  event in the vitest-pool-workers harness** (verified: after `client.close()`,
  `client.closed` stays `false` and `closeCode` stays `null`). Server-initiated
  closes (4500/1011/1003) *do* fire the event. Integration tests therefore
  never `waitForClose()` after a self-close; they give the room a short delay
  to hibernate and rely on the next connection's wake path instead.
- **Yjs item-chain cascade (shapes TC-09).** Silently dropping any update
  that creates items referenced by later updates makes Yjs drop every
  affected later note without throwing (verified: skipping the 4th note's
  create update leaves only 3 of 25 notes). The only rows safe to damage
  for the design's "exactly one row lost, all other notes present"
  capability are rows with no structural successors — the last row of the
  log. TC-09 therefore damages row 53 (the retro board's final stacking
  z-set), not the design's illustrative "row 7" (that number was chosen
  before the Yjs layout was known; the capability is identical).
- **Truncation partially applies multi-message updates.** A Yjs update
  byte string is a sequence of messages; `applyUpdate` integrates complete
  prefix messages before throwing on the truncated tail (verified: the
  truncated final z-set update still set z=28 while throwing). Same-length
  scrambling is rejected wholesale, so TC-09 uses the `scrambleUpdate`
  fixture; `truncateUpdate` remains available (the design's fixture list
  covers both for TC-09/TC-10).
- **Fixture update counts.** `buildRetroBoard` = 53 updates (25 × create +
  25 × text + 3 × bringToFront); `buildLargeBoard` = 4000 updates. The
  retro board's stacked trio (notes 22–24 at one centre) ends at z 26/27/28
  in the source doc.
- **Client load-failure close-code mapping.** y-websocket emits
  `connection-close` (with the `CloseEvent`) on *every* socket close, before
  the `status: disconnected` event; `null` for a local close. Only close code
  `CLOSE_BOARD_LOAD_FAILED` (4500) maps to `load_failed` (red badge, editing
  locked out). Every other code — storage failure 1011, garbage update 1003,
  transient 44xx, normal 1000/1001 — is handled by the `status` event
  (`reconnecting`) and never locks the board (persist.save_failure / TC-28).
  y-websocket's default `shouldReconnect` keeps 4500/1011/1003 transient
  (retries with backoff), so a `load_failed` board recovers to `connected`
  (no page reload) on the first successful sync — `tryLive` treats
  `load_failed` like the initial `connecting` (→ `connected`, not `confirmed`).
- **`canEdit` lives in `App.tsx`** (per the design contract): a pure
  `(state) => state !== 'load_failed'`, exported for the component tests.
  `App` and the `renderStickyBoard` harness both compute `editable =
  canEdit(connectionState)` and gate create/drag/edit/colour/delete (and
  disable the Sticky + note-toolbar buttons). `useStickyKeyboard` takes an
  `editable` flag so Enter-to-edit / Delete-to-delete are no-ops when locked.

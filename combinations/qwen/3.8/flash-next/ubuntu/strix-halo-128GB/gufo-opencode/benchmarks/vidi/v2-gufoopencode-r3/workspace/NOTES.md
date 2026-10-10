# Notes

Decisions and deviations for story 1 (Pan and zoom around an infinite board).

## Architecture
- Camera state lives in a `useCamera` hook (`src/client/canvas/useCamera.ts`) owned by
  `App.tsx` and shared through `BoardCameraContext`, so `ZoomControls` and the
  navigation hint can drive/observe the same camera as `BoardViewport`.
- All camera mutations funnel through pure functions in `src/client/canvas/camera.ts`
  (zoom-at-point, pan, clamp, reset) which are unit-tested without a DOM.
- Camera commits are coalesced with `requestAnimationFrame`, so one drag gesture
  produces at most one React render per frame.
- Named settings (`ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP_FACTOR`, `WHEEL_ZOOM_SENSITIVITY`,
  `GRID_SPACING_WORLD`, `UNBOUNDED_PAN_TESTED_EXTENT`) live in `src/shared/config.ts`
  and are imported by both app code and tests.
- The dot grid is CSS `radial-gradient` background on the viewport with
  `background-position: mod(-camera.x * zoom, spacing)`; this keeps grid spacing exact
  and jitter-free at world coordinates up to ±1,000,000 (TC-27).
- Pointer Events are used for panning with `setPointerCapture` (guarded, since jsdom
  lacks it). Ctrl/Cmd + wheel zooms around the cursor with `preventDefault` so the
  browser page never zooms (TC-31 asserts `visualViewport.scale` / dpr stay constant).
  Keyboard: +/-/0 zoom at viewport centre; arrows/space pan.
- A `data-testid="origin-marker"` world-space element gives tests a measurable point
  (present in all builds; only the `window.__vidi6` camera-set hook is gated behind
  `import.meta.env.MODE === 'test'` via `src/client/canvas/testHooks.ts`).

## Testing deviations / environment
- jsdom has no `PointerEvent`, so `tests/component/setup.ts` shims it as a `MouseEvent`
  subclass (clientX/clientY/button/pointerId survive like in real browsers). Handlers
  and assertions are otherwise unmodified.
- E2E servers: Playwright's `webServer` runs `wrangler dev` (Cloudflare Pages static
  assets from `dist/client`) on port 22704 (inspector 22705) per the allowed-port
  rules; `npm run test:e2e` builds with `vite build --mode test` first.
- Browser matrix: the config defines chromium, firefox and webkit projects, but probes
  each binary (`executablePath` + `--version`) at config load and skips unusable ones
  with a warning. On this machine only the cached Chromium build works: Firefox/WebKit
  downloads fail host-dependency validation and there is no sudo to run
  `npx playwright install-deps`. All 8 e2e tests pass in Chromium (rules: Chromium
  success suffices); Firefox/WebKit run automatically wherever their binaries exist.
- TC-25 loop tolerates the "+" button disabling between the `isDisabled()` check and
  the `click()` (Playwright actionability would otherwise hang).

---

# Story 2: Capture ideas on sticky notes and rearrange them

## Architecture
- The Yjs document schema and all mutations live in `src/shared/board-model.ts`
  (`objects: Y.Map` of sticky `Y.Map`s with `type,x,y,color,z,createdAt` and a
  `Y.Text` per note; `initDoc`, `createSticky`, `moveObject`, `setStickyColor`,
  `deleteObject`, `bringToFront`, `snapshot`). All mutations wrap writes in
  `doc.transact()` with `LOCAL_ORIGIN`.
- `useBoardDoc` (`src/client/board/useBoardDoc.ts`) owns the single local
  `Y.Doc`, subscribes with `observeDeep` on `objects` and exposes an
  immutable snapshot through `useSyncExternalStore`. Selection and editing
  (`useSelection`) are per-client React state, never stored in the doc.
- `StickyNote` drag: pointerdown arms the interaction; movement begins at
  `DRAG_THRESHOLD_PX` (screen px) with `bringToFront`; positions are written
  through a `requestAnimationFrame` pump (one `moveObject` per frame, latest
  position wins). On release the pending position is flushed synchronously
  (otherwise a down→move→up inside one frame would drop the final move);
  `pointercancel` instead freezes at the last applied position (TC-21).
  Deltas are divided by camera zoom so the grabbed point stays under the
  pointer (TC-31/32).
- Text editing uses a plain `<textarea>` overlay diffed into the `Y.Text` on
  every `input` event via `applyTextDiff` (minimal common prefix/suffix
  insert/delete; surrogate-pair boundaries are never split), so ending
  editing never needs an extra write and story-3 CRDT typing stays safe.
  IME composition is skipped until `compositionend`. Inputs are clamped to
  `STICKY_TEXT_MAX_CHARS` inside the editor.
- Auto-fit font size: a hidden measure div (same font/line-height, wrapped
  to the text box width) is stepped from `STICKY_FONT_MAX_PX` down to
  `STICKY_FONT_MIN_PX`; if even the minimum overflows, a fade class
  (`sticky-note--overflow::after`) marks clipped text.
- Toolbars: left `Toolbar` has the Sticky note button (creates at viewport
  centre, zoom-aware); the floating `NoteToolbar` (screen-space, anchored
  above the selected note) offers 6 colour swatches + delete, and hides
  while dragging or editing. Keyboard: Enter edits the selected note,
  Delete/Backspace delete it (both no-ops while a text field has focus or
  while editing, so TC-26's backspace-while-typing only deletes a character).

## Contract deviations / decisions
- `createSticky` with non-finite coordinates throws `TypeError` instead of
  returning `false`: the design contract types its return as `string`, so a
  `false` is unrepresentable; throwing is the only loud option and user
  input can never produce non-finite points (TC-39 covers the sibling
  `moveObject`, which does return `false`).
- `setStickyColor` returns `false` when the colour is unchanged (contract:
  "true if changes applied"); the doc gets 0 updates in that case.
- `useSelection` exposes two extras beyond the design contract:
  `draggingId` + `setDragging`, purely to hide the note toolbar while
  dragging (local-only, never in the doc). `StickyNote` therefore takes an
  optional `onDraggingChange` prop.
- `StickyTextEditor` detects outside clicks with a `pointerdown` listener on
  `window` in capture phase, because note/toolbar `stopPropagation` would
  otherwise hide board clicks from it.
- `App` accepts an optional `doc` prop and `useBoardDoc(provided?)` a doc, so
  component tests can create fixtures and assert model state directly.
  `window.__vidi6` gained `getNotes()` (test-mode only, like `setCamera`),
  and `StickyNote` renders `data-id` for e2e targeting.
- `EndEditNext` is exported from `src/client/objects/StickyText.ts`.
- Notes are centred on the creation point: stored `x,y = point −
  STICKY_SIZE_WORLD/2` (per design); tests account for it.

## Testing notes
- jsdom lacks `ResizeObserver`/pointer capture; both are feature-guarded with
  fallbacks (window resize listener; plain event flow).
- `tests/e2e/sticky.spec.ts` (TC-30–34) uses `window.__vidi6.setCamera` to
  jump to 50%/200% zoom or far-away pan instead of gestureing thousands of
  pixels; long-text paste goes through the native textarea value setter so
  React's `onInput` commits it.
- E2E runs Chromium-only here (same environment constraint as story 1).

---

# Story 3: See other people's edits appear live on the same board

## Architecture
- `BoardRoom` Durable Object (`src/worker/board-room.ts`): non-hibernating
  `accept()` (the Y.Doc lives in memory); sends SyncStep1 on open, relays
  every applied doc update to the other sockets with
  `syncProtocol.writeUpdate` framing (raw `frame(MESSAGE_SYNC, update)`
  breaks clients: update bytes get parsed as sync messages). Awareness
  messages are relayed verbatim; anything the decoder/sync layer rejects
  closes with 1003.
- The Worker entry (`src/worker/index.ts`) routes `/api/rooms/:boardId` to
  the DO stub (`getBoardRoom(getRoomId(env, boardId))`) and falls through to
  static assets. Board id validation (`src/shared/board-id.ts`) rejects
  ids that would break URL/DO-name encoding.
- Client: `connectBoard(doc, boardId)` (`src/client/sync/connectBoard.ts`)
  wires a y-websocket `WebsocketProvider` to a pure state machine
  (`createSyncStatusMachine`) exposed through `useBoardDoc`. States:
  connecting → connected; after a first sync an outage shows reconnecting,
  and reconnect needs `CONNECTED_CONFIRMATION_MS` (2 s) of confirmed sync
  before the badge flips to Connected, then hides.
- Provider sync event is `'sync'` (not `'synced'`) in y-websocket 3.x.
- `/b/:boardId` is handled client-side (`resolveBoardId` in `App.tsx`);
  wrangler dev rewrites unknown paths to index.html via SPA fallback.

## Gotchas (cost hours)
- **workerd delivers WS frames as `Blob`, not `ArrayBuffer`.** `event.data`
  in `fetch`-based DO websockets under current workerd is a Blob; the
  protocol decoder must `await blob.arrayBuffer()` (and also accept
  ArrayBufferView for the Node/vitest path). Without this every message
  decoded as invalid → 1003 close loops.
- `Y.Doc.toJSON()` only serialises shared types **already instantiated** via
  `doc.getMap(...)` etc. A doc that received updates but never called
  `getMap('objects')` returns `{}` even though the data is applied. Always
  instantiate the root map before snapshotting (`snapshot()` in the board
  model does this).
- `setOffline(true)` does **not** close established WebSockets in Chromium;
  outage detection relies on y-websocket's 30 s "no message received"
  watchdog, so e2e outage tests budget ~35 s for the Reconnecting badge.
- Room badge locator must be `.connection-status`, not
  `getByRole('status')`: the zoom label `<output>` has implicit
  role=status and makes strict-mode locators ambiguous.

## Testing notes
- Integration project (`vitest-pool-workers` 0.12.0) uses
  `isolatedStorage: false`: live DO websockets keep storage busy so the
  per-test storage snapshot restore cannot work; tests use random board
  ids instead. `testTimeout: 30_000` for DO startup.
- `tests/integration/ws-client.ts` is a tiny y-protocol client (Node `ws`)
  used by the workerd tests; `random-ops.ts` drives merge scenarios.
- E2E helpers (`tests/e2e/helpers/participants.ts`): `openParticipants`
  opens N isolated contexts on one board id, `waitForSynced` gates on the
  `connectionState()` test hook, `LatencyRecorder` measures peer-visibility
  latency per change and logs p50/p95/max against
  `LIVE_UPDATE_LATENCY_BUDGET_MS` (reported, asserted only for the
  functional TC-22..28 single-change waits).
- Nightly (`npm run test:e2e:nightly`, @nightly grep): TC-29 five idle
  clients for 45 s (badge must never appear; awareness relay keeps the
  watchdog fed), TC-30 five seeded random editors for 60 s asserting
  convergence of every change (exact deltas are not asserted because a
  drag may grab an overlapping note; convergence is the contract).
- Observed latency on this machine: p50 ≈ 6–18 ms, p95 ≈ 9–53 ms,
  worst single sample 114 ms — far under the 1 s budget.

# Story 4: Return to a board and find everything as it was left

## Architecture
- Persistence lives in `BoardStore` (`src/worker/board-store.ts`): a
  `updates` log (one raw Yjs update per row), a chunked `snapshot_chunks`
  table (512 KiB chunks so no row exceeds the DO per-row BLOB limit), a
  `quarantined_updates` table, and `storage_meta` for the schema version and
  `snapshot_through_seq`. Compaction encodes the room doc
  (`Y.encodeStateAsUpdate`), rewrites the chunks, deletes rows
  `seq <= maxSeq` and bumps the meta key — all inside one
  `transactionSync`, so a failure rolls back to the previous snapshot+log.
- `BoardRoom` loads in `state.blockConcurrencyWhile` before accepting
  sockets, stores every update synchronously before broadcasting (the DO
  output gate keeps ordering durable), and uses the Hibernation API
  (`ctx.acceptWebSocket` / `getWebSockets(tag)`) so idle rooms release
  memory. Room lifecycle is a pure function in `src/worker/room-state.ts`
  (`nextRoomState`); the room exposes it via `debugState()`.
- Failure model: log-row damage → quarantine + clock-gap GC fill → board
  loads minus the damaged change (`persist.partial_damage`). Damaged
  snapshot or SQL failure → close 4500 (`CLOSE_BOARD_LOAD_FAILED`) and do
  not serve an empty board; a retry is throttled to
  `LOAD_RETRY_MIN_INTERVAL_MS`. Any storage write failure → close 1011
  (`CLOSE_STORAGE_FAILURE`), state `storage-failed`.
- Test hooks (`TEST_HOOKS=1` env, never set in wrangler.jsonc):
  `POST /__test/boards/:id/(corrupt-snapshot|repair|compact)` plus DO RPC
  `testCompact/testCorruptSnapshot/testRepairSnapshot`, and the always-on
  `debugState/debugStore/debugSetStore/debugReload` seams.

## Gotchas (cost hours)
- `@cloudflare/workers-types` `SqlStorageCursor` has `next()`/`toArray()`,
  NOT `all()`/`first()`; use a `firstRow(cursor)` helper.
- Yjs defers every update that starts past the stored clock of a client
  into `store.pendingStructs.missing` — silently, with no throw. So after
  quarantining a damaged row, later rows from the same writer are applied
  as no-ops ("applied" without error but content missing). The fix is
  `fillClockGaps`: read the V1 header `[numClients][numStructs][client]
  [startClock]...` (no state-vector prefix!) of the next row, and before
  each `applyUpdate` hand-insert GC structs (`info` byte 0, empty delete
  set) covering `[storedClock, startClock)` per client. On intact streams
  start === stored clock, so this is a no-op; on a damaged log it closes
  the hole so everything after the damage still applies. Do not trust
  `Y.encodeStateVectorFromUpdate` for partial updates — it parses the
  whole update and throws on truncation.
- `lib0/encoding` exports `writeUint8` (not `writeVarUint8`).
- Y.Text is `insert(index, text)`, there is no `insertText`.
- `TEST_HOOKS` must be passed to `wrangler dev` via `--var TEST_HOOKS:1` on
  the command line; wrangler does NOT forward arbitrary process env vars to
  the worker. The e2e `startWrangler({ testHooks })` helper adds the flag.
- A hand-rolled sync client (the e2e `seed-client.ts`) must prefix every
  reply produced by `syncProtocol.readSyncMessage` with the `MESSAGE_SYNC`
  (0) frame byte before sending. That encoder holds only the bare sync
  sub-message; without the prefix the room's `decodeMessage` reads the
  sub-message type (e.g. SyncStep2=1) as the protocol byte and treats it as
  awareness, silently dropping it. Symptom: the room's `Y.Doc` gets child
  Item structs whose `initDoc` parent it never received, so they pile up in
  `store.pendingStructs` and never integrate (no `update` event, nothing
  stored). The working `ws-client.ts` re-prefixes; mirror it.
- "Seen is saved" is per-PEER. The creating browser's local `Y.Doc` updates
  instantly on `createSticky`, long before the room has received and
  appended it over the socket. TC-19/TC-24 therefore poll the ROOM
  (`readNoteCount`, a fresh client reconstructing from the room) to 25
  before any hard process kill; polling only the creator's own view races
  and loses in-flight notes.
- Client `load_failed` is driven by the provider's `connection-close` event
  (close code 4500), NOT by `status:disconnected`; the machine latches
  `load_failed` and ignores subsequent `connecting`/`disconnected` until a
  successful `sync` (no page reload). Codes 1011/1003 map to `reconnecting`
  so a readable board is never locked. Editing is gated by `canEdit` in
  `App.tsx` (false only for `load_failed`): double-click, the Sticky note
  button (`disabled`), note drag/edit, and the Delete key are all inert.
  For TC-23 component tests, `App` is mounted with an injected doc (offline,
  `connection: null`) and `useConnectionStatus` is `vi.mock`-stubbed to a
  mutable holder; the mutation-free assertions check the real `Y.Doc` object
  count, not spies.

## Story 5: Share a board with others using a link

- Boards are now created explicitly (`POST /api/boards` returns a
  server-generated 22-char id) instead of implicitly on first WebSocket
  connect. `BoardRoom.fetch()` 404s an unknown/invalid id before upgrading,
  and `BoardStore.load()` never creates tables, so probing an unknown board
  writes nothing. Existence is `storage_meta.created_at` OR any legacy row in
  `updates`/`snapshot_chunks` (`existsReadOnly`), which keeps pre-story-5
  boards openable (TC-08/TC-31).
- The old `App.tsx` board UI moved to `src/client/pages/BoardPage.tsx` as
  `BoardView({ doc?, boardId? })` (`canEdit` now lives there). `App.tsx` is a
  thin router host over `useRoute()`: `/` Home, `/b/:id` Board, else not
  found. Component tests render `BoardView`, not `App`.
- `BoardPage` is a pure state machine (`nextBoardPageState`): malformed id →
  not found with no request; unknown → not found; unreachable → retry with
  base `BOARD_CHECK_RETRY_BASE_MS` doubling, capped at
  `RECONNECT_MAX_BACKOFF_MS`. The board UI mounts only once the board is
  known to exist, so a share link never flashes an empty board.
- The Share panel copies `${origin}/b/<id>` via `navigator.clipboard.writeText`
  when present, and falls back to selecting the read-only link with a manual
  "Press Ctrl+C…" hint when the API is missing or the write rejects.
- e2e helpers: `openParticipants` creates one board via `POST /api/boards`
  before any context opens it; navigation/sticky specs use `openBoard(page)`.
  The persistence specs (their own wrangler instances) now call the
  `__test/…/initialize` hook to create the chosen board id and run with
  `TEST_HOOKS` on. TC-31 seeds a legacy board via `__test/…/seed-legacy`
  (updates rows, no created_at) and opens it.

- ENVIRONMENT LIMITATION: TC-27 and TC-29 are also specified for Firefox and
  WebKit, but neither browser can launch on this machine — `firefox --version`
  fails with an XPCOM/libmozgtk load error (missing GTK) and the WebKit
  launcher (`pw_run.sh`) is absent. `playwright.config.ts` auto-detects this
  and runs the chromium project only. All story-5 e2e (TC-26 to TC-29, TC-31)
  pass in Chromium here; the cross-browser run is not possible on this box and
  is treated as satisfied to the environment's limit.

## Story 7 decisions (selection, transform, marquee, keyboard)

- Generic object pipeline: `board-model.ts` gains `ObjectSnapshot`/`snapshotAll`
  plus group ops (`moveObjects`, `resizeObjects`, `deleteObjects`,
  `bringObjectsToFront`, `objectsInRect`, `allObjectIds`); story 2 single-object
  functions are thin wrappers. Unknown types are skipped (invisible,
  unselectable). Geometry lives in `src/shared/geometry.ts` (resizeRect,
  clampScale, scaleWithin, rectContains, unionRects, normalizeRect).
- Type registry `src/client/objects/registry.tsx`: `ObjectTypeSpec`
  (Component, resizable, aspectLocked, minSize, editableText, hitTest).
  Duplicate registration throws. Sticky registers with aspectLocked true and
  minSize STICKY_MIN_SIZE_WORLD. Tests use a second type (`testbox`) from
  `tests/fixtures/testbox.tsx` to prove generality.
- `useSelection` is a pure reducer (click/toggle/setMany/clear/prune/edit/
  endEdit) with a presence mirror; stale-id actions are ignored, except `edit`
  (createSticky + startEdit dispatch in the same tick, before the prune
  effect). A setMany batch whose ids are ALL gone is ignored; partial batches
  apply with survivors.
- Transform: `useTransformGesture` attaches window-level pointer listeners at
  pointerdown; writes are rAF-throttled (≤1 transaction/frame) and end with a
  flush on pointerup. pointercancel freezes at the last applied state.
  Shift+click toggles without starting a gesture. canEdit=false refuses
  gestures entirely.
- Marquee: shift+drag on empty space, rect stored in WORLD coordinates
  (camera captured at pointerdown, so mid-drag zoom is harmless). End applies
  setMany(ids, additive); an empty hit-set leaves the selection unchanged.
  Escape cancels via a capture-phase window listener that
  stopImmediatePropagations so the board Escape-clear cannot also fire.
- Keyboard (`useBoardKeys`, replaces useStickyNoteKeys): Ctrl/Cmd+A select
  all (preventDefault), Escape clear, arrows nudge (Shift = large step, always
  preventDefault while selected → no page scroll / board pan), Delete/
  Backspace delete selection, Enter edits a single editable-text object.
  Inert while editing text or focused in a text entry.
- Resize gestures: edge handles change one axis; corner handles both; aspect
  lock (sticky or Shift) keeps the ratio from the moving axes; the first
  object to hit min/max clamps the whole selection uniformly.
- Test notes: component tests must advance fake timers (React scheduler)
  after keyboard `fireEvent` before asserting rendered state; raw
  `KeyboardEvent`s need `cancelable: true` to observe preventDefault.
- e2e: `getNotes` now reports width/height (resize assertions). Single-page
  specs use `openBoard(page)` (the `/` route is not a board since story 5).

---

# Story 8: Undo and redo my own changes without undoing anyone else's

## Architecture
- `createUndo(doc, opts)` (`src/client/board/undo.ts`) wraps a Yjs
  `UndoManager` scoped to the `objects` map with
  `trackedOrigins: new Set([LOCAL_ORIGIN])`, so remote provider updates and the
  story-4 load update never enter the stacks and can never be undone from a tab.
  The controller exposes `undo/redo` (boolean: false when nothing was undone),
  `boundary()` (→ `stopCapturing`), `canUndo/canRedo`, `addScope` (story 16),
  `onChange` and `destroy`.
- History trimming uses the `stack-item-added` event (not yjs `limit`, which is
  deprecated), shifting the undo stack down to `UNDO_MAX_STEPS`; `captureTimeout`
  and the step cap come from named settings `UNDO_CAPTURE_TIMEOUT_MS` /
  `UNDO_MAX_STEPS` in `src/shared/config.ts`.
- Step boundaries are explicit `boundary()` calls so a gesture or a typing
  session is exactly one step regardless of frame count: `useTransformGesture`
  start/end (and the z-raise is now issued *after* `onGestureStart` so the raise
  shares the move step), toolbar create, note-toolbar colour/delete, key delete
  /nudge, and `StickyTextEditor` mount/unmount.

## Deviations from design.md
- The design names `App.tsx` as the controller owner, but since story 5
  `App.tsx` is a thin router; the controller is created in `BoardPage.tsx`
  inside the view that owns the `Y.Doc` (one controller per doc, recreated and
  `destroy`ed with it). Same intent, correct home.
- `ObjectProps` (`src/client/objects/registry.tsx`) gained an optional `undo?:
  UndoController` so the controller reaches `StickyTextEditor` (which intercepts
  Ctrl+Z while editing and syncs external/undo writes via `ytext.observe`). The
  design did not list this prop; it is the minimal way to thread the controller.
- `addScope` takes a local `UndoScope = Y.AbstractType<any> | Y.Doc` alias:
  the design's `AbstractType<unknown>` is contravariant and rejects concrete
  `YMap<unknown>` callers.
- `LOAD_ORIGIN` stays in `src/worker/board-store.ts`. Importing it into a unit
  test would drag Cloudflare worker types into the client `tsconfig` program, so
  `tests/unit/peer.ts` uses a local stand-in symbol; the real origin path is
  covered by e2e TC-24-style load tests.

## Testing notes
- yjs is externalised as CJS in vitest, so `vi.mock('lib0/time')` never intercepts
  the clock inside `node_modules`. The capture-timeout tests drive a `globalThis`
  clock seam installed once per worker via the unit project's `setupFiles`
  (`tests/unit/setup-clock.ts`), toggled per test in `undo-boundaries.test.ts`.
- Confirmed empirically (scratch yjs probe) that `UndoManager.undo()` returns the
  popped `StackItem` (truthy) or `null`, and *skips* steps whose inverse has no
  effect (e.g. moving a note later deleted by a peer) until it finds one that
  actually applies; a move-only stack + remote delete therefore undoes nothing and
  empties the stack (TC-23's clean no-op).
- Browser matrix unchanged: only Chromium binaries are available here; all e2e
  (37 tests incl. TC-22/23/24) pass in Chromium.

## Story 9 decisions (free text anywhere)
- Identity placeholder: `src/client/identity.ts` exports
  `export const identity = { id: crypto.randomUUID() };`. Story 6 (who is
  editing) is not implemented, so `createdBy` on text objects records a stable
  per-session UUID; replace this module when story 6 lands.
- Auto-width layout caps at `TEXT_MAX_AUTO_WIDTH_WORLD` (600): measured text
  wider than the cap wraps at the cap; height is always `lines × fontPx ×
  TEXT_LINE_HEIGHT`. Fixed width clamps to `TEXT_MIN_WIDTH_WORLD` (40).
- `createCanvasMeasurer()` uses a 2D canvas when available and falls back to a
  deterministic estimator (`length × fontPx × 0.5`) otherwise (jsdom has no
  canvas). The fallback only affects box height/width, never content.
- Box writes are local-only (`useTextBoxSync`): remote transactions never
  trigger remeasure, so peers cannot fight over a text box; the box is
  recomputed independently from the same shared text on each client.
- Text is invisible to `hitTest` only when empty *and* not selected; the object
  is deleted on Escape (`deleteIfEmpty`) inside the same undo capture window as
  ending the edit, so empty text can never be committed (TC-20, TC-31).
- Resize handles for text are `e`/`w` only (`handles: 'horizontal'` in the
  type spec). Single-text horizontal drag switches the box to fixed width
  without touching x/y; in mixed selections texts reposition proportionally
  (`scaleWithin`) and font size never changes.
- Browser matrix unchanged: only Chromium binaries are installed here, so
  "TC-26 also in firefox/webkit" is not runnable on this machine; the layout
  assertions use ±2 world units tolerance to absorb font differences.
- Known pre-existing flake: e2e navigation TC-27 (1,000,000-unit grid pan)
  intermittently fails under default parallel workers (camera applied while
  the page still shows "Connecting…", pan error 8px vs ≤1). Reproduced
  identically at story 8 HEAD (`0ac096b`), so it is environmental, not a
  story 9 regression. Passes reliably alone and with `--workers=1`
  (full suite 43/43 green that way).

## Story 10 decisions (shapes and connectors)
- `resolveRect` contract nuance: a *provided* non-finite rect returns `null`
  (caller contract error, no silent fallback); a `null` rect falls back to a
  default square centred on `at`, and `at` non-finite also returns `null`.
- `useActiveTool.ts` replaces `useTool.ts` (old file kept but unused):
  `ACTIVATABLE` tools + `TOOL_SHORTCUTS` (v/n/t/s/l/p/i/c). 'n' is mapped but
  never activated from keydown because `useBoardKeys` owns sticky creation;
  Escape returns to Select; `toolCreated(id)` selects the new object and
  returns to Select in one dispatch batch.
- `useSelection` gained `selectNew` (same bypass-presence semantics as `edit`)
  so create+select land in the same tick before the prune effect runs.
- BoardPage `onToolCreated` wraps the select in `boundary()` calls so create
  and select are one undo step (the create itself is the captured write).
- Connectors store x/y/width/height as 0; `snapshotAll` overrides with the
  bbox derived from `collectConnectorBBoxes` so selection/visibility math is
  uniform. `hitTest` gained an optional `ctx { doc, zoom }` third argument
  used only by the connector entry (proximity to the resolved polyline,
  `CONNECTOR_HIT_TOLERANCE_PX / zoom`).
- Releasing a handle over the object at the *other* end snaps back (no write)
  rather than detaching: the target finder is run unfiltered at release and
  compared against `otherObjectId` (ConnectorObject.tsx).
- `board-model.ts` <-> `objects/connector.ts` is a deliberate circular import
  (deleteObjects -> detachConnectorsTo): safe under ESM live bindings since
  both sides only call inside function bodies.
- Component test file is `tests/component/ShapeConnector.test.tsx` (design
  suggested two files, `ShapeTool.test.tsx` + `Connector.test.tsx`; one file
  with the same TC coverage was chosen to share mount helpers).
- Fixture: `tests/fixtures/shapes-board.ts` builds the design's checkout-flow
  board (4 labelled shapes: rect, diamond, ellipse, rect; 3 attached
  connectors; 1 free-ended connector) with real model calls; smoke-tested in
  `tests/unit/fixture-shapes.test.ts`.
- TC-25 e2e drags B *fully* past A (centre beyond A's far side): with partial
  overlap `nearestSide` keeps the original sides (the arrow still points at
  the nearest edges), so a side switch only happens once B is entirely on the
  other side.
- TC-27 race is built with `page.routeWebSocket('**/api/rooms**')`: page→
  server frames keep flowing, and after the initial sync every server→Dana
  frame is buffered; Sam deletes B, Dana (blind) re-attaches her free end to
  the vanished B, then the held frames are released. Asserts: arrow renders,
  end resolves to a finite fallback / is detached, and zero `pageerror`s.
  Playwright's route API uses `onMessage` on the server-side route (not
  `onMessageFromServer`).
- The in-editor `scrollHeight` wrap check was dropped for TC-24: the shared
  `TextEditor` auto-grows its height, so wrapping is asserted on the committed
  `.shape-label` (Range client-rects line count > 1) plus the centring
  invariant before/after handle resize.
- jsdom has no `setPointerCapture`; ShapeTool/ConnectorTool wrap it in
  try/catch like BoardViewport already does.
- Browser matrix unchanged: only Chromium binaries are available on this
  machine, so the story-10 e2e (TC-23..27) run in Chromium.

## Story 11 decisions (pen sketching)

- Pen stays active after committing a stroke (no `onToolCreated` handback like
  Shape/Text). BoardPage wires PenTool's `onCommitted` to
  `undoController.boundary()` so each stroke is its own undo step.
- StrokeObject renders a root `<svg pointerEvents="none">` (no div wrapper)
  with two paths: the visible smoothed line (`pointer-events: none`) and a
  wide transparent hit path (`pointer-events="stroke"`). Blink refuses hit
  targets on SVG descendants that re-enable pointer events through an HTML
  ancestor with `pointer-events: none`, so `.board-world` no longer sets
  `pointer-events: none`. The layer is a 0x0 box (cannot capture events
  itself) and every child controls its own hit behaviour; `.board-origin-marker`
  gained explicit `pointer-events: none` (it previously relied on the removed
  inheritance, which broke sticky double-click-at-origin tests).
- Connectors still keep a hit path under a `pointer-events: none` root div and
  are therefore only selectable via their endpoint handles (pre-existing
  behaviour, unchanged).
- `smoothPath` (midpoint quadratic chains) passes through the MIDPOINTS of
  consecutive points, not the points themselves; e2e clicks/drags on the line
  target `mid(p[i], p[i+1])`, which is exactly on the curve.
- TC-19: after a sticky creation flow the note stays selected and the
  floating note toolbar covers the board, stealing the wheel event; the test
  deselects (V + click empty) before wheel-panning. PenTool forwards native
  (non-passive) wheel/pinch to `useBoardCamera()` while active.
- Split commits: reaching `STROKE_MAX_POINTS` flushes the part and the next
  part starts at the previous part's last world point (shared anchor), so the
  joined polyline is continuous (TC-12).
- A zero-movement click commits a 2-point dot (padded to `thickness` so the
  bbox is non-degenerate).
- Registry hit test for strokes: `distanceToPolyline` against scaled points
  with tolerance `max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom)`; clicks
  inside the bbox but far from the line fall through to objects below.
- `window.__vidi6.getStrokes()` returns stroke snapshots plus current scaled
  world points; `tests/e2e/helpers/board.ts` exposes `getStrokes(page)`.
- Component tests live in two files (`PenTool.test.tsx`,
  `StrokeObject.test.tsx`); jsdom lacks `setPointerCapture`, PenTool wraps it
  in try/catch like BoardViewport.
- Browser matrix unchanged: only Chromium binaries are available, so the
  story-11 e2e (TC-17..20) runs in Chromium.

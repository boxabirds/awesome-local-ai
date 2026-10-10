# Notes

Decisions and environment facts for this build.

## Task 1 — scaffold

- Versions installed: React 19, Vite 8, TypeScript 7, Vitest 5 (with `unit` /
  `component` projects), Playwright 1.64, Wrangler 4.
- `npm run test:unit` / `npm run test:component` run the matching Vitest project;
  `npm run test:e2e` runs Playwright against `wrangler dev` serving the test build.
- Ports: only ports 24064-24079 are usable in this environment, so
  `wrangler dev` (e2e/preview) uses 24064 with inspector port 24065 and the Vite
  dev server uses 24066. Override with `VIDI6_E2E_PORT` for e2e.
- E2E builds the client with `vite build --mode test` so
  `window.__vidi6.setCamera()` (far-travel test hook) exists; the production
  `npm run build` omits it (`import.meta.env.MODE` is statically replaced).

## Playwright browsers (environment limitation)

- This sandbox has **no Playwright browser binaries** and no system Chrome/Firefox:
  `google-chrome` is a broken symlink, `firefox` is an uninstalled snap stub, and the
  network blocks every Playwright CDN (`cdn.playwright.dev`,
  `storage.googleapis.com`, `github.com`, `objects.githubusercontent.com`) with 403,
  so `npx playwright install` cannot work. Only `registry.npmjs.org` is reachable.
- Workaround: the npm package **`@sparticuz/chromium`** (devDependency) ships a real
  Chromium 153 binary inside the package tarball; it needs no download. `npm run
  pretest:e2e` (`scripts/prepare-e2e.mjs`) resolves a usable browser and writes
  `.e2e/browser.json` (gitignored), which `playwright.config.ts` reads to set
  `launchOptions.executablePath` (plus `--no-sandbox`, `--disable-dev-shm-usage`).
  If Playwright's own browsers *are* installed they win, and the fallback import is
  never used.
- Consequence: e2e runs in **Chromium only** (5 tests, all passing). Firefox and
  WebKit projects are *blocked* on this machine, not skipped by choice - on a
  machine with browsers installed the same suite runs in all three, because the
  config builds one project per available browser (`VIDI6_E2E_BROWSERS=chromium,
  firefox,webkit` can also be forced).
- Chromium 153 vs Playwright 1.64's expected 156: everything story 1 needs (CDP
  input, `boundingBox`, wheel, keyboard, `visualViewport`) works.

## Camera conventions (camera.math)

- `Camera {x, y, zoom}` with `screen = (world - camera.xy) * zoom`, i.e. `x, y` is
  the world point at the viewport's top-left. Panning by a screen delta is
  `panBy(cam, dx, dy) = x - dx / zoom`.
- Because of that sign convention `resetCamera(w, h)` is `{x: -w/2, y: -h/2}` (that
  is what puts world (0,0) at the viewport centre). The design doc writes the same
  rule as `x + viewportCentre.x / zoom`, which is the identical update expressed for
  the opposite sign; `TC-08` and `TC-26` assert the observable behaviour (origin
  centred at 100%), not the sign.
- `zoomStep` snaps the result to the nearest `ZOOM_STEP_FACTOR^n` within
  `ZOOM_STEP_SNAP_EPSILON` so step in then step out returns *exactly* the starting
  zoom (TC-09, TC-18). Clamped results at `ZOOM_MIN` are deliberately **not**
  snapped (1.25^-10 = 0.107 is further than the epsilon from 0.1), so the zoom
  limit is exactly `ZOOM_MIN` and the label is exactly "10%".
- Functions return the *same object* when nothing changed; `useCamera` uses that
  identity to skip renders and to decide whether navigation happened (TC-05/06,
  TC-29).

## Viewport rendering

- `useViewportSize` measures the board with a `ResizeObserver` (window fallback);
  a resize only replaces the `Size`, the camera is never touched (TC-07 is the
  maths half of this).
- Dot grid: `background-size = GRID_SPACING_WORLD * zoom`, and
  `background-position = mod(-camera.x * zoom - spacingPx/2, spacingPx)`. The extra
  `-spacingPx/2` is needed because CSS paints each tile's radial-gradient dot at
  the **tile centre**; with it a dot lands exactly on every world coordinate that
  is a multiple of `GRID_SPACING_WORLD` (including the origin crosshair), which is
  what the grid-anchoring tests assert (`dotAlignmentError` in both test harnesses).
- Wheel handling is a native `addEventListener('wheel', ..., { passive: false })`
  on the board (React's onWheel is passive), and Ctrl/Cmd `+`/`-`/`0` shortcuts are
  window-level with `preventDefault` so the browser's own zoom never changes
  (TC-31 asserts `visualViewport.scale` and `devicePixelRatio` stay 1).
- Anything marked `data-board-chrome="true"` (zoom controls) is excluded from the
  board's wheel/pointer handlers, so scrolling over the controls does not move the
  board (TC-30).

## Test build helpers

- `installTestHooks()` exposes `window.__vidi6.setCamera/getCamera` only when
  `import.meta.env.MODE === "test"` (Vite statically replaces it, so the whole
  block is dead-code-eliminated in `npm run build`; verified by grepping the built
  bundle for `__vidi6`: absent in production, present in `build:test`).
- In test mode the world layer also renders a `far-anchor` marker at world
  (1e6, 1e6) so TC-27 can measure exactness 1,000,000 units away without dragging
  a million pixels. It is inside the world layer, so it moves with the camera.

## Test-design decisions

- Camera is read back from the rendered world-layer `transform` in component tests
  and from `window.__vidi6.getCamera()` in e2e (both are asserted against each other
  through marker bounding boxes).
- `useCamera` coalesces updates with `requestAnimationFrame`, so the DOM lags one
  frame behind an input. E2E therefore waits with `await expect(label).toHaveText(...)`
  before the next click instead of reading `isEnabled()` - otherwise a stale button
  state makes Playwright wait for a click on a control that just became disabled.
- TC-25/TC-26 assert the whole zoom label sequence computed from the config
  constants (`stepLabels`), not hard-coded numbers: 125, 156, 195, 244, 305, 381,
  400 and 80, 64, 51, 41, 33, 26, 21, 17, 13, 11, 10.
- Marker measurements use the **centre** of the crosshair bar (`markerPoint`), so
  the 9px arm offset of the marker never leaks into a tolerance.
- Safari pinch is only covered by the component test TC-17 (synthetic
  `gesturechange`), as Playwright cannot synthesise gesture events - matching the
  test strategy's "Not covered" list.

## Story 2 — sticky notes

Design contracts are implemented as written. Everything below is either an extra
setting the PRD needs but the design did not name, or an environment fact the tests
depend on.

### Additions to `src/shared/config.ts`

- `STICKY_PADDING_WORLD = 16` — the PRD fixes the text 16 px from every note edge;
  the auto-fit search and the editor both need that number, so it is a named product
  setting next to the ones the design listed.
- `STICKY_COLOR_NAMES` / `stickyColorLabel(color)` — the accessible name and tooltip
  of each swatch ("Yellow colour" … "Violet colour"), so colours are distinguishable
  by name and not only by fill (PRD accessibility criterion).

### Board model

- `createSticky` returns `string` exactly as the design declares it. A rejected
  creation returns `''` (falsy), which keeps the return type a string while still
  telling the caller that nothing was created.
- Every successful mutation is one `doc.transact(fn, LOCAL_ORIGIN)`; rejections
  (stale id, unknown colour, non-finite coordinates, raise on the topmost note)
  return before a transaction opens, so they emit zero `update` events — that is what
  the unit suite counts.

### Viewport ownership

- `BoardViewport` stays presentation-only: it never calls `createSticky` itself. It
  reports `onEmptyDoubleClick(worldPoint)`, `onEmptyClick(worldPoint)` and
  `onSurfaceChange(surface)` and `App` decides what a click on empty space means.
  `viewportCentre(surface)` returns **screen** coordinates (the centre of the visible
  area); callers convert with `screenToWorld(surface.camera, …)`.
- `data-board-surface="true"` marks elements that empty-board gestures belong to
  (the board and its grid). Notes and both toolbars `stopPropagation`, so a note
  press can never pan the board and a toolbar click can never clear the selection.
- `BoardSurface.width/height` fall back to the measured viewport when
  `getBoundingClientRect()` is empty, because jsdom has no layout engine.

### Test hooks (test build only)

`window.__vidi6` gains `notes()` (a `snapshot()` of the live document) and
`createNote({x, y, color})`. E2E uses them to set up a board without simulating the
creation gesture and to read back world positions, which the DOM cannot express at
50 % / 200 % zoom. They are compiled out of `npm run build` (verified by grepping the
bundle for `__vidi6`).

### jsdom vs. a real browser

- jsdom has no layout: text fit, note clipping, the bottom fade and font-size
  measurement can only be verified in E2E (TC-33). Component tests assert the model
  and the DOM state (data attributes, which element is mounted), never geometry.
- jsdom has no `ResizeObserver`; `useViewportSize` falls back to
  `window.innerWidth/innerHeight` (1024 × 768).
- `StickyNote` coalesces drags with `requestAnimationFrame` (one Y.Doc write per
  frame, not per pointermove), and `useCamera` does the same for pans — so component
  tests must `await flushFrame()` before reading a position or the camera, and
  `data-panning` / `data-dragging` are checked synchronously.
- Only Chromium is available on this machine (see the Playwright section above), so
  story 2's E2E suite runs there; it covers TC-30 to TC-34 plus the golden path.

## Story 4 — persistence and load failure

### Storage layout (`persist.board_store`)

`BoardStore` owns four tables inside the board's own Durable Object SQLite
(`new_sqlite_classes: ["BoardRoom"]` in `wrangler.jsonc`, so no external database):

- `storage_meta (key, value)` — `storage_schema_version`, `snapshot_through_seq`.
- `updates (seq AUTOINCREMENT, data BLOB, bytes)` — the write log, one row per Yjs update.
- `snapshot_chunks (idx, data)` — `Y.encodeStateAsUpdate(doc)` split at
  `SNAPSHOT_CHUNK_BYTES` (512 KB), because a single statement argument has a size limit and a
  single row is harder to grow.
- `quarantined_updates (seq, data, error, quarantined_at)` — log rows that could not be
  decoded, moved out of `updates` so a load does not re-read them forever.

`shouldCompact` is `rows >= COMPACTION_UPDATE_COUNT (500) || bytes >= COMPACTION_BYTES (4 MB)`.
Row count and byte total are kept **in memory** (incremented on append, reset on compaction,
seeded by a load) so the hot write path never runs `COUNT(*)`.

`BoardStore` is written against a **structural** storage interface
(`BoardStorage { sql, transactionSync }`) rather than `DurableObjectStorage` from
`@cloudflare/workers-types`: the app tsconfig has no Workers types, the worker tsconfig does, and
this keeps the store testable from both. Blobs are bound as `ArrayBuffer` and read back as
`ArrayBuffer`, so `asBlob` / `asBytes` copy between that and the `Uint8Array` Yjs wants.

### Load: quarantine a row, never half a board

`load(doc)` decodes before applying: `Y.decodeUpdate` first, then `Y.applyUpdate` with the
`LOAD_ORIGIN` symbol (a load must not be re-stored or re-broadcast).

- A snapshot that will not decode is **fatal** (`{ ok: false, reason: 'snapshot-unreadable' }`):
  nothing is deleted and nothing is quarantined, because a truncated snapshot says nothing
  trustworthy about the rest of the board.
- A log row that will not decode is moved to `quarantined_updates` inside a `transactionSync`,
  counted, and the load continues with the remaining rows.
- `LoadResult` carries `applied`, `quarantined`, `snapshotBytes`, `logBytes`. Cross-isolate symbol
  identity makes `LOAD_ORIGIN` useless to a test (the DO and the test import separate module
  graphs), so a test reads these numbers instead.

Why damage is measured as "the rest of that writer's rows are missing": a Yjs transaction update
chains with the same writer's earlier items. Skipping a damaged **middle** row costs that writer's
later rows while other writers apply normally. Two consequences built into the design:
a board's log must begin with the writer's first transaction (the fixtures log their `initDoc`
row), and the room itself **never** runs `initDoc` — the client's own schema write arrives as an
ordinary update, which keeps every writer's row sequence contiguous and keeps an untouched board
empty in storage (TC-25).

### Room lifecycle (`persist.room`)

`src/worker/room-state.ts` is a pure transition table (`nextRoomState(state, event, clock)`) with
one timed edge: `load-failed → loading` only when `clock.sinceFailedMs >= LOAD_RETRY_MIN_INTERVAL_MS`,
otherwise the room stays `load-failed` and closes the newcomer with 4500.

- The constructor loads the board inside `ctx.blockConcurrencyWhile`.
- Sockets use the hibernation API (`ctx.acceptWebSocket`), so `webSocketClose` / `webSocketError`
  exist and **`webSocketClose` must echo the close** with `this.close(ws, code, reason)`. Unlike
  story 3's `server.accept()`, `acceptWebSocket` does not echo a close frame, and without the
  echo a client's `socket.closed()` hangs forever.
- `storeThenBroadcast(update)`: append first, then broadcast. A failed append discards the
  document, closes every socket with 1011 and moves to `storage-failed`; nothing half-stored is
  ever shown to anyone. Recovery is the next connection, which reloads from storage.
- Compaction runs inside the Yjs `update` handler (the document is complete at that point) and
  inside one `transactionSync`, so a failed compaction rolls back and the log is untouched;
  `compactIfNeeded` never throws.
- Frames are not wrapped in an outer transaction: each `append` is its own transaction. If a
  multi-frame message fails halfway, the document is discarded and clients re-sync their full
  history, which is recoverable in a way a half-written board is not.

### Client (`persist.client_status`)

`ConnectionState` gained `load_failed`. `connectBoard` listens to the provider's
`connection-close`: `CLOSE_BOARD_LOAD_FAILED` (4500) → `load_failed`; `CLOSE_STORAGE_FAILURE`
(1011) and every other code → `reconnecting`, because a board that was readable stays readable
and the client re-sends what it has. `load_failed` is the only state that locks editing
(`main[data-board-editable]` drives the cursor rules and `App` passes `editable` to the note
layer and the toolbar), and it clears itself on the next successful sync with **no reload** —
y-websocket keeps retrying because 4500 is outside its "do not reconnect" band (4400-4499).

### Server-side test hooks

`src/worker/test-hooks.ts` serves `POST /__test/boards/:id/corrupt-snapshot`, `POST .../repair`,
`POST .../compact` and `GET .../stats`, and only when `env.TEST_HOOKS === '1'`. `TEST_HOOKS` is
passed on the `wrangler dev` command line that Playwright and the persistence tests start; it is
**not** in `wrangler.jsonc`, so a deployed Worker has no branch here at all and the address falls
through to the client build — asserted by an integration test. `testCorruptSnapshot` also makes
the room let go of the board it was holding, so a test that damages a snapshot meets the damage on
the next visit instead of being served the good copy from memory.

### E2E with real restarts

`tests/e2e/helpers/wrangler-process.ts` starts a `wrangler dev` per test
(`--persist-to <tmp>`, a port from 24070-24079, its own inspector port) and `restart()`s it —
SIGTERM for an ordinary restart, SIGKILL for TC-20's abrupt one. Only the persistence specs do
this; everything else shares Playwright's `webServer`. They run in Chromium only: what they prove
is server-side durability, and a restart cycle costs more than a browser round-trip.

Environment note for these tests: `--var 'TEST_HOOKS:1'` is **not** re-added by a plain
`restart()` — the flag is stored on the process object so a restarted server keeps the same
shape as the one that died.
## Story 5 — a board is a place with an address

### What the contract changed for stories 1-4

- A board now has to be **created**. `POST /api/boards` is the only way one comes into
  existence; connecting to `/api/rooms/:id` no longer makes one (`BoardRoom.fetch` answers 404
  before it accepts a socket). Test helpers gained `ensureBoard` / `createBoardViaApi`, and every
  e2e `openBoard()` without a `boardId` creates through the API first.
- A malformed id answers **404, not 400**, on both `/api/boards/:id` and `/api/rooms/:id`, and it
  reaches no Durable Object at all (story 1's worker-entry test was updated to match).
- `BoardRoom.boardExists()` treats a storage read that *throws* as "still somebody's board": it
  returns `true`, so story 4's load-failure path (`CLOSE_BOARD_LOAD_FAILED`, TC-26) is intact and
  a board that cannot be read is never reported as missing.
- `BoardStore.migrate()` is no longer on the read path. Nothing creates tables except an explicit
  `initialize()` or a first write, which is what makes "404 and no storage behind it" testable.

### Durable Object RPC carries text, not bytes (the bug that cost the most time)

`BoardRoom.testSeedLegacy` and the `/__test/boards/:id/seed-legacy` hook used to hand
`Uint8Array`s across the RPC boundary. What arrived was an object `BoardStore.asBlob` could not
copy, so each row was written as **the right number of zero bytes**: `load()` reported
`applied: 3`, `quarantined: 0`, and the board opened empty. Every hook in this project therefore
carries **base64 text** (`corrupt-snapshot`, `corrupt-update`, `seed-legacy`), and the Worker
decodes it with `board-store.ts`'s `fromBase64`. `seedLegacyRows` now throws on anything that is
not a `Uint8Array` so this failure mode cannot be silent again. The integration test for TC-08
asserts the seeded note **count**, not "more than zero", which is what let the empty board through.

### Reading a board that predates the API (TC-31)

`seed-legacy` writes story 4's rows and deliberately leaves `created_at` out. The existence check
answers 200 because rows exist (`BoardStore.createdAt()` returning null is not the test that
matters), the link opens with its notes, and `WranglerProcess.restart()` — SIGTERM, same
`--persist-to`, same port — brings the same board back. Note that `WranglerProcess.stop()`
**deletes** the storage directory unless `deleteState: false`; a restart that must keep state uses
`restart()`, which is what the persistence specs already do.

### Clipboard in Chromium

`TC-26` grants `clipboard-read`/`clipboard-write` on the test origin and reads the link back out
of the real clipboard before handing it to the second browser context. `TC-29` refuses it instead,
with an `addInitScript` that redefines `navigator.clipboard` so `writeText` rejects; the panel
falls back to a selected field, and the test asserts `selectionStart`/`selectionEnd` cover the
whole value.

### Component tests

`vitest.config.ts` gives the `component` project the jsdom URL `https://vidi6.example/`, so
`window.location.origin` (and therefore the link the Share panel shows and hands to `writeText`)
has the https shape production has. Pages and the panel are tested with `src/client/api` and
`src/client/sync/connectBoard` mocked at the module boundary: `BoardView` is story 3's board,
copied rather than re-derived, so a page test that mounts a board is not a hidden sync test.

### Integration noise that is not a failure

Refusing a WebSocket upgrade leaves the local Durable Object sim holding a request it will never
finish, and workerd prints `Application called abortAllDurableObjects()` (or
`deleteAllDurableObjects()`) at suite teardown. `tests/integration/board-api.test.ts` calls
`abortAllDurableObjects()` before `reset()` in `afterEach` to keep the output readable. The message
is sim bookkeeping, not an assertion: the suite exits 0 either way.

---

## Story 7 - selecting, moving, resizing and deleting several objects at once

### The board model keeps two snapshot views, on purpose

`snapshot(doc)` still returns `readonly StickySnapshot[]`, because stories 1-5 (and their tests)
read notes through it. Story 7 added `objectSnapshots(doc)` next to it, returning generic
`ObjectSnapshot[]` for the registry renderer, the selection and the marquee. `StickySnapshot extends
ObjectSnapshot`, and `useBoardDoc` now reads **one** snapshot pass and derives `notes` from
`objects`, so the two views can never disagree.

Generic snapshots turned out to be too thin to render with: a position-only sticky has no `color`
and no `text`, which broke the note toolbar. `board-model.ts` therefore has a per-type snapshot
reader table (`registerSnapshotReader`, `SnapshotReader`), `sticky` registers `stickyFrom`, and
`objectFrom` dispatches known types to their reader. Future types add a reader; nothing in the
board changes.

`SELECTABLE_TYPES` lives in `src/shared/board-model.ts` (seeded with `sticky`) and is filled by the
client registry through `registerSelectableType`. `allObjectIds`, `objectsInRect` and
`objectSnapshots` filter on it, which is what makes an unknown type unselectable (TC-12) without the
shared layer knowing anything about client components.

### Geometry is its own module, and clamping is per object

`src/shared/geometry.ts` defines its own `Point`/`Rect` (structurally identical to the camera types,
so no shared → client import) and holds `normalizeRect`, `rectContains`, `unionRects`, `resizeRect`,
`clampScale` and `scaleWithin`.

- `resizeRect` anchors the opposite edge/corner of the handle being dragged, and for
  `aspectLocked` it follows the axis that moved proportionally **more**, so a corner drag that is
  more vertical than horizontal scales by the vertical ratio.
- `clampScale` asks each selected object what it can tolerate (its type `minSize`, and
  `MAX_OBJECT_SIZE_WORLD`) and returns a factor no object would exceed. When the request was
  uniform it stays uniform - that is what keeps an aspect-locked group resize aspect-locked after
  clamping - and when min and max conflict it prefers the minimum, so a group can always be dragged
  somewhere legal rather than freezing.
- `scaleWithin(rect, box, to)` maps one object from the old bounding box into the new one, which is
  how gaps scale with the objects (TC-04: two notes 100 apart, box width ×2 → 400 wide, gap 200).
- `resizeRectFromScale` converts the clamped factor back into a box around the handle that was
  dragged, so the handle stays under the pointer as far as clamping allows.

### Group operations skip transactions that would write nothing

`moveObjects`, `resizeObjects`, `deleteObjects` and `bringObjectsToFront` count only the writes they
actually make. That matters for stories 2 and 3's expectations about update counts: `moveObjects` to
where the notes already are, or `bringObjectsToFront` on a selection that is already contiguous on
top, returns 0 and fires no `update` event. `moveObjects` also returns the number of objects it
found, so a selection that partly vanished is visible to the caller (TC-05).

### Selection is a pure reducer, and presence is handled by pruning

`src/client/board/useSelection.ts` exports `selectionReducer` (pure, unit-tested TC-13 to TC-15) and
the hook `useSelection(snapshot)`. Actions are `click`, `toggle`, `setMany`, `clear`, `prune`, `edit`.
`edit(id)` selects and starts editing; `edit(null)` ends editing and keeps the selection - which is
what makes Enter-on-a-selected-group edit one note and leave the group selected (TC-30).

The first version filtered action ids against the snapshot at dispatch time. That is wrong: a note
created by the toolbar is not in the snapshot of the render that asked for it, and story 2's
select-after-create (its TC-23) needs it selected immediately. Ids are now pruned **when the
snapshot changes** instead, which also implements TC-17/TC-18 - a remote delete, or a local delete,
leaves the selection without that id and the bar count follows.

### The registry, and how a `StickyNote` fits it

`src/client/objects/registry.tsx` holds `ObjectTypeSpec { Component, resizable, aspectLocked,
minSize, editableText, hitTest }`, `registerObjectType` (throws on a duplicate type, TC-11) and
`getObjectType`. `sticky` registers itself when the module is imported - importing the registry from
`BoardView` is what registers the board's types, and the story 2 tests keep working because the
sticky component is still `StickyNote`.

`Component: ComponentType<ObjectProps<never>>` is the trick that lets a component with the narrower
`ObjectProps<StickySnapshot>` be registered; `BoardView` casts to `ComponentType<ObjectProps>` when
it renders. `ObjectProps` carries `onObjectPointerDown(event, id)` typed against a structural
`PointerEventLike`, so a React synthetic event and a DOM `PointerEvent` are both acceptable.

`hitTest` is per type and `hitTestBounds` (the shared implementation behind it) treats `x`/`y` as the
**top-left**, with the type's default size used when width/height are absent - a unit test that
assumed centres had to be corrected for this.

### The transform gesture: window listeners, absolute start rects, one write per frame

`useTransformGesture` returns `onObjectPointerDown`, `onHandlePointerDown` and `activeIds` (the
latter is `data-dragging`, which story 2's tests already asserted). After the pointerdown it listens
on `window` for `pointermove`/`pointerup`/`pointercancel`, so components only have to forward one
event and the gesture survives the pointer leaving the object.

Three things that were wrong until they were tested:

1. **Stale closure.** The listeners are attached once, so they must not close over the mount
   render's `doc` or options. All of them now read `inputs.current`, refreshed every render.
2. **Absolute positions.** At threshold crossing the gesture captures each selected object's rect
   and the union bounding box. A move writes `startRect + pointerDelta / zoom` (never
   `current + delta`), which is what makes the e2e assertion "300 board units and nothing snapped
   back" true.
3. **A release between two frames.** Writes are coalesced to one animation frame, and the gesture is
   retired on pointerup, so the guard `gesture !== gestureRef.current` dropped the final apply.
   `applyGesture(gesture, final = false)` now applies the pending delta exactly once on release
   (`applyGesture(gesture, true)`) and `pointercancel` drops the pending delta while keeping the last
   applied state (TC-26's cancellation rule).

`onGestureStart` / `onGestureEnd` are exposed through `BoardView` props. That is the seam story 8
needs for "one transaction per continuous gesture", and the component tests use it to count gesture
boundaries.

### Marquee, outlines and the bar

- `BoardViewport` decides *gesture by modifier on empty space*: Shift+drag is a marquee, plain drag
  is still story 1's pan. Marquee cancel does not dispatch `onEmptyClick`, so a cancelled marquee
  does not also clear the selection.
- `useMarquee` keeps the rectangle in world units and selects objects **fully inside** it
  (`objectsInRect`); Escape during an active marquee cancels it and leaves the selection alone.
  The Escape listener is on `document`, not `window`: the marquee has to cancel before
  `useBoardKeys`'s window-level Escape clears the selection.
- `SelectionBar` renders nothing below two selected objects (TC-19), announces `aria-live="polite"`
  and has one action: delete the whole selection in one model call (TC-16).
- `SelectionOverlay` draws the bounding box and the eight handles, handles staying `HANDLE_SIZE_PX`
  on screen at any zoom, and renders no handles at all when the selection has no resizable type
  (TC-17, proved with the `testlabel` fixture).
- `useBoardKeys` ignores keys while focus is in a field (`Ctrl+A` stays a text select inside a note,
  TC-28) and while an object is being edited (TC-29). Escape clears selection, arrows nudge by
  `NUDGE_STEP_WORLD` (`NUDGE_LARGE_STEP_WORLD` with Shift), Delete removes the selection, and each of
  them calls `preventDefault` so the page does not scroll and the board does not pan (TC-34).

### Test-only object types

`tests/fixtures/testbox.tsx` (resizable, **not** aspect-locked, `TESTBOX_MIN_SIZE_WORLD = 10`) and
`tests/fixtures/testlabel.tsx` (not resizable, not editable) are registered only by tests, which is
how "generic for every type" is proven before stories 9-12 add real types: non-uniform group resize
with per-type minimums, hidden handles, Enter not editing a non-text type.

### Component-test harness truths that cost time to find

- `pressKey` dispatches on `document.body` when nothing has focus (dispatching on `window` never
  reaches a `document`-level listener such as the marquee's Escape).
- `renderBoard` forwards `onTransformStart`/`onTransformEnd`; without that the gesture-boundary spies
  see nothing.
- Camera writes are coalesced in `useCamera`, so `readCamera()` after a pan or a move needs
  `await flushFrame()` first.
- jsdom does not do text editing: an editor's value changes with
  `fireEvent.change(editor, { target: { value } })`, not with a keydown.
- There is no `data-editing` attribute; editing is detected by the editor element existing inside the
  note (`editorElement()` / `editorFor(id)`).
- `createNote`/`createSticky` take the note's **centre** and store `centre - STICKY_SIZE_WORLD / 2` as
  `x`/`y`; marquee and hit-test expectations have to be computed as `centre ± 100`.

### E2E notes

- Every story 7 e2e test parks the camera at the world origin (`setCamera({ x: 0, y: 0, zoom: 1 })`,
  or `zoom: 0.5` for the 20-note fixture) so a board unit and a screen pixel are the same number and
  a drag can be stated in board units. `tests/e2e/helpers/selection.ts` measures selection through
  `data-selected` and the bar's announced text - never through client state.
- `tests/e2e/reorganise.spec.ts` is the design's workflow 1 (TC-32 → TC-33 → TC-34): box-select,
  group move 250 units, corner resize (sizes and gaps ×1.2, notes still square, the unselected note
  untouched), min-size clamping, arrow nudge with no page scroll and no pan, then the selection bar's
  Delete. TC-33 also asserts the moved group is painted **above** the note it was dragged over.
- `tests/e2e/selection-live.spec.ts` (TC-35) uses the 20-note fixture in two clusters
  (`tests/fixtures/selection-board.ts`): Lee box-selects four, Sam deletes one, Lee's bar goes from
  "4 selected" to "3 selected", the remaining three stay outlined, and Lee's Delete removes exactly
  those three. Measured prune latency on this machine: **109 ms** against the 1000 ms budget.
- `tests/e2e/full-capacity.spec.ts` (TC-36) runs MAX_CONCURRENT_EDITORS contexts, each box-selecting
  and dragging its own column at the same time; every editor ends with the same board, holding the
  positions each of them intended. Convergence logged at ~1.2 s for the whole five-editor run.
- `npm run test:e2e` on 12 workers made story 4's TC-31 (which starts and restarts its own
  `wrangler dev` next to Playwright's server) time out in `waitForSelector`; on this machine the full
  e2e suite is stable at `--workers=6`. Nothing about the assertion changed. Playwright's default is
  half the cores - 16 on this 32-core box - and at 16 the shared dev server was reported dead
  (`[WebServer] Uncaught Error: Network connection lost.`) mid-run, so `playwright.config.ts` now caps
  workers at `Math.min(6, cpus().length)`.

### Cross-browser: what this machine can run, and what the failures taught

Task 15 asks for TC-32 in Firefox and WebKit too. Installed Playwright's Firefox and WebKit to try.

- **WebKit cannot launch here**: `browserType.launch: Host system is missing dependencies to run
  browsers` naming `libavif13`; installing it needs `sudo`, and this default container sets the
  "no new privileges" flag, so `sudo` is refused. Marked blocked in PROGRESS.md rather than pretended.
- **Firefox passes story 7's own board tests**: TC-32, TC-33, TC-34 and TC-35 all green there
  (`VIDI6_E2E_BROWSERS=firefox npx playwright test reorganise selection-live`).
- **TC-36 (five simultaneous editors) fails in Firefox only.** With five contexts each driving a
  marquee and a drag, Playwright's synthesized mouse input for one page arrives on another: a page
  logged `pointerdown` at coordinates belonging to a different window - some of them negative - and
  marquees selected nothing. Run one page at a time in the same build, the very same drags select
  correctly. It is Playwright's Firefox input dispatch under load, not the app: the identical test is
  green in Chromium, and Chromium is the browser `npm run test:e2e` uses here.
- **Story 1 to 5's e2e tests have the same kind of Firefox-only failures on this machine** (TC-26 in
  `share.spec.ts`, TC-27 in `live-collaboration.spec.ts`, the panned-board toolbar test in
  `sticky-notes.spec.ts`). Fixing other stories' tests is out of this story's scope, so the Firefox
  binary was removed again after the checks: the checked-in `.e2e/browser.json` detection resolves
  back to Chromium alone, which is the configuration this suite is green in.

**A synthesized pointer must stay inside the viewport.** The first version of TC-33 grabbed a handle
whose release point was off the right edge of the 1280x800 viewport. Chromium reported the off-screen
move as given; Firefox reported a whole stretch of the drag as `pointermove` at `x=0, y=-86` targeting
`#document` - negative coordinates, which the gesture then faithfully applied and the group collapsed
to its minimum size. That looked exactly like "resizing breaks in Firefox", and it was the test.
Now: TC-33's cluster sits at 150/450/750 so every marquee, move and handle drag releases on screen,
and `insideViewport()` in `tests/e2e/helpers/selection.ts` throws before a drag starts if its start or
end would put the pointer off the viewport - a broken test should say so immediately rather than let
the app absorb it. `dragScreen` is one continuous `mouse.move(from -> to, { steps })`; two consecutive
`mouse.move` calls produced garbled Firefox events (a `pointermove` reported as `pointerdown`).

**Two real product fixes came out of Firefox**, both found because Firefox reported the browser's own
behaviour where Chromium quietly hid it:

- *The release carries the final position.* Browsers legitimately coalesce or drop trailing
  `pointermove`s, and an inertial scroll on the release lands the pointer somewhere other than the
  last reported move. TC-33 moved a group 250 units and it landed 200 away - the release position was
  never read. `useTransformGesture.finish` now takes `pending` from the `pointerup`'s own coordinates:
  an object ends up exactly where the pointer was released, which is what the PRD's "move what I
  selected as one" actually promises. (Chromium's `user-select` text drag, below, was what made this
  visible as a 200-unit error rather than a rare one.)
- *Dragging the board is not dragging text or a button.* Pressing on a note's text, or on its toolbar
  buttons, let the browser start its own drag; Firefox then handed the pointer to that drag, mid-gesture,
  and applied a garbage offset. `BoardViewport` now prevents `dragstart` on the board surface, and the
  board and world layers are `user-select: none` with text editors opting back in to `user-select: text`.
  Selecting text inside a note still works; starting a drag off a note can no longer hijack a transform.
- `setPointerCapture` is gone. Window-level listeners already receive every move and release, and
  capture is fragile against a re-render that swaps the captured element - which group drag-and-raise
  can do, because the raised objects are rendered later in the list.

### Flakes seen, and what was not done about them

Two suites each failed once while other suites were running beside them - one component test, and
`tests/integration/board-room.test.ts`'s "query ok" (a 45 s wait for a delayed D1 write) - and each
passed in isolation and on every re-run. Both are timing-sensitive under load rather than wrong. No
test was loosened, skipped or deleted to get the suite green; the changes made were the product fixes
above, the viewport rule for synthesized pointers, and the worker cap.

## Story 8 - undo and redo my own changes without undoing anyone else's

### Where the history lives

`src/client/board/undo.ts` is a thin `UndoController` over one `Y.UndoManager`
scoped to `doc.getMap('objects')` with `trackedOrigins: new Set([LOCAL_ORIGIN])`
- the origin every mutation in `src/shared/board-model.ts` already carries (story
2). Per-user undo is that one filter: everything that arrives from the room comes
with the provider's origin, and everything that arrives from storage comes with
`LOAD_ORIGIN`, so neither is ever captured, and no history is stored anywhere -
reload and it is gone (`undo.session_only`). Story 16 will call `addScope()` for
`comments`.

- **Deviation from the design text:** the design says the tab's controller is
  "created in this tab by `App.tsx`". `App.tsx` never sees a `Y.Doc` - the
  document only exists after `BoardPage`'s load - so `BoardView` creates it (and
  destroys a controller when the board it was made for is replaced). Tests pass
  their own controller through `renderBoard({ undo })`, which is how the
  component suites read stack state without a second undo sitting next to the
  board's.
- Object components reach the same controller through `UndoControllerContext`
  rather than a prop: `registry.tsx` renders every object kind from one plain
  props object, and a story about undo should not have to widen every object's
  props.
- The controller has no `state()` or `steps()`. Step counting in the tests is
  done the way a person does it - pressing until `canUndo()` is false - so a test
  cannot pass by reading an internal number that the UI never uses.

### One press is one stack item (`undo.safe`)

`Y.UndoManager.undo()` pops **until a pop changes something**
(`popStackItem`'s `while (stack.length > 0 && currStackItem === null)`). With a
collaborative document that is the dangerous case: if the top step moved a note
someone else deleted, Yjs walks further back and reverses earlier steps too, so
one press of undo would undo several of my actions. `popOneStep` hands the
manager a stack containing only its top item, calls `undo()`, and puts the rest
back in a `finally`. A step whose object is gone then consumes itself: nothing
visible, no error, next press continues (TC-07, TC-23).

- `manager.undo()`'s own return value is *not* the answer a press needs: it says
  whether a change was applied, and the caller has to know whether a **step was
  consumed**. So `undo()`/`redo()` return "a step was taken", and the controller
  `notify()`s after every press that took one. That also fixes a real bug found
  in e2e: a press that changed nothing fires no Yjs event at all
  (`stack-item-popped` is only fired for a pop that did something), so the
  toolbar buttons kept showing the state from before the press and Undo stayed
  enabled on an exhausted history.
- `Y.StackItem` is not exported by yjs, so a popped item is typed as `unknown`
  and never touched.

### Boundaries, and what a step means

`boundary()` closes the capture window; `group(open)` holds one step open for the
whole length of one action. `useTransformGesture` calls `onGestureStart` /
`onGestureEnd`, `BoardView` composes them with `group(true)` / `group(false)`,
because a drag writes on every animation frame and a slow drag is longer than the
500 ms typing window - without the group it would come back as several steps
(TC-14). `StickyTextEditor` calls `boundary()` on mount and on unmount, so an
editing session is its own step and `Ctrl+Z` in the textarea takes back the
typing only (`commit()` first, then `stopPropagation()` so the board does not
undo a second time). Colour changes, delete, create and the selection-bar delete
each go through `boundary()` (TC-15).

- `stopCapturing()` alone does not re-open a group: it only resets `lastChange`,
  so `boundary()` also restores `captureTimeout` - a gesture whose
  `group(false)` never ran (an exception mid-drag) is repaired by the next
  boundary.
- The keyboard branch in `useBoardKeys` sits after Escape and before the "nothing
  is selected" rule, because undoing is not a selection command: `Ctrl+Z` works
  with nothing selected (TC-21). `Ctrl+Y` is redo along with `Ctrl/Cmd+Shift+Z`,
  and every one of them is `preventDefault`ed so the browser's own undo cannot
  diverge from the document's (TC-19). Focus in any field - a share-link input, a
  note's textarea - keeps the event away from the controller (TC-21 negative).
- `useUndo` recomputes `canUndo`/`canRedo` from the stacks on every `onChange`
  notification (a `useReducer` stamp), which is what makes `disabled` and
  `aria-disabled` correct without duplicating the state.

### e2e coordinates

`setFlatCamera({x: 0, y: 0, zoom: 1})` parks world (0,0) at the **top-left of the
screen**, not at its centre (`screen = (world - camera) * zoom`), so seeded notes
have to sit at positive world coordinates inside 1280x800 - a note created by the
toolbar is at `VIEWPORT_CENTRE` in world coordinates, and a note's snapshot `x/y`
is its top-left, i.e. centre - `STICKY_SIZE_WORLD / 2`. TC-24 seeds ten notes from
one page in a single JS task, so their creation merges into one capture-window
step, and each of the five editors then presses `Ctrl+Z` exactly twice to take
back their own move and their own typing.

### Flakes seen, and what was done about them

`tests/e2e/share.spec.ts` TC-31 (story 4 storage, Worker restart) timed out on most
full-suite runs once story 8's e2e tests were added - and it turned out to be a
pre-existing machine problem, not a story 8 one: the pre-story-8 commit
(`e74d66f`, checked out into a separate worktree) fails the same way, 2 runs out
of 2, when `share.spec.ts` and `board-persistence.spec.ts` run side by side, while
TC-31 alone passes in 2.7 s. Both files start their own `wrangler dev` in the
24070-24079 block, and `restart()` was taking 21 s under that load (its own
measurement, not a guess) against 1-2 s unloaded.

The change made was to the harness size, not to the test:
`playwright.config.ts` now caps workers at 3 instead of 6 (the file already
carried a reduction from Playwright's default 16 for the same reason). With three
workers the whole suite - 42 tests, nightly included - is green in about 1m20s,
where six workers took 3m20s and lost TC-31 on most runs. No assertion, timeout or
wait inside any test was loosened; `share.spec.ts` is untouched.

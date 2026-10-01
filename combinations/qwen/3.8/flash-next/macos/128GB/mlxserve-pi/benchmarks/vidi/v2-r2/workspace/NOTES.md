# Notes — story 1 (pan and zoom around an infinite board)

Decisions, deviations from the design's file list, and things the next story
(stories 2–5 build on this skeleton) needs to know.

## What is here

- `src/shared/config.ts` — every named setting. The six the design names, plus
  two for `deltaMode` conversion (below).
- `src/client/canvas/camera.ts` — pure camera maths, no DOM, no React.
- `src/client/canvas/useCamera.ts` — camera state + input handlers.
- `src/client/canvas/BoardViewport.tsx` — input surface, dot grid, world layer.
- `src/client/canvas/ZoomControls.tsx`, `NavigationHint.tsx` — overlay chrome.
- `src/client/canvas/CameraProvider.tsx` — see deviation 1.
- `src/client/canvas/testHooks.ts` — `window.__vidi6.setCamera()` in `test` mode.
- `tests/unit/camera.test.ts` (16), `tests/component/*.test.tsx` (27),
  `tests/e2e/navigation.spec.ts` (9 tests x 3 browsers = 27).

## Deviations from the design's file list

1. **`CameraProvider.tsx` is an extra file.** The design's layout puts
   `useCamera` in `BoardViewport.tsx`, but its sequence diagrams have
   `ZoomControls` and the keyboard listener driving *the same* camera as the
   viewport, and `App.tsx` has to read `hasNavigated` for the hint. One
   `useCamera` instance therefore has to be shared by three components. Rather
   than move input plumbing into `App.tsx`, `CameraProvider` calls `useCamera`
   once, measures the board area with a `ResizeObserver`, and hands the
   `CameraApi` down through context (`useBoardCamera()`). `BoardViewport` stays
   the input surface; the provider adds no behaviour of its own.
2. **`useCamera` returns more than the contract's minimum.** Additions:
   `pinchAt(point, factor)` (the Safari `gesturechange` path, which the design's
   diagram routes through `zoomAt` at the pointer) and `setCamera(camera)` (used
   by the test hook). Nothing in the design's listed members changed name or
   signature.
3. **Two extra named settings**: `WHEEL_LINE_PX = 32` and `WHEEL_PAGE_PX = 800`.
   The design requires `deltaMode` LINE/PAGE to be converted to pixels but does
   not name the constants; browsers report lines/pages without a pixel size, so
   the conversion needs a value. Both are in `src/shared/config.ts`.
4. **Extra files that scaffolding needs**: `index.html` (Vite entry),
   `src/client/vite-env.d.ts` (types `import.meta.env` and `window.__vidi6`),
   `tests/component/setup.ts` (the jsdom project's setup file, empty for now),
   `tests/component/helpers.tsx`, and `tests/e2e/helpers/board.ts` /
   `pixels.ts`. The design lists `main.tsx` and `App.tsx` explicitly; the rest are
   implied by "scaffold".
5. **`wrangler.jsonc` has no `main`/bindings** — assets only, with
   `not_found_handling = "single-page-application"`. Worker code arrives in
   story 3; a `main` field pointing at a non-existent file makes `wrangler dev`
   fail to start.

## Implementation decisions

- **Camera maths is object-identical on no-ops.** `panBy` with a zero delta, and
  any zoom at a limit, returns the *same* `Camera` object. `useCamera` uses that
  identity to decide whether the user has "navigated" (hint latch) and to skip
  React re-renders. Tests assert object identity where the design does.
- **Step snapping.** `zoomStep` snaps the result to the nearest
  `ZOOM_STEP_FACTOR^n` within `STEP_SNAP_EPSILON = 1e-9`, so one step in then one
  step out returns exactly `1` (TC-09), while a wheel zoom (never stepped) does
  not snap. Because division is not the exact inverse of the snap, one zoom-out
  from `ZOOM_MAX` gives `4 / 1.25 = 3.2` → label `320%`, not `305%`; the e2e test
  asserts `320%` (that is the design's rule, not a bug).
- **Updates are batched into one `requestAnimationFrame`.** The newest camera is
  kept in a ref so `panMove` accumulates from the *pending* camera: a fast drag
  whose moves arrive between frames still follows the pointer exactly (this is
  what makes the ±1 px e2e assertions hold).
- **Grid**: one `radial-gradient` `background-image` on the viewport, with
  `background-size = GRID_SPACING_WORLD * zoom` and
  `background-position = mod(-x * zoom, spacing)` per the design. The dot radius
  scales with zoom and is clamped to 0.6–5 CSS px so the dots stay legible at
  10% and do not become blobs at 400%; the radius is not a design constant.
- **Wheel listener is added manually** with `{ passive: false }` (React's
  `onWheel` is passive, and `preventDefault` is the point), attached to the
  viewport element; Safari `gesturestart/change/end` and the window `keydown`
  handler are added the same way. All of them `preventDefault()`.
- **Drag only starts on the surface itself** (`event.target === viewport`): the
  grid is the viewport's own background, and later stories' objects stop
  propagation so they can own their drags.
- **Resize never moves the camera**: `resize` only updates the size used to find
  the centre; `x, y` are untouched (design TC-07), and `Reset view` uses the
  current size, so it centres for whatever the window is now.

## Test decisions

- **Red phase was observed.** With `camera.ts` reduced to `not implemented`
  stubs, 15 of the 16 unit tests failed (the survivor only asserts that a value
  does not change). It was verified in the working tree rather than as its own
  commit, because the story asks for a single commit at the end.
- **Test-case ids** in the test files match the design's acceptance cases.
  Suffixed ids (`TC-15b`, `TC-17b`, `TC-18b`, `TC-22b`, `TC-22c`, `TC-30b`) are
  additional checks around the same case, not new cases.
- **`@testing-library/jest-dom` is not used** (it is not in the design's dev
  dependencies), so assertions use DOM facts: `button.disabled`,
  `getAttribute('disabled')`, `textContent`.
- **Vitest globals are off**, so Testing Library does not auto-clean the DOM.
  `useBoardTestLifecycle()` in `tests/component/helpers.tsx` installs fake
  timers per test *and* calls `cleanup()`; every component test file calls it at
  the top of the module.
- **Vitest 5's `vi.useFakeTimers()` also fakes `requestAnimationFrame`**, which
  is how the component tests flush the rAF-batched camera commit
  (`flushFrames()` advances 32 ms inside `act`).
- **jsdom facts the component tests rely on**: no `ResizeObserver` (so the board
  area is `window.innerWidth × innerHeight` = 1024×768), `getBoundingClientRect()`
  returns zeros (so screen coordinates equal client coordinates), and
  `setPointerCapture` is missing (the component calls it with `?.`).
- **e2e waits for the app's own batching instead of sleeping.** The board commits
  a gesture in the next frame, and headless WebKit applies mount effects up to
  ~50 ms after the load event. `waitForCameraChange(page, before)` waits until the
  camera differs from a pre-gesture read and then until two reads agree;
  `settledCamera()` waits for agreement alone; `setCamera()` waits for
  `window.__vidi6` to exist. Reading geometry immediately after a click is a real
  race — it produced a false failure before the helpers existed.
- **Pixel assertions are done twice, differently.** CSS/layout facts come from
  `getBoundingClientRect` (origin marker, board area) and `getComputedStyle`
  (grid `background-size`/`background-position`). Rendered pixels are checked too:
  `tests/e2e/helpers/pixels.ts` decodes the page screenshot *inside the browser*
  (canvas `getImageData`) and locates grid dots by luminance. Because a screenshot
  is whole device pixels, rendered-pixel deltas carry a ±2 px rounding allowance;
  CSS-derived positions keep the design's ±1 px.
- **Grid dots are sampled on a row that actually crosses dots** (`dotRow(geom)`
  derives it from the computed geometry): a fixed row can fall between two rows of
  dots and silently sample nothing.
- **Chromium dispatches the Ctrl+wheel through CDP** (`Input.dispatchMouseEvent`
  with the Ctrl modifier) so it is a real browser-level gesture; Firefox and
  WebKit get a `WheelEvent` with `ctrlKey` set, which is what a trackpad pinch
  looks like to the board. All three assert `defaultPrevented` from a
  document-level listener — that flag is exactly what the browser uses to decide
  whether to zoom the page — plus `visualViewport.scale` and `devicePixelRatio`
  unchanged.
- **Both fixture sizes are used in e2e**: 1280×800 for every project and one test
  that starts at 1920×1080, shrinks to 1280×800 (camera `x, y` must not move) and
  resets (must centre on the new size).
- **Not covered**, as the design states: TC-33 (shortcuts while the browser's own
  address bar has focus — the page cannot receive those events), trackpad
  hardware inertia, Safari pinch in e2e (Playwright's WebKit cannot synthesise a
  `GestureEvent`; TC-17 covers the handler), and touch input.
- **Manual browser check** (task 3's "Done when") is covered by the automated
  suite in Chromium, Firefox and WebKit; a real Safari pinch was not available.

## Environment notes

- **`playwright.config.ts` carries two macOS-only launch allowances.** Firefox's
  macOS process sandbox cannot initialise inside a sandboxed agent
  (`sandbox_init(): Operation not permitted`) and Playwright's WebKit
  host-requirements check cannot run unprivileged. Both are gated on
  `process.platform === 'darwin'` and only affect whether the browsers start.
- **`npm run test:e2e` builds with `MODE=test`** (through the Playwright
  `webServer` command) so the test hook exists; the production build was checked
  to contain no `__vidi6` reference. `reuseExistingServer` is on outside CI.
- **Reserved browser shortcuts**: `Ctrl + =` is a browser-reserved zoom shortcut
  in real desktop browsers, which can act on it before the page sees the event.
  The board calls `preventDefault()`, and TC-31 asserts the page zoom is untouched
  for dispatched events; that is the strongest statement available from inside a
  page.

## For stories 2–5

- `src/shared/config.ts` is the place for new settings; do not re-declare.
- Board content goes in `BoardViewport`'s `children` — it is rendered inside the
  world layer, so it is already in world coordinates (`transform-origin: 0 0`,
  `scale(zoom) translate(-x, -y)`). Give interactive objects their own
  `onPointerDown` with `stopPropagation()` so the board does not start a pan.
- The world layer is `pointer-events: none` today; objects that need input must
  re-enable it on themselves.
- Camera reads in tests: the viewport carries `data-camera-x`, `data-camera-y`,
  `data-camera-zoom`, `data-grid-spacing`, `data-grid-offset-x/y`,
  `data-origin-x/y` and `data-mode` (`idle` / `panning`).

---

# Story 3 — see other people's edits appear live on the same board

## What is here (story 3)

- `src/worker/index.ts` — Worker entry: routes `GET /api/rooms/:boardId` to that
  board's `BoardRoom` Durable Object, 426 for a socket-less request, else falls
  through to static assets.
- `src/worker/board-room.ts` — one DO per board: an in-memory `Y.Doc`, a set of
  accepted sockets, sync relay (no echo to the author), awareness relayed verbatim
  to every socket including the sender.
- `src/client/sync/endpoint.ts` — `COLLAB_ENDPOINT` from `VITE_COLLAB_ENDPOINT`
  (client-only; the shared `config.ts` the Worker imports must not read
  `import.meta.env`).
- `src/client/sync/connectBoard.ts` — the `WebsocketProvider` wrapper plus the pure
  `mapConnectionState` state machine, and the awareness keep-alive.
- `src/client/sync/ConnectionStatus.tsx` — the badge (`role="status"`).
- tests: `tests/unit/protocol.test.ts`, `tests/integration/*` (workerd),
  `tests/component/ConnectionStatus.test.tsx`, `tests/e2e/live-collaboration.spec.ts`,
  `tests/e2e/nightly-collaboration.spec.ts`.

## Deviations and decisions

1. **Vitest downgraded 5 → 4.1.11.** `@cloudflare/vitest-pool-workers@0.22`
   peer-requires vitest `^4.1.0`; no pool version supports vitest 5. The existing
   tests use only APIs that are identical across both. The pool's bundled workerd
   caps `compatibility_date` at `2026-08-22`, so `wrangler.jsonc` uses `2026-08-01`.
2. **Two tsconfigs.** `tsconfig.json` (DOM lib, client+tests) and
   `tsconfig.worker.json` (Workers globals). Compiling both in one program yields
   `duplicate identifier` between DOM and worker types; `typecheck` runs both.
   Cloudflare bindings are declared once in `env.d.ts`.
3. **Non-hibernating accept** (`server.accept()`). The room's `Y.Doc` is memory-only
   until story 4; hibernation would evict the object while sockets stay open and
   silently lose the document. An open accepted socket keeps the DO alive.
4. **Awareness is relayed verbatim to all sockets, including the sender**, and never
   interpreted. The echo back to the sender is the only inbound traffic on an idle
   board and is what keeps the provider's 30s no-message reconnect timer from
   firing; `connectBoard` gives the awareness a non-null local state so the
   provider re-advertises it (y-protocols does this every ~15s) and the room echoes
   it back (TC-29). Interpreting awareness is story 6.
5. **Accept-time SyncStep1 from the server.** On every (re)connect the room sends its
   own SyncStep1; each client answers with the state it holds, so after a Worker
   restart the first reconnecting client repopulates the room (no loss while one
   person keeps the board open).
6. **No echo to the author.** Each update is broadcast to every socket except the one
   it came from (the socket passed as the transaction origin), so an author learns
   its own edit only by applying it locally, as the design specifies.
7. **A real text-editor bug was found and fixed.** `StickyTextEditor` wrote local
   keystrokes to `Y.Text` but never observed *remote* `Y.Text` changes, so under
   concurrent typing the next local keystroke's minimal diff deleted the peer's
   characters (observed on Firefox/WebKit as `AABB` instead of `AAAABBBB`). It now
   refreshes the textarea on remote changes (skipping its own writes and IME
   composition), keeping the caret the same distance from the end. This is a
   story-3 integration requirement (TC-23), not a story-2 regression.
8. **`mapConnectionState` is a pure function** over a minimal `ConnectionEmitter`
   interface, so the badge state machine is unit/component-testable with a fake
   emitter and fake timers, with no `WebsocketProvider` at module-evaluation time.

## Test decisions

- **Deterministic socket drop/restore.** Playwright's `context.setOffline(true)` does
  not reset an already-open WebSocket, so the provider would not notice a dropped
  link until its own 30s watchdog. e2e drives the *same* provider disconnect/reconnect/
  resync path through `__drop`/`__restore` test hooks (`provider.disconnect()`/
  `connect()`), which is both deterministic and exercises the real path (TC-27).
- **Page-side state logs.** The mapped `ConnectionState` is a plain JS value a
  MutationObserver cannot watch, so `registerConnectionState` records every change
  into a deduplicated `window.__vidi6.__stateLog`; the idle test slices it and
  asserts it never left `connected` between poll samples.
- **The soak places notes on a grid and caps the live count**, so peers' notes never
  pile on one spot (which made a selected note's colour button unclickable) and
  never drift off-screen (moves are absolute). `recolourNote` force-clicks its
  swatch so overlap can never block the run. Latency is measured per change and
  reported (p50/p95/max) but never asserted, because model, browsers and server
  share one machine.
- **Nightly tests are excluded from `npm run test:e2e`** via `--grep-invert @nightly`
  and run by `npm run test:e2e:nightly` (Chromium, 240s per-test timeout).

## Environment notes (story 3)

- **`test:integration` builds first** (`vite build`) because the workerd pool serves
  the built client; the integration `env.d.ts` supplies worker types.
- **`VITE_COLLAB_ENDPOINT` is unset in e2e**: the client derives the room URL from its
  own origin (`ws(s)://host/api/rooms`), so the e2e `wrangler dev` server (which
  serves the built client AND runs the Worker/DO) is the whole stack.

---

# Story 4 — return to a board and find everything as it was left

## What is here (story 4)

- `src/worker/board-store.ts` — the room's own storage: its schema (created at
  `migrate()`, versioned row in `storage_meta`), append, load, and chunked
  compaction. Takes a structural `BoardDatabase` (not the global
  `DurableObjectStorage`) so it compiles in the DOM tsconfig program and unit-tests
  against a fake.
- `src/worker/room-state.ts` — the room's six states and `nextRoomState`, pure, no
  SQLite, sockets or clock.
- `src/worker/board-room.ts` — hibernation accept, one storage write per update,
  refusal while a board cannot be read, the retry of a load.
- `src/worker/test-hooks.ts` (+ routing in `index.ts`) — `diagnostics`,
  `corrupt-snapshot`, `repair-snapshot` under `/__test/boards/:boardId/*`, answered only
  when `TEST_HOOKS=1`, which nothing but `WranglerProcess.start({ testHooks: true })` in
  the e2e harness ever sets (the integration tests reach the same objects through
  `runInDurableObject` and SQL directly, and need no route).
- `src/client/sync/connectBoard.ts` — `load_failed` in `ConnectionState`, `canEdit`,
  `CloseEventLike`.
- `ConnectionStatus.tsx`, `App.tsx`, `Toolbar.tsx`, `StickyNote.tsx`, `styles.css` —
  the message and the edit lock.
- tests: unit 120, component 93, integration 52, e2e 84 (+3 `@nightly`).

## Deviations from the design's file list

1. **`src/worker/room-state.ts` is an extra file.** The design keeps the room's states
   in prose (its own state diagram) and in `board-room.ts`. "A storage failure is not a
   load failure" and "an unreadable board refuses connections" are decisions about the
   *same* state, so the state lives in one module: `RoomState`, a `RoomEvent`
   discriminated union, `nextRoomState`, `isServing`, `mayRetryLoad`. Pure, so the whole
   table is unit-tested (TC-27) with no SQLite, no sockets and no fake clock, and the
   room itself holds no state decision that a test cannot reach.
2. **`src/worker/test-hooks.ts` is an extra file, and `src/worker/index.ts` is modified
   without being listed.** A test cannot break a stored snapshot without a way in, and
   `repair-snapshot` has to exist in the same place so a broken board is shown recovering
   rather than only broken. Every route is answered only when `env.TEST_HOOKS === '1'`,
   which the production configuration never sets; an e2e test asserts that a server
   started without it serves the SPA HTML for those paths instead.
3. **Three client files are modified beyond the list**: `objects/StickyNote.tsx`
   (`editable`, so a note on a board that cannot be saved does not take a pointer),
   `board/Toolbar.tsx` (`disabled` + `disabledReason`), `styles.css`. Gating `App.tsx`
   alone leaves a note that looks editable and a toolbar button that says nothing about
   why it does nothing.
4. **`BoardStore` takes a structural `BoardDatabase`, not `DurableObjectStorage`.**
   The type is what the store actually uses (`exec`, `transactionSync`), so the store
   compiles under the DOM tsconfig program and unit-tests against a fake (TC-01, TC-02),
   while the integration tests give it the real thing.
5. **Test files the list implies but does not name**: `tests/unit/board-store-chunks.test.ts`,
   `tests/unit/room-state.test.ts`, `tests/integration/board-store.test.ts`,
   `tests/integration/board-room-persistence.test.ts`, `tests/integration/helpers/store.ts`,
   `tests/integration/helpers/room.ts`, `tests/component/BoardLoadFailure.test.tsx`,
   `tests/e2e/persistence.spec.ts`, `tests/e2e/helpers/wrangler-process.ts`.

## Implementation decisions

- **The hibernation API is in use**, which supersedes story 3's deviation 3:
  `ctx.acceptWebSocket(server)`, `ctx.getWebSockets()`, and the class-level
  `webSocketMessage` / `webSocketClose` / `webSocketError`. It works in the vitest
  workerd pool too: `runInDurableObject` reaches the instance,
  `state.getWebSockets()` hands back `SerializableWebSocket` stubs, and a test can
  deliver a frame by calling `room.webSocketMessage(ws, data)` from inside the object,
  which is how a hibernation-shaped wake is exercised (TC-18).
- **The load runs in the constructor inside `ctx.blockConcurrencyWhile`, as the design
  has it**, so nothing is served and no socket accepted before the board is back in
  memory. `admit()` — called from `fetch` before the upgrade — owns the *other* edges
  into `loading` (a retry after a load failure, a wake after a storage failure) and
  `load()` asserts it was entered in `loading`, so the room never presents a board it
  has not read. Story 3's `room.doc` stays public for its integration tests but is now
  `Y.Doc | null`.
- **`ctx.waitUntil(store.pending())` before a socket is accepted**, so an update that
  arrives seconds after a socket opened is in storage before the room repeats it to
  anybody else (TC-12); without it a room hibernated mid-write loses exactly the change
  another client was told about.
- **Two failures, two behaviours, as the design's error list states.** A board that
  could not be *read* has nothing to serve: its sockets are closed with 4500, upgrades
  are refused outright (a `WebSocketPair` accepted and closed immediately, 101 returned,
  so the client's own retry loop keeps working), and the next attempt is allowed only
  after `LOAD_RETRY_MIN_INTERVAL_MS`. A board that could not be *written* is not called
  unreadable: every socket is closed with `CLOSE_STORAGE_FAILURE` (1011), the document
  is discarded — the room will not keep serving from memory it could not save — and
  because 1011 is outside the 4xxx range every provider reconnects at once and re-sends
  what the room lacks. 4500 sits in y-websocket's "retry anyway" band (4500-4599) rather
  than in the 4400-4499 band the provider treats as permanent: a board that had one bad
  moment must not be left broken because the client stopped trying.
- **Quarantine is not a report.** The design gives it no surface, so there is no table,
  no counter and no field in `diagnostics()`: the unreadable row is skipped and logged
  (`board_load_quarantined`, and `quarantined` on the `board_loaded` line), which is what
  the integration tests capture and assert (TC-08, TC-09, TC-25).
- **`load_failed` on the client is sticky**, cleared only by a successful sync and not
  by the provider's `status: connecting`. The retry is the provider's and comes every
  200 ms to 10 s; a badge that followed status would flicker `Reconnecting…` over a
  board that is still unreadable. `canEdit(state)` (exported next to the state) is the
  single gate `App`, `Toolbar` and `StickyNote` consult.
- **`BOARD_LOAD_FAILED_MESSAGE`** lives in `src/shared/protocol.ts` as the single source
  of the design's exact sentence; one component test reads the constant and another
  pins the literal string, so changing the constant cannot move the message unnoticed.
- **The overlay is `pointer-events: none`.** It is a notice over the board, not a
  dialog: it must not swallow the double-clicks and pans of the board underneath it
  (it did, and an e2e test timed out on a double-click that never arrived).

## DO SQLite facts (story 5 and 13 will want these)

- `state.storage.sql.exec`; every write statement commits by itself, so a pair of
  writes needs `sql.transactionSync(fn)` — and `transactionSync` allows no `await`.
- A cursor must be consumed to the end before the next write in the same transaction;
  the code materialises rows with `[...]` first.
- A blob parameter must be a `Uint8Array` (binding an `ArrayBuffer` is rejected);
  reads come back as `Uint8Array`/`ArrayBuffer` and are copied on the way out.
- The pool gives DO SQLite from the `new_sqlite_classes` migration already declared
  inline in `wrangler.jsonc` (`v1`); no `migrations_dir` is needed, because
  `BoardStore.migrate()` creates its tables with `CREATE TABLE IF NOT EXISTS`.
  The pool's bundled workerd caps `compatibility_date` at `2026-08-22`.

## Test decisions

- **`beforeStatement` on `BoardStore` is the seam that makes SQL fail where it really
  runs.** A test sets `store.beforeStatement = (sql) => {…throw…}` for one statement
  matched by pattern (TC-14's mid-compaction failure, TC-26's load read failure); the
  armed flag disarms itself *before* it throws, so the room can recover immediately
  after the one failure the test wanted.
- **`runInDurableObject(stub, (instance, state) => …)`** passes `DurableObjectState` as
  the second argument and takes no extra parameters, so room helpers cannot thread
  arguments in; `onRoom` casts through `unknown`/`never` because the generic is not
  tied to `BoardRoom`.
- **"no reload was attempted" is proved by a number that only goes up**:
  `sinceLoadFailureMs` strictly increasing across refused connections. Any new load —
  successful or not — resets `loadFailedAt` and would drop it to ~0.
- **The e2e harness starts its own `wrangler dev`** (`WranglerProcess`), one state
  directory per test under `tmp/` (gitignored), and `restart()` reuses the directory
  and both ports so the address is unchanged. Ports come from two separate
  `freePort()` calls: `port + 1000` walks out of the address range when the OS hands
  out a high port (observed as workerd's `parseAddress: Port number too large`).
- **`storedByRoom` is what a test does before it kills the process.** A second page
  that has come to hold the same content proves the room wrote it down, because the
  room stores before it repeats; a page compared with itself proves nothing, since a
  page always holds what it was just typed.
- **`__createNotes` is async on purpose.** A page merges everything it changed in one
  turn of the event loop into a single update, so the hook lets a turn pass between
  edits; without that, TC-21's 560 notes reach the room as one message and a test
  about the update log has no log to test.
- **Measured on this machine, for future reference**: TC-21 compacts mid-use at the
  500-row threshold (diagnostics `updates: 60, snapshotThrough: 500`); a 2000-note
  board stores ~389 KB. TC-20 logs its own number (`[load] 2000 notes on screen:
  121ms (budget 3000ms)`) in the same shape as story 3's `[latency]` lines, and reports
  120-170 ms here. It is the one timing the suite *asserts*, because the design's
  "open within `BOARD_LOAD_BUDGET_MS`" is that case's expected outcome: without the
  assertion the case would only prove the board eventually arrives.
- **`playwright.config.ts` gives the persistence file its own projects**
  (`persistence-chromium`, …), listed after the browser projects, and
  `test:e2e:nightly` runs `chromium` *and* `persistence-chromium`. The order is
  scheduling only — those projects deliberately have no `dependencies`, because a
  dependency would both re-run the depended-on projects and skip these 12 tests when
  an unrelated test fails. Story 1 and 3 tests assert convergence within 1000 ms and
  pixel offsets within 1 px; a machine running enough workerd runtimes and browsers at
  once makes them miss, and a failure that depends on what else is running says nothing
  about the product.
- **This repo has no prettier configuration**, and prettier's defaults (80 columns,
  double quotes) disagree with the existing files. Do not run `prettier --write` over
  repo files.

## Known flakiness on this machine

- Firefox logs `sandbox_init(): Operation not permitted` in the e2e output (already
  noted for story 3) - the content process runs unsandboxed, which is why the run still
  works. Two tests were sensitive to how loaded the machine was: story 3's TC-26 (five
  editors dragging notes, a 1000 ms convergence budget) timed out, and story 4's TC-19
  read back a note whose typing had been cut short by the restart. Both are addressed -
  the persistence projects are scheduled apart from the browsers', and a persistence
  test now waits for the room to hold the board before it kills the process - and both
  have passed every run since; neither was made less strict to get there.

---

# Story 5 — share a board with others using a link

## What is here

- `src/worker/board-store.ts` — the creation stamp (`storage_meta.created_at`) and the
  read-only existence question; `ensureMigrated()` for callers that may write.
- `src/worker/board-room.ts` — `initialize()` and `exists()` as Durable Object RPCs,
  and the existence check in `fetch()` before the socket is accepted.
- `src/worker/create-board.ts` (new) — the two-line decision the Worker makes: ask that
  id's room whether it made the board, and answer one of `created` / `exists` /
  `create_failed`. Exported separately so a test can hand it a namespace that lies.
- `src/worker/index.ts` — `POST /api/boards`, `GET /api/boards/:boardId`,
  `Allow`-carrying 405s, and `/api/rooms/:boardId` now 404ing a malformed id.
- `src/worker/test-hooks.ts` — `POST /__test/boards/:id/seed-legacy`: makes a board out
  of rows alone, with no stamp, so the "board made before links existed" test is real.
- `src/client/api.ts` — `createBoardRequest()`, `checkBoard()`; both answer, neither
  throws.
- `src/client/router.ts` (new) — `routeFor()`, `useRoute()`, `navigate()`, `boardPath()`.
- `src/client/pages/` (new) — `state.ts` (the board page's state machine), `HomePage`,
  `NotFoundPage`, `BoardPage` (which holds the existence check and the `Connecting…`
  screen).
- `src/client/share/SharePanel.tsx` (new) — the Share button, the panel, the link field,
  the copy button and the manual-copy fallback.
- `src/client/App.tsx` — renders the router, or the board a component test injected.
- `index.html` — `<meta name="referrer" content="no-referrer">`.
- Tests: `tests/unit/create-board.test.ts` (TC-04), `tests/integration/board-api.test.ts`
  (TC-05…TC-15), `tests/component/pages.test.tsx` (TC-16…TC-21),
  `tests/component/SharePanel.test.tsx` (TC-22…TC-25), `tests/e2e/share.spec.ts`
  (TC-26…TC-29, TC-31); existing e2e specs updated for the routes.

## Implementation decisions

- **`wrangler.jsonc` is unchanged.** The design asks that `compatibility_date` be at or
  after 2024-08-21 for RPC; the repo is already at 2026-08-01. It was left alone rather
  than pinned backwards.
- **Existence is answered without an RPC.** `BoardRoom.exists()` is the RPC the design
  names, and it exists — but the Worker's own `has()` (story 2) was rewritten to answer
  from the room's in-memory state and, when that is silent, from whether SQLite has an
  `updates` table (`hasOwnedTable()`). This matters because of what else is in
  `storage_meta`: `migrate()` inserts `schema_version`, so a board whose snapshot cannot
  be read would look *created* to a check that looked at `storage_meta`. The rule the
  store follows now is **"the tables are there ⇒ someone wrote here ⇒ it is a board"**,
  and `existsReadOnly()` asks only "is the stamp there".
- **`load()` no longer migrates.** `BoardStore.load()` used to call `migrate()` first,
  which meant *asking* about a board created its tables — exactly what TC-07 forbids.
  `migrate()` now happens in `append()` (the only writer) and in `ensureMigrated()`, which
  the seeding hook and the test hook call before they write or read the stamp.
- **`initialize()` returning `exists` for a fresh id is `create_failed` (500)**, not a
  retry, as the design says. A board that is already there for an id we just generated
  means something is wrong with ids or with storage, and handing over a stranger's board
  would be worse than a 500.
- **`boardExists()` in the room swallows SQL errors and returns `true`.** A read that
  fails is not evidence a board is absent; the load path is the thing that knows, and it
  answers 4500 truthfully. Telling a person "Board not found" over a storage hiccup is
  the failure mode PRD AC-6 is about.
- **Test hooks are routed before the existence check** in `fetch()`, because a legacy
  board seeded by `seed-legacy` has no stamp and would otherwise be impossible to seed.
- **`nextBoardPageState()` takes a fourth argument, `boardId`.** The design sketches
  three; `BoardPageState.ready` carries `boardId: string`, so the transition function has
  to be given it. Nothing else about the shape changed.
- **Error wording** (the design gives states, not sentences): *"Could not create a
  board. Check your connection and try again."* and *"Cannot reach vidi6. Check your
  connection."* — different sentences for different causes, neither a dead end, as PRD
  AC-8 requires. The not-found page offers a working board in one click.
- **`useCreateBoard()` lives in `HomePage.tsx` and `NotFoundPage.tsx` imports it**, so the
  two "New board" buttons cannot drift into different behaviour - TC-19's "it is the
  normal creation flow, not a special one" is true by construction.
- **`BoardScreen`** (the viewport + toolbar + share button, wrapped in the camera
  provider) is exported from `BoardPage.tsx`; `App.tsx` renders it directly when a test
  injects a document. The existing `tests/component/helpers.tsx` (`renderApp(doc)`) keeps
  working unchanged, which is the point: no existing component test was edited.
- **Referrer policy** went into `index.html` (the design's first choice), as a meta tag —
  it needs no plumbing and it is asserted by a test that reads the built HTML (TC-32).
  No `Content-Security-Policy` header was added; story 13 owns that.
- **`/api/rooms/:id` with a malformed id is now 404** (it was 400, story 2). That is what
  the design's line 318 and TC-09 require, and it is the same answer the board route
  gives. `worker-routing.test.ts` TC-04 and `boot.test.ts` were updated to expect 404;
  nothing else about those tests changed.
- **`armLoadReadFailure`'s blocked statement** (`FROM storage_meta`) now matches two
  statements — the load and `existsReadOnly()`. Both go through the room's `load()`, so
  the existing story-4 test behaves the same way for the same reason.

- **Two names from the design's table were not made into files.** `Share.tsx` would have
  been a pass-through around `SharePanel` (the board page already knows the board id and
  the origin), and `useCopyToClipboard` is ten lines used once, so it is a state machine
  inside `SharePanel.tsx` - the file the design's own description of `SharePanel` already
  describes. Everything else in the table is a file of its own.
- **Board creation is not auto-run on `/`.** The design says so ("a board is not created
  until the visitor asks"), and the redirect-free shape is what makes TC-16's
  "no board was created" checkable: a test can ask the service afterwards and get 404.

## Verification

`npm run build`, `npm run typecheck`, `npm run test:unit` (127), `npm run
test:integration` (70), `npm run test:component` (116), `npm run test:e2e` (99, three
browsers plus the persistence and nightly projects) and `npm run test:e2e:nightly` (3) all
pass. Two full `test:e2e` runs in a row were clean.

## Clipboard facts (measured here, not looked up)

`tests/e2e/share.spec.ts` grants permissions rather than assuming them, because the two
browsers that have a clipboard disagree:

| browser | what works | what happens otherwise |
| --- | --- | --- |
| Chromium | `permissions: ['clipboard-read', 'clipboard-write']` | `writeText()` throws (NotAllowedError) |
| WebKit | `permissions: ['clipboard-read']` **only** | granting `clipboard-write` too makes `context.newPage()` throw |
| Firefox | no grant can make it work | `context.grantPermissions(['clipboard-read'])` itself throws |

So TC-27/TC-29 run in Chromium and WebKit, and Firefox is skipped with that sentence as
the reason. The grant list is *probed* on a throwaway context (`clipboardGrant`) rather
than hard-coded, so a browser that changes its mind fails loudly instead of mysteriously.
TC-29 runs in all three: it removes `navigator.clipboard` with an init script, which is
the panel's problem to survive, not the browser's.

## Test decisions

- **No jest-dom in this repo**, and none was added: component and e2e tests assert with
  `textContent`, `value`, `disabled`, `count` and `getAttribute`, and click by accessible
  name (`getByRole('button', {name})`), which is also what the tests assert about.
- **vitest 4 needs `vi.hoisted(() => {...})`** (a factory, not an object literal) — the
  first draft of `pages.test.tsx` failed with *"factory value must be function, received
  object"*.
- **TC-21's clock** is advanced with `act(async () => vi.advanceTimersByTimeAsync(1000))`.
  A synchronous `advanceTimersByTime` leaves the retry's promise continuation — and so
  React's re-render — unpumped, and the test then fails on a screen that has already
  moved on.
- **TC-08 asserts a note's `colour`, not its `x`.** `createSticky(doc, {x: 12, y: 34})`
  stores the *centre*, so `objects.get(id).x` is `12 - STICKY_SIZE_WORLD/2` = -88:
  asserting 12 would assert a misunderstanding of the model, not a regression.
- **TC-31 does not use the test hooks** even though it is a persistence-style test: the
  globally-served dev server runs without `TEST_HOOKS` (as it should in production), and
  this test's assertion is that *the room's own load path* accepts a board with rows and
  no stamp. It writes with `runInDurableObject` and reads with the socket helpers, both of
  which are how the product does it. The hook's own behaviour is tested in
  `board-api.test.ts`, which calls `handleTestHook` with a target built the way the room
  builds one — `TEST_HOOKS` is a deployment switch the integration environment does not
  set, and switching it on globally would mean testing a configuration nobody ships.
- **TC-28 opens four of the hundred pairs of boards**, not all hundred. All hundred
  creations are checked (201, unique ids) and all hundred are asked about afterwards; the
  content-isolation check is sampled because opening two hundred pages is minutes of
  waiting that proves nothing the four pairs do not. The `Content[]` comparison includes
  each note's `clientId`, so a page's own unsynced state can not masquerade as the other
  board's content.
- **After a reload, tests wait for content, not for the page.** `waitForSyncReady()` only
  proves the test hook function exists on the new document; the board's content arrives
  some milliseconds later. TC-29 and TC-31 use `expectNoteWithText()`, which polls. Its
  budget (`RELOAD_SYNC_MS`, 30 s) is a page load under the load of the whole suite; the
  timings the product promises are asserted in `live-collaboration.spec.ts` and
  `persistence.spec.ts` against their own budgets.
- **`live-collaboration.spec.ts`'s TC-26 got `test.setTimeout(60_000)`.** Five pages ×
  five notes plus a drag on each runs past 30 s of *mouse* time when the whole suite is
  running; the test's own convergence measurement logged 4.5-6.7 s against its 1000 ms
  budget on this machine before story 5, and the file's siblings (`navigation.spec.ts`,
  `persistence.spec.ts`) already raise wall-clock for the same reason. No assertion was
  changed, relaxed or removed - the 1000 ms figure is logged, not asserted.

---

# Story 7 — Select, move, resize and delete several objects at once

## What is here (story 7)

- `src/shared/geometry.ts` (new) — pure rect maths: `Rect`/`Point`, `HANDLES`,
  `rectContains` (entirely-inside), `unionRects`, `normalizeRect`,
  `resizeRect` → `clampScale` → `anchorBox` (the resize pipeline),
  `scaleWithin`, and the generic `objectBounds`.
- `src/shared/board-model.ts` — the group operations: `moveObjects`,
  `resizeObjects`, `bringObjectsToFront`, `deleteObjects`, `objectsInRect`,
  `allObjectIds`, `readableObject`, `KNOWN_OBJECT_TYPES`; sticky notes now
  persist `width`/`height`. The single-object wrappers are rewritten on top of
  the group ones, so story 2's behaviour is the same code path.
- `src/client/objects/registry.tsx` (new) — object types by name:
  `registerObjectType` (duplicates throw), `getObjectType`, `componentFor`,
  `registeredTypes`, `hitTestObject`; sticky is the one registration.
- `src/client/board/useSelection.ts` — rewritten as a `Set` reducer
  (`click`/`toggle`/`setMany`/`clear`/`prune`/`edit`) over
  `{ ids: ReadonlySet, editingId }`; story 2's single-select and edit
  behaviours are cases of it.
- `src/client/board/useTransformGesture.ts` (new) — group move and group
  resize from window-level pointer listeners; selection decides the subject at
  pointerdown; `isPressed()` answers "this press already picked".
- `src/client/board/useMarquee.ts`, `SelectionOverlay.tsx`, `SelectionBar.tsx`,
  `useBoardKeys.ts` (new) — shift-drag box selection, the eight handles, the
  bar (count, front, delete), and Ctrl/Cmd+A / Escape / arrows / Delete / Enter.
- `src/client/pages/BoardPage.tsx` — wires them, renders objects through the
  registry. `BoardViewport.tsx` — the marquee path (shift held, so no pan).
- `StickyNote.tsx` — `onGesturePointerDown` (delegate to the board's gesture),
  `single` (toolbar only for a lone selection), `dragging` from the board, and
  the new `onFocusNote` (below). `StickyTextEditor.tsx` — measures a stored
  `boxWorld`, not only the default square.
- Tests: `tests/unit/geometry.test.ts` (TC-01…07,15…),
  `tests/unit/board-model-group.test.ts`, `tests/unit/registry.test.ts`,
  `tests/unit/selection-reducer.test.ts`, `tests/helpers/yjs.ts`,
  `tests/component/Selection.test.tsx` (TC-16…31),
  `tests/e2e/selection.spec.ts` (TC-32…36).

## Implementation decisions

- **The resize pipeline is three pure steps.** `resizeRect` turns a handle and
  a pointer delta into a target box, `clampScale` clamps the resulting per-axis
  scales against every member's minimum and the global maximum, and
  `anchorBox` rebuilds the final box from the clamped scales — a second
  `resizeRect` with the clamped numbers would sign-multiply the w/n handles.
  The aspect lock applies to corner handles only (dominant axis wins); an edge
  handle scales its one axis whatever the type's aspect flag says, which is
  what TC-24's "edge handle changes width only" states.
- **`rectContains` means entirely inside**: touching from outside is out,
  touching while inside is in (TC-07's table). The marquee unions with the
  current selection — shift is both the trigger and the "add".
- **Group operations read any readable Y.Map** (finite x/y/z, string type),
  not only sticky-readable ones, and skip ids that are missing or unreadable
  (TC-05, TC-08); a non-finite position rejects the whole `moveObjects` call
  without a transaction (TC-09). `bringObjectsToFront` sorts the selected by
  (z, id) and stacks them above `maxUnselectedZ` in that order, so a group
  front is deterministic across clients.
- **The gesture's subject is decided once, at pointerdown**: down on an
  unselected object selects it alone; down on a member of a group defers —
  moving drags the group, releasing without moving collapses to that one.
  Bring-to-front happens once, on the frame the drag crosses its threshold.
- **`selection` in the design's gesture contract is the reducer state**, and
  `snapshot` is the sticky snapshot list; `ObjectSnapshot` (board-model) is
  what `objectBounds` consumes, so the gesture is type-agnostic already.

## A real bug the browsers found: focus is not a selection command

A real browser **focuses the note a mouse-down lands on** as that pointerdown's
default action; `StickyNote`'s story-2 `onFocus` then called `onSelect(id)`,
which replaced the selection the gesture had made microseconds earlier — a
three-note group collapsed to one the instant its member was grabbed. jsdom
never focuses on mousedown, so every component test missed it. The fix is
`onFocusNote`: the board decides what a focus means, and selects only when
`useTransformGesture.isPressed()` is false. `isPressed` covers both halves of
the pointerdown's own bookkeeping: the press itself (group drags), and a
`selectionHandledRef` marker for presses that only toggle (shift-click), which
a `setTimeout(0)` clears — a macrotask, because Blink runs microtasks *before*
an event's default action, and a `queueMicrotask` clear lost the race in
exactly the way the first fix did. Tab (the focus with no pointer) still
selects, which is what story 2's keyboard tests assert.

## Two more real bugs the e2e found

- **The resize handles were misplaced in the product, not the test.**
  `SelectionOverlay` positioned its handles with *viewport* coordinates inside
  the already-positioned selection box, so every handle sat one box-size away
  from its corner. jsdom reports no layout, so only the e2e caught it — and it
  caught it as a group drag (the mouse landed on the note under the misplaced
  handle), which is how the fix's regression test reads.
- **TC-33 resizes inward.** Pulling the northwest handle by the box's own size
  *grows* the box (the southeast corner is the anchor), and the doubled box
  ends outside the window; firefox and webkit clamp pointer coordinates that
  leave the viewport, so the drag scaled 1.6× there and 2× in chromium. The
  case now halves the box by pulling inward — same geometry proved, and every
  pointer coordinate stays inside the window.

## Deviations and decisions

1. **TC-34 is the nudge case, not a sixth-client case.** The design's table
   has TC-34 as "arrows move selection without page scroll or board pan;
   Delete removes all", and this suite follows the table. (There is no
   capacity refusal to test either: the room has never counted participants —
   story 3's `live.over_capacity` accepts a sixth like anyone else.)
2. **TC-36 runs in chromium only.** Headless firefox/webkit on macOS route
   *concurrent* native mouse input to whichever window holds OS focus, so five
   parallel `page.mouse` streams land in whichever windows happen to be
   frontmost (measured: all five pages converged on a document where one
   window's mixed drags had moved one note — the browsers were never the
   five mice the test asks for). The property under test — different editors
   transforming different objects, one final document — is a document
   property, and `test.skip` names it as a harness limit rather than muting
   the case silently.
3. **`tests/e2e/helpers/live.ts` grows optional `width`/`height` on
   `Content`** so resize cases can read sizes; the byte-comparison helpers
   sort and stringify them like any other field, so convergence checks got
   stricter, not looser.
4. **`TYPE_STICKY` and the new sizing settings live in
   `src/shared/config.ts`** (story 1's note: config is the place for new
   settings): `HANDLE_SIZE_PX`, `STICKY_MIN_SIZE_WORLD`,
   `MAX_OBJECT_SIZE_WORLD`, `NUDGE_STEP_WORLD`, `NUDGE_LARGE_STEP_WORLD`.
5. **Sticky notes keep their internal drag when rendered without the board's
   wiring** (`onGesturePointerDown` absent): `BoardLoadFailure.test.tsx`
   renders a bare note and drags the document through it, and story 4's
   "an unreadable board takes no edits" needs the note-level gate too.
6. **The selection bar appears for two-or-more**, names its count exactly
   ("2 selected"), and the only strings are "Bring to front" /
   "Delete selection"; while one object is selected the note's own toolbar
   stays, and while editing anything the overlay hides (a caret, not handles).

## Test decisions

- **Red phase observed**: the four new unit files were written against
  stub modules first (functions `throw new Error('not implemented')`), and
  54 of the 74 unit cases failed before the implementations landed.
- **Component tests convert world↔screen through the real camera maths**
  (`initialCamera()` reads `resetCamera(boardSize())`) instead of hard-coding
  512/384; notes are addressed by `data-note-id`, because `bringToFront`
  reorders z and DOM paint order under a fixed index.
- **TC-26 drives its drag with `act` per event**: React batches a fully
  synchronous drag's begin and end into one render, and a MutationObserver
  counting `data-dragging` transitions would see the drag never happen.
- **TC-32 keeps the shift-click that exposed the focus bug** (two clicks in,
  one click out, counts 2 → 1) so the exact sequence that broke in real
  browsers is now a permanent case, on all three browsers.

## Verification (story 7)

`npm run typecheck`, `test:unit` (175), `test:integration` (70),
`test:component` (134) and `test:e2e` (112 passed, 2 skipped — the TC-36
chromium-only note above) all pass; the selection spec is green in chromium,
firefox and webkit (TC-32, the case the tasks require in all three, included).

---

# Story 9 — Write free text anywhere on the board

## What is here (story 9)

- `src/shared/config.ts` — the text settings the design names: `TYPE_TEXT`,
  `TextSize`/`TEXT_SIZE_ORDER`/`TEXT_SIZES`/`TEXT_SIZE_OPTIONS`,
  `DEFAULT_TEXT_SIZE`, `TEXT_LINE_HEIGHT`, `TEXT_MAX_AUTO_WIDTH_WORLD`,
  `TEXT_MIN_WIDTH_WORLD`, `TEXT_MAX_CHARS`, `TEXT_FONT_FAMILY`.
- `src/shared/objects/text.ts` — the text model: `createText`, `setTextSize`,
  `setTextWidthFixed`, `setTextWidthAuto`, `setTextBox`, `getTextContent`,
  `isEmptyText`, `deleteIfEmpty`, plus the read side (`readText`,
  `textSnapshot(s)`, `TextSnapshot`) and `textLineHeight`/`asTextSize`.
- `src/shared/text-edit.ts` — `clampToLimit` and `applyTextDiff`, lifted out of
  `StickyText.ts`, which re-exports them with `STICKY_TEXT_MAX_CHARS` so every
  story 2 caller and test is unchanged.
- `src/client/objects/textLayout.ts` — `layoutText`, `createCanvasMeasurer`,
  `estimateTextWidth`, `Measurer`. Pure: the measurer is an argument.
- `src/client/objects/useTextBoxSync.ts` — `remeasureTextBox` (the one place that
  writes a box), one measurer shared by the whole board, the hook.
- `src/client/objects/TextEditor.tsx` — the caret, generalised: limit, font,
  width, `fit`, `onInput`, `onEnd`, test ids. `StickyTextEditor.tsx` is now a
  thin wrapper that supplies a sticky's numbers: the 18 editor tests story 2
  left are unchanged and pass against it.
- `tests/component/Toolbars.test.tsx`, `tests/e2e/sticky-notes.spec.ts` and
  `tests/e2e/helpers/live.ts` were updated in one string each: the design's
  tool_ui contract renames the story 2 sticky button's accessible name to
  "Sticky note (N)", so every selector that named the old label names the new
  one. No assertion was changed.
- `src/client/objects/TextObject.tsx`, `src/client/objects/TextToolbar.tsx`.
- `src/client/board/useTool.ts` — `Tool`, `useTool(canEdit)`, `toolForKey`.
- Changed: `Toolbar.tsx` (Select/Text buttons, `aria-pressed`, "Sticky note
  (N)"), `useBoardKeys.ts` (V/T/N, Escape backs out of a tool first),
  `BoardViewport.tsx` (the Text tool's layer), `SelectionOverlay.tsx` (a
  `handles` prop), `useTransformGesture.ts` (a side handle on a text drags its
  width; a group resize remeasures the texts in it), `useBoardDoc.ts` (objects
  are stickies *and* texts), `useSelection.ts` (it only ever needed `.id`),
  `registry.tsx`, `BoardPage.tsx`, `styles.css`, `testHooks.ts`,
  `board-model.ts` (`TYPE_TEXT` is a known type; `newObjectId` is exported).
- Tests: `tests/unit/text-model.test.ts` (25), `tests/unit/text-layout.test.ts`
  (16), `tests/component/TextBoxSync.test.tsx` (5), `tests/component/Tool.test.tsx`
  (14), `tests/component/TextObject.test.tsx` (16), `tests/e2e/text.spec.ts`
  (10, three browsers).

## Where the two spec documents disagree, and what won

1. **Padding.** Design's TC-07 says a 'Went well' text comes to "width 90 +
   padding"; the PRD — which is the normative document — says the width *is*
   "equal to its longest line", and its settings list has no padding constant at
   all. There is no padding: `layoutText` returns the measured width of the
   longest line, `.text-body`, `.text-line` and `.text-input` have no padding in
   the CSS, and so the width that was measured is the width the words are drawn
   in. Adding padding to the box without adding it to the measurement would give
   every text object a box that is wrong by that much.
2. **One name for the width cap.** The PRD states 600 board units once; the
   design's prose alternates between `TEXT_MAX_AUTO_WIDTH_WORLD` and a shorter
   `TEXT_MAX_WIDTH_WORLD`. Only the first is exported. Two settings for one
   number is how the two end up meaning different things.
3. **The registry call.** The design writes `registerObjectType('text', {
   Component: TextObject, resizable: true, aspectLocked: false, minSize:
   TEXT_MIN_WIDTH_WORLD, editableText: true, handles: 'horizontal', hitTest })`.
   This build's registry has no `resizable`/`aspectLocked`/`editableText` fields
   — resize comes from the object's box and editing from the component — so only
   the two real ones were added: `minSize` (which the group resize already
   reads) and `handles: 'horizontal'`. Inventing the other three to match a
   sketch would leave settings nothing reads.
4. **Where the pure layout lives.** `layoutText` is pure arithmetic, so the eye
   puts it in `src/shared/`. It is in `src/client/objects/`, where the design's
   own file table puts it, and that is not only tidiness: `src/shared` is
   compiled twice, once with the DOM lib and once without it
   (`tsconfig.worker.json`), and a `Measurer` that talks about
   `CanvasRenderingContext2D` would not survive the second. The schema-level
   `TextWidthMode`, which the Y.Map stores, is in `src/shared/objects/text.ts`
   for the opposite reason — it belongs to the document, not to a browser.
5. **`SelectionBar` was not touched.** Its header comment says it is
   type-blind, and the Text toolbar is the opposite: it knows it belongs to one
   text. The text toolbar therefore renders in its own positioned anchor at the
   same corner of the screen, and shows for exactly one selected text — a group
   still gets the selection bar, which is the only toolbar that can speak for a
   mix of types.

## Implementation decisions

- **The auto-width rule, made exact.** A paragraph measured unwrapped: over the
  600-unit budget → the box is 600 and the paragraph wraps into it (TC-08); at
  or under it → the box is the measured width, rounded up to a whole unit and
  never below `TEXT_MIN_WIDTH_WORLD` (TC-07, TC-09 — a line of exactly 600 stays
  one line). Height is never rounded: `lines × TEXT_SIZES[size] ×
  TEXT_LINE_HEIGHT`, so a one-line 'M' text is 26 units tall, not 26.000004.
- **Words only, never a character.** Wrapping happens at spaces; a word longer
  than the box gets a line of its own and overflows it (TC-10). Cutting
  'migration' into 'migra' + 'tion' to be tidy is worse than a line that sticks
  out, and the e2e asserts the same words come back out.
- **The one case the box and the paint cannot agree on.** A single word wider
  than the box is that case: `layoutText` must not cut characters, so it counts
  one line, while a `white-space: pre-wrap` box breaks an over-long word across
  lines rather than let it run off the board (that is what `pre-wrap` does,
  whatever `overflow-wrap` says). The stored height is then short of what is
  drawn, for a word nobody writes in a 600-unit box at 20 pixels — 40 characters
  of one word. The layout keeps the rule the spec names; the browser does what a
  browser does; the mismatch is written here instead of hidden by making the
  layout agree with one rendering engine.
- **The box is stored, and only the client that changed the text writes it.**
  `useTextBoxSync`/`remeasureTextBox` run on a local keystroke, a size change
  and a side-handle drag — and never on an update that arrived from elsewhere,
  which is why `TextBoxSync.test.tsx` counts box writes on `afterTransaction`
  and expects zero for a remote edit (TC-12, TC-13).
- **What is rendered and what is measured are the same text.** The body renders
  one element per *paragraph* and lets CSS `pre-wrap` break it inside the stored
  width, in the stored font, with the same `TEXT_FONT_FAMILY` and line height
  the layout used. The stored height is the layout's line count for those same
  inputs, so the two agree — and where a question is about the agreement, the
  test asks the screen (see Test decisions).
- **The Text tool holds a layer, not a flag.** `BoardViewport` renders
  `.text-tool-layer` (absolute, inset 0, `cursor: text`) over the world while
  the tool is Text. `onPointerDown` on the viewport only acts when the event
  target *is* the viewport element, so a layer click cannot pan, marquee or
  deselect — and a click that lands on a sticky note creates a text on top of
  it, which is what "write anywhere" needs. The wheel is a native listener on
  the viewport, so it bubbles up from the layer and panning and zooming go on
  working under the tool (there is an e2e for exactly that).
- **The layer steps aside for a caret.** `BoardPage` hands the viewport
  `tool = editingId === null ? tool : 'select'`: while the caret is in an object
  there is nothing to place, and a layer over an open editor would swallow the
  click that finishes it. The toolbar keeps showing the tool that is *held* —
  TC-17 asserts `aria-pressed` on the Text button itself, not merely that the
  layer is gone, so a tool that silently reverted would fail it.
- **Toolbar props are optional.** `tool`/`onTool` are optional on `Toolbar`, so
  every existing call site and story 2 test renders it unchanged; a board that
  does not pass them has one tool.
- **Who created a text.** `BoardContent` makes one id per tab with
  `useState(() => newObjectId())` and passes it as `createdBy`. Story 6 (identities)
  is not in this build; a stable-per-tab id is the honest placeholder, and it is
  the model's `createdBy` field rather than a client's guess at a name.
- **Every model mutation is a `LOCAL_ORIGIN` transaction**, including the ones
  added here. That is not a style point: story 8's undo tracks transactions by
  that symbol, and a text written with a string origin would be invisible to
  undo. (This was a real failure — the first draft of `text.ts` passed `'model'`
  and no undo test could see a text.)
- **A side handle on a text drags its width, and the height follows live.** For
  one text and handle `e`/`w`, the gesture writes `setTextWidthFixed` and then
  remeasures, every frame; the `w` handle anchors the right edge so the text
  does not slide out from under the pointer. A group resize stays generic
  (`resizeObjects`), with fixed widths scaled, auto widths untouched, and the
  texts in the group remeasured once at the end.
- **Two id lists in the press, because they answer two questions.**
  `GesturePress.textIds` is every text in the selection (a group resize needs
  them all, to remeasure), and `sideHandleIds` is the single-text side-handle
  case only. They were one list until a group resize with a text in it left that
  text's height stale — the single-text test never noticed, because it never
  grouped.
- **A text left empty is deleted on edit end** (`deleteIfEmpty` inside the same
  undo window as the typing), so abandoning a text leaves nothing behind, and
  one undo brings the empty object back rather than a board with a stray object
  two steps away (TC-31, and the erase-the-last-character case).

## A real bug the browsers found: two people, one text

TC-29 has two pages type into the same text at the same time. Before the fix the
merged words came out like `Ship li migration plsant: importer` — characters of
both, but scrambled, and sometimes with the other person's characters deleted.

The editor is a controlled `<textarea>`, and a remote change was applied by
setting React state *and* writing `el.value` directly. React keeps its own
notion of what a controlled input's value is, and after an input event it puts
back the value it last *rendered*. A remote change lands on a websocket message,
outside React's hands, so its state update waits for a scheduled render — and a
keystroke dispatched in the millisecond before that render was diffed against
the text *without* the other person's characters in it, which reads as "those
characters are gone" and deletes them.

It is fixed by flushing the update (`flushSync`) instead of scheduling it, so the
field is showing the merged text before the next keystroke is diffed, and by
keeping the caret the same distance from the *end* of the text — a character that
landed further off leaves this caret alone, one that landed on it is typed after
rather than over.

jsdom could not have found this. In a component test everything is flushed
inside `act`, so a keystroke never arrives in the window between the update and
the render; the bug needed a real browser, a real network and a real second
writer. TC-29 is the test for it, and it is run with `--repeat-each=10` before
landing rather than once.

## Test decisions

- **TC-29 asserts what merging actually guarantees.** Two carets in one text
  interleave per character, so the words are *not* in the order anybody typed
  them; what is true is that the text still starts with what was there first,
  and that it holds exactly the characters of both, once each. The test compares
  sorted characters rather than a string, which is the invariant, rather than
  picking an interleaving and calling it the contract.
- **Lines are counted off the paint in the e2e.** `.text-line` elements are
  paragraphs, not lines (see above), so `paintedLines()` selects the range over
  the body and counts the rectangles the browser drew. That is also the only way
  to test that the *stored* height matches the words: the test checks the box on
  screen is the box in the document at the board's own zoom, with a height
  greater than three lines of the font, so a stale measurement fails it.
- **`parseFloat(el.style.width)`, never `Number(el.style.width)`.** jsdom hands
  back the string with its unit, `Number('240px')` is NaN, and a test written
  that way fails for a reason that has nothing to do with the code.
- **Anything that lives in CSS is asserted in the browser.** jsdom never loads
  `styles.css`, so `cursor: text` over the layer and the fixed positioning of
  the toolbar anchor are e2e assertions (`toHaveCSS`), not component ones. The
  component tests assert the layer's *existence*, which is what the component
  decides.
- **`countBoxWrites` compares the stored numbers on `afterTransaction`.** This
  yjs version has no `transact` event and no `.changes` on a `YMapEvent`, and
  comparing `width|height` per transaction is a fact about the document rather
  than about an API that may change under it.
- **`createText` in the e2e takes the new id from the caret's own element**
  (`textarea[data-testid="text-editor"]`, then up to `[data-text-id]`) rather
  than by diffing the document, because diffing answers "which objects appeared"
  and, with five clients creating at once, that is not the question it can
  answer — TC-30 was flaking on exactly that, reporting "expected one new text,
  got 2" when another client's text arrived first.
- **TC-30 is chromium-only**, for the reason already written up for TC-36: five
  browser windows on macOS route native mouse input to whichever window holds
  OS focus. It is skipped with the same harness comment, not deleted.
- **The tool tests press keys on the document and assert `aria-pressed`**, which
  is the state, rather than a class name. TC-18 flips `editable` at the running
  board, because "a board you cannot edit has no tools to hold" is about the
  board changing under you, not about a prop.

## Known flakiness on this machine (story 9)

- Persistence TC-21 failed once, in a full three-browser run, at
  `expect(await connectionState(page)).toBe('connected')` with `confirmed` —
  which is the state the client shows for a moment after a resync, and a board
  that has just compacted has just resynced. Every other connection read in that
  file already polls for the state it names; this one line did not, so it was
  reading a state mid-transition and calling it a failure. It polls now. The
  assertion is the same one ("the page ends up connected"), and it passed every
  time in isolation, before and after; nothing was relaxed.

## Verification (story 9)

`npm run typecheck` (both tsconfigs), `npm run build`, `test:unit` (231),
`test:component` (177), `test:integration` (70, unchanged) and `test:e2e`
(149 passed, 4 skipped — TC-36 and TC-30 in firefox and webkit, both
chromium-only) all pass; the text spec is green in chromium, firefox and webkit
apart from TC-30, for the reason above.

# Story 10 — Draw shapes and connect them with arrows that follow when moved

## What is here (story 10)

**Shared, and it is shared on purpose**

- `src/shared/config.ts` — `TYPE_SHAPE`, `TYPE_CONNECTOR`, `SHAPE_KINDS` /
  `ShapeKind` / `SHAPE_KIND_NAMES` / `DEFAULT_SHAPE_KIND`,
  `SHAPE_DEFAULT_SIZE_WORLD` (160, the click-makes-a-shape size),
  `SHAPE_MIN_SIZE_WORLD` (20), `SHAPE_LABEL_MAX_CHARS` (500),
  `SHAPE_STROKE_WIDTH_WORLD`, `SHAPE_FILL_COLORS` / `SHAPE_STROKE_COLORS` with
  `FillColor` / `StrokeColor` and `DEFAULT_SHAPE_FILL` / `DEFAULT_SHAPE_STROKE`,
  and on the arrow side `CONNECTOR_MIN_LENGTH_WORLD`, `CONNECTOR_HIT_TOLERANCE_PX`
  (6, in *screen* pixels, divided by the zoom wherever it is used),
  `CONNECTOR_STROKE_WIDTH_WORLD`, `CONNECTOR_ARROWHEAD_SIZE_WORLD`,
  `CONNECTOR_DOT_RADIUS_PX`.
- `src/shared/objects/shape.ts` — `createShape`, `setShapeStyle`, `getShapeLabel`
  (a shape's own `Y.Text`, named `label`, never `text`), `readShape`,
  `shapeSnapshot`, `shapeSnapshots`, `shapeRectOf` (the box a drag describes,
  including the "it never travelled, so make it the standard size centred on the
  click" rule) and `shapeSnapshots` for the board's snapshot read.
- `src/shared/objects/connector.ts` — `createConnector`, `setConnectorEndpoint`,
  `detachConnectorsTo`, `attachTarget` (what is under this point, by front object),
  `endpointAtDrop`, `dropEndpointOn` (what a drop *means*, both ends considered
  together), `connectorRects` (every box an end could live on), `connectorSnapshot`,
  `connectorSnapshots`, plus the geometry this module lives on re-exported from
  `../geometry/connector-geometry` (`centre`, `nearestSide`, `sideAnchor`,
  `resolveEndpoints`, `distanceToPolyline`).
- `src/shared/geometry/connector-geometry.ts`, `src/shared/geometry/polyline.ts` —
  the side arithmetic and the point-to-segment distance, with no Yjs in either.
- `src/shared/board-model.ts` — `shape` and `connector` are in `KNOWN_OBJECT_TYPES`
  (so a shape a newer client added is skipped, not a board that cannot be read),
  `deleteObjects` frees the ends that pointed at what it removed, and the schema
  comment says what the two new kinds hold.

**Client**

- `src/client/tools/useActiveTool.ts` — the tool the board is holding, the one place
  that knows `ToolId`, `TOOL_SHORTCUTS` and `toolIdForKey`. `src/client/board/useTool.ts`
  is gone: a hook named for one tool among nine would be the next file someone forgets
  to look in.
- `src/client/tools/ShapeTool.tsx`, `src/client/tools/ConnectorTool.tsx` — the two
  tools that draw, each a layer over the board in screen space, each asking the board
  to make the thing rather than writing it.
- `src/client/objects/ShapeObject.tsx`, `ShapeToolbar.tsx`, `ConnectorObject.tsx` —
  the two new kinds of thing on the board, and the bar that recolours a shape.
- Changed: `Toolbar.tsx` (the Shape button with its kind menu, the Connector button),
  `BoardPage.tsx`, `BoardViewport.tsx` (an `overlay` slot, after everything else in the
  pane), `useBoardKeys.ts`, `useBoardDoc.ts` (the snapshot carries shapes and arrows),
  `useTransformGesture.ts`, `registry.tsx`, `styles.css`, `canvas/testHooks.ts`.

**Tests** — `tests/unit/shape-model.test.ts` (21), `connector-geometry.test.ts` (20),
`connector-model.test.ts` (22), `tests/component/ShapeTool.test.tsx` (10),
`Connector.test.tsx` (9), `useActiveTool.test.tsx` (8), three new cases in
`UndoRedo.test.tsx`, `tests/e2e/shapes.spec.ts` (5) and `connectors.spec.ts` (4), and
`tests/fixtures/checkout-flow.ts`. Every case TC-01 to TC-29 is named in a test title.

## Where the design and the code disagreed, and what won

- **The tools do not touch the document.** The design's `ShapeTool` / `ConnectorTool`
  interfaces take no `doc` while the board's rule is that nothing in React calls a Yjs
  mutation; both tools are written to that rule - `onCreate(spec): void`, and
  BoardPage does the undo boundary, the write and the selection. `ConnectorTool` is
  given a `doc` to *read*, because deciding what is under the pointer is a question
  about the document, and it asks `attachTarget` rather than reach into the map.
- **`onCreate` hears nothing back.** The design says `void` and that turned out to be
  right rather than merely minimal: a shape or arrow the model refused is a thing that
  is not on the board, and the tool has no use for the difference between "refused" and
  "created and already deleted" - it stops drawing either way.
- **`Tool` became `ToolId`, and only four of the nine letters do anything.** 'n' still
  makes a sticky note on the spot, exactly as it has since story 2; 'p', 'i', 'c' are
  tools this build has no component for, and a shortcut that appeared to switch to one
  would be a key that lies. When story 11 arrives it adds an entry to `TOOL_SHORTCUTS`,
  a button and a layer, and touches nothing else.
- **`hitTest` grew two arguments** (`point`, `zoom`) because an arrow's "am I on it?" is
  a distance in screen pixels divided by the zoom. A shape's is the plain box it already
  had.
- **An arrow has no box to drag.** `ObjectHandles` gained `'none'`, which is what the
  connector registers and what makes the selection overlay draw its outline and nothing
  else. Dragging the middle of an arrow means nothing - its place is a question about
  two other objects - so its two ends are draggable and it is selectable by its line,
  and that is the whole of it.
- **`rects` is not a prop.** The design hands `ConnectorObject` a rects map to resolve
  against. It is not given one: the snapshot it *is* handed has its ends resolved
  already, by `resolveEndpoints`, against the document, and a drag - mine or anyone's -
  writes to the document on every move, so the map would be a second copy of a value
  that is never behind the first. `resolveEndpoints` stays exported, and is where the
  side-switching is unit-tested.
- **The detach is written in the delete's own transaction.** `deleteObjects` reads the
  rects first, then deletes and detaches inside one `LOCAL_ORIGIN` transaction, which is
  what makes TC-13's "one update" and one undo step both true.
- **`dropEndpointOn` is the only place that knows what a drop means**, and the
  same-object refusal is enforced twice on purpose: once in the tool, so a drag from a
  shape back onto itself draws nothing, and once in `createConnector` /
  `setConnectorEndpoint`, so an arrow that points at the object at its other end cannot
  exist in a document at all - including one a peer sends.

## Two bugs, both found by a test rather than by reading

- **A shape was being resized as if it were a text.** Dragging a shape's east handle
  moved the handle and left the shape the width it was; the same drag on a text worked.
  `useTransformGesture` decided "this press is a side handle, so it sets a width and the
  box has to be measured again" with `spec.handles !== undefined` - a question story 9
  wrote when `horizontal` was the only kind of handle in the file. Shapes take all
  eight, so they were caught by that test and sent to `setTextWidthFixed`, a function
  that knows only texts and does nothing to anything else. The predicate is now
  `spec.handles === 'horizontal'`, which is the question it was actually asking. A group
  resize still asks for a remeasure of the texts in it (`remeasureTextBox` answers false
  for a shape, so a shape in a group is measured by nobody, which is right), and nothing
  about a note or a text changed - 207 component tests and the whole e2e suite pass
  unchanged apart from the new ones.
- **Shapes and arrows were invisible to Undo.** Every module of story 10 opened its
  transactions with an origin of its own - `'shape:create'`, `'connector:end'`,
  `'connector:detach'` - and the undo stack watches one origin, the board's own symbol,
  because that is how a remote change stays out of your undo history. So nothing that
  story 10 wrote was ever captured: Ctrl+Z after drawing a shape undid whatever you had
  done *before* it. The PRD's line is "creating, restyling, labelling and re-attaching
  are each one undo step", and the three new `UndoRedo.test.tsx` cases say so in the
  browser the app really runs in; they fail on the string origins and pass on
  `LOCAL_ORIGIN`, which `text.ts` and every mutation in `board-model.ts` already use.
  The undo of a delete that freed an end puts the shape back *and* re-attaches the end,
  in one press, because of the transaction the two share.

## Test decisions (story 10)

- **TC-20 asserts state rather than events.** The design's "assert the board's own
  click handler was not entered" cannot be done here: `boardEventsSeen` listens with a
  native `addEventListener` on the viewport, and React's delegation fires at the root
  container after the event has bubbled past the viewport, so a stopped event and a
  missed one look identical to it. The test asks what a person would notice instead:
  the line's `stroke-width` in world units at two zooms (6 screen pixels at both, which
  is the zoom-awareness, measured), selection at 7 pixels on and at 5 pixels off, and
  the board's mode still `idle` after a press 40 pixels from the line inside its own box.
- **TC-27's race is forced by holding the pointer, not by delaying a route.** The design
  suggests a WebSocket route delay on Sam's traffic; holding Dana's pointer down over B
  while Sam deletes achieves the same interleaving with nothing to time out and nothing
  to wait for. The assertion is that the end is *free* at the point where B was and that
  it is stable after both peers settle - not that a `free` end survives a re-attach,
  which is the bug.
- **The world a test clicks has to be in the window.** The board starts with its world
  origin centred, so the camera is (-640, -400) and a scene written at (1200, 400) is
  off the right edge of the screen: Playwright moves the mouse to a clamped position,
  every point of a shape lands inside its own box, `nearestSide` answers with the side
  already facing, and the test reports a wrong side. `screenOf` in the e2e helpers now
  goes through the board's own `worldToScreen`, which is the mapping that was always
  true, and the scenes are laid out around the world origin.
- **`data-arrow-to-x/y`, not the bounding box**, for exact arrow positions: the arrowhead
  is drawn beyond the end point, so the box's right edge is 12 pixels further along than
  the end the document names.
- **TC-27 selects before it presses.** Firefox (Juggler) will not let a page click a
  second time while another page in the same browser holds its pointer down - the click
  is delivered and hits nothing. Selecting B before Dana presses down keeps the race the
  test is about (the delete lands while Dana's pointer is held over B) and takes out the
  harness. This is the same shared-virtual-mouse class of problem story 9 wrote up for
  TC-36 and TC-30.
- **The fixture is built with the model, not with literals.** `checkout-flow.ts` calls
  `createShape`, `attachTarget`, `endpointAtDrop` and `createConnector`, so the bytes it
  produces are the bytes a person's drags produce, and the test that seeds it is testing
  the reader rather than a scene invented to match it. It arrives through
  `__applyUpdate`, a test-build hook that feeds an update into the live document - the
  same route a peer's update takes.
- **The component tests press keys on the document and read state**, `aria-pressed` on
  the tool buttons and `data-selected` on what is drawn, as the stories before did.

## Known flakiness on this machine (story 10)

Two cases that predate this story are not reliably green in a full three-browser run here.
Neither was skipped, slowed down or deleted; both were measured with this story's work
stashed away, at the story 9 commit, and both fail there as they do here.

- **Story 8's `undo.spec.ts` TC-24, "every editor undoes only their own move and typing
  while everyone works at once", firefox.** Two full runs at the story 9 commit failed it
  and two passed; with story 10 in, the same. It passes in isolation, in chromium and in
  webkit. Read out with per-page logging: after five editors each drag their own note by
  (+40, +40), type a word in another note and press Ctrl+Z twice, four editors are back
  where they started and one note sits exactly one drag's delta from where it began - and
  is still there after six presses. A page cannot undo a change another page's mouse wrote
  into the same note, which is what a duplicated input event does. Undo itself behaves:
  nothing of anyone else's is reverted and no object disappears.
- **Story 3's `navigation.spec.ts` "a mouse drag moves the board by exactly the pointer
  delta", webkit.** It wants the camera 200 to the left of where it was and reads 80:
  `waitForCameraChange` answers on the *first* change and the assertion then runs while the
  drag is still arriving, which is a thing that only shows when the machine is busy. This
  story writes nothing to the camera, and the shape and connector layers are not even in
  the document while the select tool is held, so the case behaves the same with this story
  stashed.
- Both are the class already written up twice in this file: five windows and one OS cursor
  on macOS (story 9's five-window TC-36 and TC-30, and TC-27 above), and a functional wait
  that reads a board mid-flight. The fixes belong to those suites: either five editors'
  mouse work joins TC-36 and TC-30 as chromium-only, or the editors are driven without one
  shared cursor; and a mid-drag read should wait for the drag to be *over*, not for the
  first sign of it. Neither is a decision a story 10 commit should make.

## Verification (story 10)

`npm run typecheck` (both tsconfigs), `npm run build`, `test:unit` (294),
`test:component` (207) and `test:integration` (70, unchanged) pass. `test:e2e` is
176 passed, 4 skipped - the 4 are story 9's TC-36 and TC-30 chromium-only skips, nothing
new is skipped - and all 27 of this story's e2e cases (TC-23 to TC-27 and the fixture
flow) are green in chromium, firefox and webkit in every run. The two cases written up
above are the ones that come and go between runs, in stories that are not this one.

---

# Story 11 — Sketch freehand with a pen

## What is here (story 11)

**Shared, because the line is board content**

- `src/shared/geometry/simplify.ts` — the three pure functions a gesture becomes:
  `simplify` (Ramer–Douglas–Peucker, **iterative with an explicit stack** — see the
  stack note below), `splitPoints` (chunks of `STROKE_MAX_POINTS` that *share* their
  boundary point, so two strokes made from one long drag join with no gap) and
  `smoothPath` (midpoint-quadratic: `M p0`, then `Q p[i] mid(p[i],p[i+1])`, ending
  `L p[n-1]`; one point becomes a zero-length path, which a round cap draws as a dot).
  No Yjs, no DOM, no React in this file.
- `src/shared/objects/stroke.ts` — `createStroke` (validate first, then *one*
  `LOCAL_ORIGIN` transaction; a rejected draw returns `null` and writes nothing),
  `readStroke`, `strokeSnapshot`, `strokeSnapshots`, `scaledPoints`,
  `strokeThicknessWorld`, `strokeColor`. The line is stored flattened
  (`[x0,y0,x1,y1,…]`) relative to the box origin, at creation size, next to
  `baseWidth`/`baseHeight`; `scaledPoints` is the only reader of that pairing, so
  nobody else in the codebase multiplies by a ratio by hand.
- `src/shared/config.ts` — `TYPE_STROKE`, `PEN_COLORS` / `PEN_THICKNESS_WORLD` with
  `PenColor` / `PenThickness` and `PEN_COLOR_KEYS` / `PEN_THICKNESS_KEYS` (ordered
  key lists, because `Object.keys` of an `as const` object is otherwise a cast
  repeated in three components), `DEFAULT_PEN_COLOR`, `DEFAULT_PEN_THICKNESS`,
  `STROKE_SIMPLIFY_TOLERANCE_PX` (1), `STROKE_MAX_POINTS` (5000),
  `STROKE_HIT_TOLERANCE_PX` (6, *screen* pixels, divided by the zoom wherever used),
  `STROKE_MIN_SIZE_WORLD` (4).
- `src/shared/board-model.ts` — `stroke` joins `KNOWN_OBJECT_TYPES`, so a board
  holding a drawing from a newer client is still a board that opens.

**Client**

- `src/client/tools/PenTool.tsx` — the gesture. Press captures the pointer; every move
  appends *coalesced* events (`nativeEvent.getCoalescedEvents()`, falling back to the
  event itself); the preview is repainted **at most once per animation frame** through
  one scheduled `requestAnimationFrame`, never per event. Release simplifies by
  `STROKE_SIMPLIFY_TOLERANCE_PX / zoom` and commits. The gesture lives in refs
  (`press`, `frame`, `propsRef`, `cameraRef`) because a rAF callback and a commit run
  outside the render that started them, and a closure over props would draw the colour
  that was chosen two strokes ago.
- `src/client/tools/PenToolbar.tsx`, `src/client/tools/usePenOptions.ts` — six colours
  and three weights, held in session state: not in the document, not in storage, back
  to the defaults on reload, remembered for the rest of the visit.
- `src/client/objects/StrokeObject.tsx` — the drawing. An SVG whose `viewBox` *is* the
  stroke's world-space box, so one user unit is one board unit and
  `stroke-width` can stay the stored thickness however big the box is dragged. Three
  paths: a fat invisible target (`pointer-events: stroke`, width
  `max(thickness, 2·HIT_TOL/zoom)`) that is the only part taking a pointer, the halo
  behind the ink while selected, and the ink itself.
- Changed: `registry.tsx` (the `stroke` entry: `aspectLocked`, `minSize`,
  `editableText: false`, and the line-distance `hitTest`), `Toolbar.tsx` (the Pen
  button, `P`), `useActiveTool.ts` (`pen` shipped, and the one tool that does not call
  `toolCreated`), `useBoardKeys.ts`, `useBoardDoc.ts`, `BoardPage.tsx`, `styles.css`,
  `canvas/testHooks.ts`.

**Tests** — `tests/unit/stroke.test.ts` (18), `tests/component/PenTool.test.tsx` (11),
`StrokeObject.test.tsx` (11), one case moved and one added in
`useActiveTool.test.tsx`, `tests/e2e/pen.spec.ts` (10 × 3 browsers) with
`tests/e2e/helpers/pen.ts`, and `tests/fixtures/pen-paths.ts` (a wobbly loop, an
underline, a 5,010-point spiral — jitter from a seeded mulberry32, so the point counts
a simplification test asserts mean the same thing every run). TC-01 to TC-21 are each
named in a test title.

## Where the design and the code disagreed, and what won

- **`BoardViewport.tsx` is not touched at all.** The design's file list has it modified
  so that "while Pen is active, pointer drags go to PenTool instead of panning". Story
  10 already added exactly that mechanism — the `overlay` slot, a child of the board
  surface, above every object, whose `pointerdown` therefore never reaches the
  viewport's own pan (which only starts on `event.target === el`) and whose release
  never reaches an object's drag. The wheel and the `gesture*` listeners are attached to
  the viewport element itself and still get what bubbles up, which is why TC-19's
  scroll-pans-and-Ctrl-scroll-zooms-while-the-Pen-is-held needed no new code and none
  of the existing wheel tests changed.
- **`PenTool` takes three props more than the contract.** The contract's
  `{ camera, color, thickness, doc, identityId }` cannot integrate with this board: the
  design asks the tool itself to call `createStroke` and `stopCapturing()`, while
  story 8's undo window and story 7's selection are owned by `BoardPage`. So
  `canCreate` (a reader must not be left drawing into a document that will reject it),
  `onCreated(id)` (the board selects what was drawn) and `onBoundary()` (the tool says
  "open an undo stop here" rather than reaching into the undo manager). Nothing in the
  contract's five was renamed or removed.
- **`StrokeObject` names its snapshot `note`.** Every object on this board is rendered
  through one `ObjectProps` shape whose snapshot field is `note`; the design's
  `stroke` would have made the registry pass a different prop to one type. It is
  `note: StrokeSnapshot`, and the type omits every editing prop a stroke cannot use,
  so the registry cannot hand it an editor by accident.
- **The preview is smoothed, not simplified.** The design's sequence diagram shows the
  preview redrawn once per frame with no simplification step, and simplifying a line
  that is still being drawn makes it visibly jump between two shapes as the RDP pivot
  changes. The raw points go to `smoothPath` on screen; simplification happens once,
  at commit, in world units.

## Two things the browsers made clearer than the spec did

- **A 5,000-point gesture recursed into a stack overflow.** A textbook recursive RDP
  depth-bounds itself by the split, but only if the split actually happens: a
  hand-drawn spiral whose points all lie within a tolerance of the chord keeps
  recursing on nearly the whole range. `simplify` uses an explicit stack instead, so
  the depth is heap and the recursion limit is not a thing a fast mouse can reach.
- **Escape and `pointercancel` are deliberate opposites, and the test says so.** The
  design asks that an interrupted stroke keeps its ink (a system taking the pointer is
  no reason to lose a line), while Escape must create nothing (TC-13). Both end the
  gesture, and Escape *also* unmounts the layer, which fires `lostpointercapture` in
  a browser — so an Escape that simply let go of the gesture would commit the line it
  was told to throw away. The Escape handler is registered on `window` (before React
  flushes the unmount) and clears the gesture without committing; the pointer handlers
  commit. TC-11 and TC-13 sit next to each other in `PenTool.test.tsx` for exactly
  this reason.

## Test decisions (story 11)

- **`e2e/helpers/pen.ts` drives the pen by board points, and clicks the curve the
  browser computed.** `strokeLineScreenPoint` asks the painted path's own
  `getPointAtLength` where the ink is, rather than assuming the quadratic path passes
  through a stored point (it does not). TC-20's "click the line" is then a click on
  the line in every browser, not a point that happens to be near it in one.
- **`dragPenThrough` batches its moves.** One `mouse.move` per fixture point is one
  round trip per point, and the 400-point loop then could not be drawn inside the
  test timeout at all — it was 30 s and failing before batching. A batched move with
  `steps: n` still fires n real move events, which is what a hand does; `{ paceMs }`
  puts a gap between batches for TC-17, whose whole subject is what the frames show.
- **Latency is logged, not asserted, and the boards are waited for.** TC-18 prints the
  release-to-visible time against `LIVE_UPDATE_LATENCY_BUDGET_MS` (2–4 ms here) and
  waits with `E2E_EVENTUAL_TIMEOUT_MS`, per story 3's rule. The one thing that *is*
  asserted is the negative: the watching board holds nothing while the pen moves.
  After a reload a test calls `waitForBoardLoaded()` before reading a count, because a
  page that has painted but not synced legitimately holds an empty document, and
  asserting on that is asserting on nothing.
- **`useActiveTool.test.tsx` was corrected, not worked around.** Its case "a letter
  that names a tool this build does not ship holds nothing" held `p` in its list of
  unshipped letters, so it went red the moment the Pen shipped. `p` moved out into its
  own new case — which asserts the opposite, that P holds the Pen and that the Pen
  keeps the pointer after it draws — and the read-only case now also checks the Pen is
  dropped when the board stops being editable.

## Known flakiness on this machine (story 11)

- **Story 8's `undo.spec.ts` TC-24, firefox.** Five editors each move and type at once
  and press Ctrl+Z twice; it read a note at x = -553 where the baseline said 260. It
  fails in a full-suite run with `pen.spec.ts` removed entirely, and passes 8/8 in
  isolation — the same one-cursor-on-macOS class written up under stories 9 and 10
  above. Nothing in this story writes to a sticky note or to the undo manager.

## Verification (story 11)

`npm run typecheck` (both tsconfigs), `npm run build`, `test:unit` (312),
`test:component` (227) and `test:integration` (70, unchanged) pass. `test:e2e` is
205 passed, 4 skipped (story 9's chromium-only TC-36 and TC-30 skips, nothing new
skipped) plus this story's 30 pen runs: TC-17 to TC-20 green in chromium, firefox and
webkit. The delivery times the design budgets were logged, never asserted; the single
failure was the story-8 case written up above.

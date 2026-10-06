# Story 1 — implementation notes, deviations and blocked items

## Blocked

### WebKit (Safari) E2E project cannot run on this machine

`npx playwright install webkit` downloaded `webkit-2359` but the browser fails to
launch: the host is missing system libraries (Playwright reports
`Host system is missing dependencies … apt-get install libavif13`), the library
is nowhere on the filesystem (`ldconfig -p` and a filesystem search both find no
`libavif`), and it cannot be installed: `sudo` is disabled (no-new-privileges)
and `apt` cannot open its own package lists.

Consequence: `npm run test:e2e` runs **Chromium + Firefox** (both installed).
`playwright.config.ts` builds the project list from what is actually usable —
WebKit is added only when its browser build *and* its system libraries are
present, so nothing is silently dropped on a machine that can run it. Force a
set explicitly with e.g. `E2E_BROWSERS=chromium,firefox,webkit`.

Safari-only behaviour is still covered, just not in a real Safari:
`BoardViewport` listens for `gesturestart` / `gesturechange` / `gestureend`
(WebKit pinch) with `preventDefault()`, and component tests
(`tests/component/BoardViewport.test.tsx`, TC-15c/TC-15d) drive those events,
including multiplicative scale chaining and clamping at `ZOOM_MAX`.
The equivalent pointer-anchored zoom path is exercised in Chromium and Firefox
e2e (TC-24, TC-31).

## Deviations from the design document

1. **Camera ownership.** `design.md` says the viewport component owns the camera
   state. The camera lives in `src/client/canvas/useCamera.ts` and is created in
   `src/client/App.tsx`, then shared with `BoardViewport`, `ZoomControls` and
   `NavigationHint` through `CameraApiContext`. Reasons: the zoom label, the
   disabled states and the hint all need camera state; the e2e test hook needs one
   camera to control and read. `BoardViewport` still falls back to owning its own
   camera when rendered without a provider, so it remains independently testable.
2. **Test hook gained `getCamera()`.** The design lists
   `window.__vidi6.setCamera(...)`; e2e assertions also need to read the camera,
   so the hook is `{ getCamera, setCamera }`. It is installed only when
   `import.meta.env.MODE === "test"` (`src/client/canvas/testHooks.ts`).
   Verified against a real browser on a production build
   (`npm run build`, served by `wrangler dev`): `typeof window.__vidi6 === "undefined"`
   while the board still renders. In the production bundle the mode check folds
   to `return !1` and the hook body returns immediately, so the global is never
   created.
3. **`vite.config.ts` was added** (the design names only `wrangler.jsonc` and
   `playwright.config.ts`). It is needed for the React plugin, `build.outDir`
   (`dist`, which `wrangler.jsonc` then serves as static assets), the fixed dev
   port, and the Vitest project configuration. `wrangler.jsonc` has no `binding`
   key at all, as instructed.
4. **Keyboard zoom steps snap to exact powers of `ZOOM_STEP_FACTOR`.** The design
   requires the label to read `125%` (TC-16, TC-19) while the maths is repeated
   multiplication; `zoomStep` snaps the result to `ZOOM_STEP_FACTOR^n` when it is
   within `ZOOM_STEP_SNAP_EPSILON`, so repeated steps read exactly
   125 / 156 / 195 / 244 / 305 / 381 / 400 % instead of drifting. Wheel and pinch
   zooms are continuous and deliberately *not* snapped.
5. **How "page zoom did not change" is measured (TC-31, TC-24).** Playwright has
   no page-zoom API, so the tests read `visualViewport.scale`, `devicePixelRatio`,
   the window inner size and the rendered box height of the zoom label and buttons
   before and after the board gestures — the checks named in `tasks.md`
   (`visualViewport.scale`, `devicePixelRatio`) plus page-text size.
6. **`wrangler dev` inspector port.** Wrangler picks the first free port after the
   main one: main `27840`, inspector `27841`. Both are inside the sandbox range
   27840–27855 and are passed explicitly
   (`--ip 127.0.0.1 --port 27840 --inspector-port 27841`) so they are not chosen at random.
7. **Extra e2e cases beyond the numbered TCs** (TC-16b/26b/27b/27c, plain wheel,
   viewport resize) exist to cover acceptance criteria the numbered list only
   implies (e.g. "Reset view always available", "board fills the viewport at any
   zoom"). No listed TC is missing.

## Notes that affect the tests

- **rAF batching vs. assertions.** `useCamera` coalesces camera changes into one
  animation frame, so camera *state* can lead the *painted* board by a frame.
  `tests/e2e/helpers/board.ts` therefore has `waitForRenderedBoard()`: it polls
  until the world-layer transform and dot-grid spacing match the camera state
  before any pixel assertion is made. Component tests use the equivalent
  `settle()` (two `requestAnimationFrame` ticks plus a macrotask).
- **Dot-grid arithmetic used by pixel assertions.** Dots are
  `radial-gradient(circle at 50% 50%)` tiles of `GRID_SPACING_WORLD * zoom` px,
  with `background-position: mod(-x * zoom, spacing)`, so a dot centre sits at
  `offset + spacing / 2 + k * spacing`. `nearestDot` / `distanceToNearestDot` /
  `expectedGridOffset` in the helper encode that, which is how "the same dot is
  still under the pointer ±1 px" is checked.
- **Computed CSS is rounded** (~4 decimals in Chromium) while inline styles are
  not, so the helper parses the inline `transform` first and falls back to the
  computed `matrix(...)`. Firefox serialises `translate(0px, 0px)` as
  `translate(0px)`, which the parser handles.
- **Wheel deltas:** `deltaMode` LINE/PAGE are converted to pixels
  (`WHEEL_LINE_DELTA_PIXELS` 16, `WHEEL_PAGE_DELTA_PIXELS` 800) because Firefox
  reports line deltas for mouse wheels.
- **`tests/component/setup.ts`** resets `window.__vidi6` and React testing-library
  state after each test so the test hook never leaks between cases.
- **Visual choices.** The spec sets no visual requirements beyond the behaviour,
  so the look is deliberately plain and neutral: `#fafafa` background, dot grid,
  a faint crosshair marking the board start point, 16px control and hint text,
  muted `#666666` hint, `#d0d0d0` borders, 40px controls. No components beyond
  those the design names.

## Task 5 — sticky note interaction
- Interaction state lives in one place: `src/client/board/useSelection.ts` (`selectedId`, `editingId`, `select/startEdit/endEdit`). Selection and editing are view state, never written to the Y.Doc — story 7 owns multi-selection, story 3 the sharing.
- `StickyNote.tsx` owns the pointer gesture: pointer capture, `DRAG_THRESHOLD_PX` from config (2 px selects, 3 px drags — verified by both values in the component tests), drag delta computed in **board units** by dividing the screen delta by the current zoom, so the grabbed point stays under the pointer. Model writes are coalesced to one per animation frame through the existing `throttleByFrame` idiom, and a pointerdown on a note is `stopPropagation`ed so it never pans or zooms the board.
- A dragged note is brought to front **once, at drag start** — not per frame: a `bringToFront` on every frame would multiply the sync traffic story 3 has to carry, and `board-model` already returns `false` for the topmost note (TC-10). Verified in a component test: a drag of the topmost note produces exactly one `update` event.
- Keyboard behaviour (Enter edit, Enter on a focused button = press that button, Delete/Backspace delete the selected note only when not editing, Escape ends editing but keeps selection) is implemented in `useBoardKeys` in `src/client/App.tsx` — not in BoardViewport, which is story 1's file and has its own zoom-key semantics. `Delete` while editing reaches the textarea instead of the board handler (TC-26).
- Stale state cannot survive: a selection or editing target whose note disappeared is dropped in `useBoardKeys`'s render pass (TC-37), and `StickyNote` cancels its pending frame and drag record on unmount. Late pointer events on a deleted note find no drag record and no `id`, and `moveObject` rejects the stale id.
- Board gestures reuse `BoardViewport`'s existing handlers rather than adding new ones: `onDoubleClick` (create at point) and a release-without-move on empty space (clear selection) were extended in place, keeping story 1's pan/zoom tests green.
- jsdom reality for the later tasks: no `setPointerCapture` (feature-detected), and `Element.scrollHeight` is always 0, so font fit and overflow are asserted at unit level with a fake measuring element, and in e2e with real layout.

## Task 6 — toolbars
- Board toolbar: story 2 only *adds* one button to story 1's `BoardViewport` toolbar (`src/client/board/Toolbar.tsx`), label "Sticky note", tooltip 'Sticky note – centre of view', tooltip and accessible name identical. Creation is centred on the current view (`screenToWorld(camera, viewportCentre)`), never on the document origin, so it works however far the board has been panned.
- Note toolbar: rendered inside the note but positioned by CSS with `scale(1 / zoom)`, so its on-screen size stays constant at any zoom and it needs no extra overlay layer.
- Colour swatches carry the colour *name* in both `aria-label` and `title` ("Pink colour") plus `aria-pressed` for the current colour, so colour is never the only signal; the bin button is named "Delete note". Clicking a swatch writes through `setStickyColor` (invalid colour → no-op) and keeps the selection; the bin calls `deleteObject`, and the selection then clears itself because it points at a note that no longer exists.
- Gestures on the note toolbar must not reach the board. `BoardViewport` listens for `wheel` **natively** on the viewport element, which is an ancestor of the toolbar, so React-level `stopPropagation` fires too late; the listeners that block wheel / pointerdown / pointerup / dblclick are attached natively (wheel as `{ passive: false }`) on the toolbar's anchor element in `StickyNote`.
- Character counter appears only within `STICKY_COUNTER_THRESHOLD_CHARS` of the limit and is written as `n/1000` in an `aria-live` region; the PRD wording "n/1,000" is the same rule, the separator was dropped to keep one format in code and tests.

## Task 7 — component tests for interaction, editor and toolbars
- `tests/component/*` render the real `<App>` with an injected `Y.Doc` (`App({ doc })`, `useBoardDoc(doc)`), so the tests exercise the actual wiring instead of a hand-built harness that could drift from the app. `tests/component/boardFixture.ts` holds the shared helpers: real pointer event sequences, note lookups by `data-note-id`, camera reads through story 1's `window.__vidi6` hook, and `changeModel()` for model changes made outside React (needs `act`).
- TC numbers in test names follow the design's coverage table exactly: TC-18 to TC-22, TC-25, TC-27 to TC-29, TC-35 to TC-38 are ui-component; TC-30 to TC-34 are e2e; TC-01 to TC-17 and TC-39 are unit. Extra tests that are not in the table (drag geometry at zoom 1.25, one-update-per-drag stacking) carry no TC number so the mapping stays honest.
- jsdom facts that shaped the tests: no `setPointerCapture` (the component feature-detects it), `Element.scrollHeight` is always 0 (font fit is asserted in unit tests with a fake measuring element, and in e2e with real layout), and `requestAnimationFrame` needs a synchronous stub (`runAnimationFramesSynchronously`) so a drag can be observed step by step. `fireEvent` names are camelCase (`pointerDown`, not `pointerdown`), and a model change is invisible to React unless it runs inside `act`.
- jsdom never performs layout, so pixel-accurate dragging and font-fit behaviour are only asserted in e2e (TC-30 to TC-33).

## Task 8 — e2e sticky note workflows
- `tests/e2e/sticky-notes.spec.ts` + `tests/e2e/helpers/notes.ts`: note boxes read from the rendered board, screen→board conversion from the *rendered* camera (story 1's helper reads the world-layer transform, because camera state can lead the paint), `elementFromPoint` as the direct answer to "drawn above", and real gestures (`mouse.dblclick`, press–move–release).
- **Bug only a real browser could find:** painting notes in `snapshot` order meant every `bringToFront` re-sorted the React children, and re-parenting the dragged element releases its pointer capture, which silently ended drags after the first frame (selection and stacking were still applied, position was not). Fixed by a stable DOM order (ids ascending) plus a CSS `z-index` from the document's `z`: stacking is unchanged, drags are not interrupted. Covered by TC-32 in e2e and by the "brought to front ... drawn above" component test.
- `BoardViewport.isBoardSpace` was broadened from "the three layer elements" to "any descendant of the board that is not a note, note toolbar, textarea or button", so double-clicks on the origin marker create a note while notes keep their own gestures. Story 1's 20 e2e tests still pass.
- **Gotcha for later stories:** `playwright.config.ts` uses `reuseExistingServer`, and a wrangler left running on 27840 serves the *previous* `dist-test` build. Either stop it or let Playwright start `npm run serve:e2e` itself, otherwise e2e silently tests stale code. Run order used here: `build:test` is part of `serve:e2e`, so a clean `npm run test:e2e` is always fresh.
- The character counter is an editing-time affordance (PRD: "While editing"), not a permanent note feature: it is rendered by the editor only, and e2e asserts it is gone after the note leaves Editing while the clipped text stays.
- Real layout results: `STICKY_FONT_MAX_PX` for a short phrase, a shrink for a realistic multi-line retro item (13px with the fixtures on this machine), and 10px minimum with `is-overflow` plus `scrollHeight > clientHeight` for a 1,000-character paste.

# Story 4 — implementation notes, deviations and blocked items

## Gap filled from story 3

Story 3's unverified tasks (4, 7, 8, 9) turned out to be implemented and green
(`src/client/sync/*`, `tests/component/ConnectionStatus.test.tsx`,
`tests/e2e/live-collaboration.spec.ts`, the nightly soak), so story 4 needed no
repair work from story 3. One story 3 behaviour story 4 depends on and that is
now re-verified by story 4's own tests:

- **A room that lost its document is repopulated by the client that comes back
  first** (story 3 TC-18, `SyncStep1` on accept → client's `SyncStep2`). Story 4
  relies on it for `persist.save_failure` (TC-14: after a storage failure the
  room reloads from storage, and the client that still holds the unsaved change
  supplies it), and story 4's integration test re-proves it.

## Notes that affect the tests

- **A close a client started is never observed by that client.** In the Vitest
  pool, `socket.close()` from `TestClient` moves the socket to `CLOSING` and the
  `close` event never arrives, because the closing handshake is completed by the
  runtime, not echoed back to the local socket. The room *does* see the socket
  disappear (`ctx.getWebSockets().length` drops). So story 4's tests only ever
  `await waitForClose()` for closes the **room** sends (4500, 1011, 1003) — which
  is exactly the set of close codes the story is about.
- **`evictAllDurableObjects()` is the hibernation tool; `abortAllDurableObjects()`
  is the restart tool.** Aborting closes the sockets; evicting hands them to the
  runtime and leaves them open (`readyState` 1, `isClosed` false), which is what
  TC-18 needs: the instance is gone, a frame arrives on a socket accepted by an
  instance that no longer exists, and the reconstructed room must load the board
  before it can broadcast to the sockets `ctx.getWebSockets()` now lists. Verified
  locally: eviction, then a client write, reaches the other client.
- **Compaction is reached in tests by writing through the room**, not by opening
  500 sockets: `fillLog()` runs `seededEdits` transactions on the room's own
  document inside `runInDurableObject`, and each one goes through the room's real
  append path, so the 500th append compacts exactly as a real board's would.
- **Storage facts are read straight from SQLite** (`SELECT COUNT(*)`,
  `length(data)`) rather than through `BoardStore`, so an assertion about "what is
  stored" is never an assertion about what the store *thinks* it stored.
  `snapshot_chunks` has no `bytes` column — chunk size is `length(data)`.

## Deviations from the design document

1. **`BoardStore`'s storage parameter is structural.** The design names
   `constructor(storage: DurableObjectStorage)`. `DurableObjectStorage` only
   exists in the worker type project, and `tests/unit/board-store-chunks.test.ts`
   must import `src/worker/board-store.ts` from the *client* project (the design
   puts `chunkBytes`/`joinChunks`/`shouldCompact` in that file). So the file
   declares the two members it actually uses (`sql.exec`, `transactionSync`) as
   `StorageLike`/`SqlLike`, and `BoardRoom` passes `ctx.storage` straight into
   it. No behaviour differs; the integration tests run against the real object.
2. **Injected failures use real SQL, not wrapped methods.** The design's
   "wrapper sits outside SQLite so real transaction semantics still apply" is
   achieved with SQLite triggers and a dropped table:
   TC-11 installs `AFTER DELETE ON snapshot_chunks → RAISE(ABORT)`, TC-14 a
   `BEFORE INSERT ON updates → RAISE(ABORT)` (dropped again afterwards), TC-26
   renames the `updates` table away so the `SELECT` really throws. Product code
   therefore carries no failure switches.
3. **`nextRoomState(state, event)` takes a discriminated event.** The retry edge
   (LoadFailed → Loading) needs to know how long the room has been failing, so
   the `new-connection` event carries `sinceFailureMs`. `RoomState`
   (`ready | load-failed | storage-failed`) is the serving subset named by the
   contract; `RoomLifecycleState` is the full diagram including `loading`,
   `compacting` and `hibernated`.
4. **`BoardStore.append` takes the document as well as the update**
   (`append(update, doc?)`, `LOG_LOOKBACK_ROWS = 2`). The design's signature is
   `append(update)`, and storing exactly one row per change does round-trip — until
   a row is damaged. Yjs cannot integrate a delta whose predecessor is missing: the
   structs it needs are still "pending", so *every* later change in that chain is
   silently absent from the reloaded board, and one damaged row loses a whole run
   of notes. Each stored row is therefore written as
   `Y.encodeStateAsUpdate(doc, stateVectorOfTheRowTwoRowsBack)`, which repeats the
   previous row's structs: a damaged row is covered by the row after it, and the
   quarantine path recovers one consecutive damaged row (the look-back depth sets
   the tolerance; it is a constant, not a guess made per board). The cost is that
   each row is roughly twice its raw size, which `COMPACTION_BYTES` absorbs. Proven
   by TC-05 with one, two and three damaged rows.
5. **`TC-26`'s read failure is a dropped column, not a dropped table.** `load()`
   calls `migrate()` first, and `migrate()` uses `CREATE TABLE IF NOT EXISTS`, so a
   renamed `updates` table is simply recreated empty and the `SELECT` succeeds.
   `ALTER TABLE updates DROP COLUMN bytes` survives migration (the table is still
   there) and makes the log query a real `SQLITE_ERROR` — which `load` reports as
   `{ ok: false, reason: "sql-error" }` and the room answers with 4500.
6. **A room is proven restarted by `instanceId`, not by an empty document.** Story
   3's `restartRoom` helper asserted "a fresh instance has no doc", which is
   precisely what story 4 must make false. `BoardRoom.instanceId` (a
   `crypto.randomUUID()` per instance) is public so the helper can assert *the
   instance changed* while the board stayed. `BoardRoom.loadFailedAtMs` is public
   for the same reason: TC-16 moves it back by `LOAD_RETRY_MIN_INTERVAL_MS`, which
   is a clock reading, not a product switch.

# Story 5 — implementation notes, deviations and blocked items

## Deviations from the design document

1. **`src/client/router.tsx`, not `router.ts`.** `AppRouter` renders `<HomePage />`,
   `<BoardPage />` and `<NotFoundPage />`, so the file has to be `.tsx`; there is no
   `.ts` version and nothing imports one.
2. **`src/client/routing.ts` is a file the design does not name.** `HOME_PATH` and
   `boardPath(id)` live there so that `router.tsx`, `src/client/api.ts` and the pages
   can all agree on `/` and `/b/:id` without importing each other. `boardLink` is in
   `src/client/api.ts`, as designed.
3. **`boardLink(boardId, origin?)` rather than `boardLink(origin, id)`.** The origin is
   only ever needed by tests that render a page without a `window` they can name; it
   defaults to `window.location.origin`, which is what the Share panel wants. The link
   it produces is the designed `${origin}/b/${id}`.
4. **`createBoard` (client) rather than `createBoardRequest`.** `src/client/api.ts`
   exports `createBoard` / `checkBoard`, mirroring the worker's `createBoard` in
   `src/worker/create-board.ts`; both are one-word names in the same vocabulary as the
   routes they call. `CreateBoardFn` is the injectable shape the pages take, which is
   what makes TC-19 to TC-22 able to fake the service without stubbing `fetch`.
5. **`BoardPageState` carries `failedChecks`, not `attempt`.** The design sketches
   `nextBoardPageState(state, result, attempt)`. The retry delay is a property of the
   page — the unreachable phase has to *render* `nextRetryMs` — so the failure count
   lives in the state (`failedChecks`) and the transition function is
   `nextBoardPageState(state, event)`. `retryDelayMs` is recomputed by
   `boardCheckRetryDelayMs(failedChecks)` and stays
   `1000, 2000, 4000, 8000, 10000, 10000, …` because the cap is the existing
   `RECONNECT_MAX_BACKOFF_MS` (10 s), which is what `design.md` names.
6. **`BoardPagePhase` is named `phase`, and the renderable values are
   `checking | board | not_found | unreachable`.** The design's diagram calls the
   serving state `initialized`; the page state names what the person sees instead.
   What matters for `share.not_found` is preserved: only `phase === "board"` may render
   board content or mount `connectBoard`, and component tests assert "no socket was
   opened" by counting `fetchImpl` calls and asserting the absence of board nodes.
7. **Malformed links are answered locally *and* by the server.** The client never
   requests an id that fails `isValidBoardId` (TC-23, TC-27). If someone still asks —
   a hand-typed URL, a curl, a stale bookmark — `/api/rooms/<malformed>` answers 404
   JSON rather than 400, before the Durable Object namespace is touched. One contract
   for "there is no such board", whatever the reason, so no caller has to guess which
   kind of bad id gets which status.
8. **`BoardRoom` grew three RPC methods** (`initialize`, `exists`, and the
   test-hook-only `seedBoardUpdates`) instead of a separate existence table. The
   existence answer is read out of the same SQLite the board lives in
   (`BoardStore.existsReadOnly` + a `created_at` row), so "does this board exist" cannot
   disagree with "what does this board contain".
   - `initialize()` is the create: it writes the `created_at` marker only when there is
     none yet, and reports `created` or `exists`. It is idempotent — a second call for
     the same board answers `exists` — and because a Durable Object handles one RPC at a
     time, two simultaneous `POST /api/boards` for the same id cannot both think they
     created it. That is why a colliding id is answered 500 rather than by minting a new
     id (`share.unguessable`: a collision is not an event to retry away).
   - `exists()` is read-only. It never runs `migrate()` and never writes, so probing a
     link cannot create a board, and cannot resurrect a board the log says is absent.
     `load()` no longer migrates on read; migration happens on the first write.
   - A board that has content but no `created_at` is **existing**. Story 4 boards (and
     the `__vidi6SeedBoard` route from story 3) wrote updates without board metadata, and
     a person holding a link to one of them must not be told the board is gone. TC-31
     proves it end to end through `POST /__test-hooks/legacy-board`.
9. **`BoardRoom.fetch` answers the room route itself.** Unknown board → 404 with
   `{ "error": "not_found" }` (the WebSocket upgrade is refused before it starts, which
   browsers report as a failed connection); a board whose log cannot be read → close
   code 4500, the same storage-failure signal story 4 introduced. Story 3's
   `board-room.test.ts` expectations were updated from 400 to 404 for malformed ids to
   match the contract above.
10. **Test hooks are a separate route module behind a wrangler var.**
    `src/worker/test-hooks.ts` serves `POST /__test-hooks/legacy-board` and only when
    the worker has `TEST_HOOKS=1` (`--var TEST_HOOKS:1` in `serve:e2e`, and in the
    default args of `tests/e2e/helpers/wrangler-process.ts`). Without the var the routes
    answer 404, and TC-31's own negative case asserts that. `seedBoardUpdates` marks its
    rows with a distinct origin symbol (not the load origin) so the seeded rows carry no
    `created_at` — a legacy board really looks legacy.
11. **The integration project builds the client before it runs**
    (`globalSetup: tests/integration/build-assets.ts`, wired in `vitest.config.ts`).
    Worker routes are asserted against the same `dist/assets/*` that `wrangler dev`
    serves; without the build, the "assets are served with the SPA fallback" assertions
    would pass or fail depending on what was last built by hand.
12. **Component tests of the retry backoff measure the timer by crossing it.** Under
    fake timers the delay assertion advances `delay - 1` (asserting no new check has
    been issued) and then 1 more millisecond followed by a microtask drain, because
    `Date.now()` records when the check actually runs, not when it was scheduled.
    `settle()` is that drain (`advanceTimersByTimeAsync(0)` a few times); `findByTestId`
    cannot be used under fake timers because its MutationObserver polls on a real
    `setInterval`.
13. **`SharePanel` selects the link with a `useEffect` on `open`, not
    `requestAnimationFrame`.** The fallback (`select()` + the "Press Ctrl+C (Cmd+C on
    Mac) to copy" line) is what TC-25 asserts, and a rAF would leave the selection
    outside the synchronous flush the component tests read.
14. **Clipboard: `navigator.clipboard.writeText` when available, otherwise the
    selected-link fallback in the same click.** TC-29 (component and e2e) covers the
    fallback rather than assuming a permission model; in e2e the *read-back* assertion
    runs on Chromium only, because Firefox's e2e context does not grant
    `clipboard-read`. The fallback half of TC-29 runs on both.
15. **A thrown `create`/`check` is a failure, not an exception.** `HomePage`'s and
    `BoardPage`'s effects wrap the awaited call in `try/catch`, mapping a throwing
    transport to `{ ok: false, reason: "network" }` / `unreachable`. A rejected promise
    escaping a React effect would be an unhandled rejection in the test runner and a
    silent UI in production; both are wrong for `share.unreachable`.
16. **`index.html` gained `<meta name="referrer" content="no-referrer">`.**
    Board links are the secret: a board id in the URL should not be handed to another
    origin as a referrer when a person clicks out of a board.
17. **No client-side board ids any more.** Story 3's `main.tsx` minted an id and
    redirected to `/b/<id>`; `/` is now a page with a button, and every board id comes
    from `POST /api/boards`. `newBoardId()` remains in `src/shared/board-id.ts` because
    the worker mints ids with it, and the story 3/4 e2e helpers now create boards
    through the API (`tests/e2e/helpers/api.ts`) instead of guessing ids.

## Story 3 e2e tests that were already red

`npm run test:e2e` failed 8 tests **at HEAD**, before any of this story's code existed
(checked by `git stash -u`, a full run, then `git stash pop`): TC-22, TC-26, TC-27 and
TC-28 in both Chromium and Firefox. They are not story 5 tests, but a red suite is a red
suite, and the causes were all in the tests rather than in the product:

1. **TC-22 / TC-28 read a note before it had finished arriving.** The arrival probe
   waited for the note *id* and then asserted its text in one shot. Text travels one
   keystroke at a time, so the read caught "Desig" or "private draft". The probe now
   waits for the whole text. TC-28's privacy half (no selection, no editor on the other
   person's screen) is asserted while Alex is mid-edit, and the shared-text half after
   the edit closes — the test asserts the same two things, in an order that matches when
   each one is true.
2. **TC-26's click grid landed on the board's own floating panels.** Its bottom-right
   point (1040, 770) is inside the zoom controls (measured: 987,730 277×54), and a
   double-click on a panel creates nothing. The grid is now columns `220 + 200·i` and rows
   `130 + 145·i`, which keeps every click pointing at a spot belonging to that note
   alone and clear of the tool panel (16,373 146×54), the zoom controls and the
   navigation hint (392,736 497×44). The final "all five boards show the same board"
   comparison now excludes `selected` and `editing`: story 3's own TC-28 says selection
   is private, and five people who each last touched a different note can never agree on
   it.
3. **TC-27's outage did not happen.** `context.setOffline(true)` emulates HTTP and
   leaves an established WebSocket running, so the badge sat at "Connected" for the whole
   outage and the test failed on "Alex sees Reconnecting". The outage is now built the way
   it looks from inside the board: the page's own sockets are closed (`closeSockets`,
   using the socket references `instrumentSockets` already collects) and
   `page.routeWebSocket` refuses every reconnect (`ws.close()`) until the outage ends,
   when the same handler proxies to the real server (`ws.connectToServer()`). The
   browsers' own console errors for those refused sockets are the outage's symptom, so
   they are listed as expected noise for `expectNoProblems` (Chromium:
   `ERR_INTERNET_DISCONNECTED`, Firefox: "can't establish a connection to the server").
   The notes this test creates were 40 px apart, i.e. on top of each other, so a
   double-click landed on an existing note instead of creating one; they are spread out
   now, as TC-26's are.
4. **TC-30 (nightly soak) hung until it timed out at 7 minutes.** Its gestures are
   random, and a random move of up to −100 px pushed notes off the top of the board,
   where their toolbars cannot be drawn (the toolbar is 42 px above the note); creation
   points starting at y=120 did the same immediately, and the next gesture — a colour
   swatch inside that toolbar — waited for a button that could not be on screen.
   Selection was also planned from a snapshot up to five editors wide, so a note another
   editor had just moved or deleted was clicked at a place it no longer occupied. The
   soak now creates and keeps notes inside a gesture zone (180,170 780×530 — notes there
   have room for their toolbars and clickable centres, clear of the tool panel, the zoom
   controls and the navigation hint), clamps each move into that zone, clicks the note's
   *current* box, and treats "the toolbar did not come up" as "this note is gone, take
   the next gesture". `npm run test:e2e:nightly` was red before (both browsers, both
   TC-30 runs) and is 4 passed now, in 2 minutes.
5. **`startBadgeRecorder` watched the wrong element.** It read
   `document.querySelector('[role="status"]')`, and the navigation hint carries
   `role="status"` too and comes earlier in the DOM — the log recorded "Drag to move
   around · Ctrl/Cmd + scroll or pinch to zoom" instead of the badge. It now selects
   `.connection-status`.

Nothing in the product changed for these four: the assertions are the same behaviour,
restored to a form where the behaviour is what fails when it is broken. `closeSockets` is
the only new helper.

## Blocked

Nothing in story 5 is blocked on this machine. The WebKit gap recorded under story 1
still applies to every e2e run in this repository, including TC-26 to TC-29 and TC-31:
Chromium and Firefox run, WebKit's browser build is present but its system libraries
(`libavif`) are not, and `sudo`/`apt` are unavailable.

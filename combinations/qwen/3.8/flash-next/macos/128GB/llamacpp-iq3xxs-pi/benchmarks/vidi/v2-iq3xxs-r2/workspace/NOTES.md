# Notes: decisions and environment

Story 1 — "Pan and zoom around an infinite board". Everything the design asked for is
implemented; the decisions below cover the places where the design left a choice open, and
the two things that could not be done on this machine.

## Followed from the design exactly

- All six named settings in `src/shared/config.ts` (`ZOOM_MIN`, `ZOOM_MAX`,
  `ZOOM_STEP_FACTOR`, `WHEEL_ZOOM_SENSITIVITY = 0.01`, `GRID_SPACING_WORLD = 24`,
  `UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000`), the `camera.ts` / `useCamera.ts` /
  `BoardViewport.tsx` / `ZoomControls.tsx` / `NavigationHint.tsx` contracts, the file
  layout, and the exact UI strings (`Reset view`, the `Zoom out` / `Zoom in`
  `aria-label`s, the `aria-live="polite"` percentage output, and
  "Drag to move around · Ctrl/Cmd + scroll or pinch to zoom").
- Extra named constants were added only where the design implied a number without naming
  it: `WHEEL_PIXELS_PER_LINE`/`WHEEL_PIXELS_PER_PAGE` (deltaMode conversion),
  `PERCENT_PER_ZOOM`, `ZOOM_STEP_SNAP_EPSILON` (the "within 1e-9" step snap), and
  `INITIAL_CAMERA` / `ZOOM_MIN_PERCENT` / `ZOOM_MAX_PERCENT` for tests and controls.
- No pan clamping anywhere: `x`/`y` are plain doubles, verified out to
  `UNBOUNDED_PAN_TESTED_EXTENT` in a real browser (`e2e`, TC-27 plus the
  "reaches UNBOUNDED_PAN_TESTED_EXTENT" test).

## Decisions

1. **Camera updates are coalesced to one per animation frame** (`useCamera` keeps the
   camera in a ref plus a `requestAnimationFrame` commit, as the design requires). Every
   test that reads DOM geometry therefore waits for a commit first — two frames in e2e
   (`settle()` in `tests/e2e/helpers/board.ts`, folded into the read helpers), and a
   0 ms `setTimeout` `requestAnimationFrame` stub in `tests/component/setup.ts` for jsdom.
   Without this, pointer-invariance assertions race the commit and fail intermittently.
2. **The board opens centred.** `useCamera` seeds the initial camera with
   `resetCamera(viewport)` when the viewport is already measured, with a fallback effect
   for a 0x0 mount (jsdom before `ResizeObserver` fires, or a hidden container). Centring
   never sets `hasNavigated`, so it does not dismiss the hint (TC-22/TC-28).
   Seeding synchronously removes an uncentred first paint, which otherwise made the first
   e2e pixel assertion racy.
3. **`useCamera` returns a small `CameraApi` object** (context-provided, `useCameraApi()`),
   which is the design's return value plus `zoomAround(point, factor)` (screen point for
   wheel/gesture zoom), `setCamera` (used by the test hook) and `panning` (cursor and
   `data-state` on the viewport). `App.tsx` owns `useCamera` + the viewport size so
   `ZoomControls` stays presentational, per the design.
4. **Keyboard shortcuts are bound on `window`** (`keydown`, capture-free bubble phase) for
   Ctrl/Cmd + `=`, `+`, `-`, `_`, `0`, skipped when the event target is editable, matching
   the design's "keydown on window". Ctrl+`=` is what `Shift`+`=` produces on the tested
   layouts, so both `=` and `+` zoom in.
5. **Drag only starts on the viewport or the grid layer** (`data-pan-target`), so later
   object stories can stop propagation, and the pointer is captured for the whole gesture
   with `pointerup`/`pointercancel`/`lostpointercapture` all ending the pan (TC-14).
6. **Test hook** lives in `src/client/canvas/testHooks.ts`, registered only when
   `import.meta.env.MODE === 'test'`. Verified: `grep -rl "__vidi6" dist/client/assets/*.js`
   finds nothing after `npm run build` (production) and finds the chunk after
   `npm run build:test`. e2e runs against the test build via `npm run e2e:build`.
7. **Origin marker** is a 16px crosshair at world (0,0) inside the world layer, present in
   production builds too (design's fixture note), with `data-testid="origin-marker"`; e2e
   uses it (and the computed dot-grid background) as the pixel target.
8. **Ports** stay in the allowed 27424–27439 range: `dev`/`preview` 27424, e2e server
   27426 with wrangler inspector 27427 (both overridable with `AGENT_PORT_E2E` /
   `AGENT_PORT_E2E_WRANGLER` so CI can move them inside the range).
9. **`wrangler.jsonc`** has `assets.directory = "dist/client"` and no `binding`: an
   assets-only Worker must not declare one. Story 3 adds `main` plus the binding.
10. **Grid rendering** follows the design formulas: `background-size =
    GRID_SPACING_WORLD * zoom`, `background-position = (-x * zoom) mod spacing`, world
    layer `transform: scale(zoom) translate(-x px, -y px)` with `transform-origin: 0 0`.
    Both were checked numerically in e2e (TC-23, TC-27) rather than by snapshot.
11. **TC-33** (shortcuts while the browser chrome has focus) is documented in the design
    as not testable in-page and has no test, as instructed.

## Blocked on this machine

- **Firefox and WebKit cannot be launched here.** Playwright 1.56's Firefox (142.0.1) and
  WebKit abort during process launch (`SIGABRT` / `Abort trap: 6`) before Playwright can
  connect, headless or not, with or without sandbox-relaxing env vars; Chromium starts
  fine, and the same specs pass there. This is an environment limitation of this sandbox,
  not of the tests or the app: the three browser projects are configured, and
  `E2E_BROWSERS=all npm run test:e2e` runs all three on a machine that can start them.
- To keep `npm run test:e2e` honest and green here, `tests/e2e/helpers/browsers.ts` probes
  which browsers can actually be launched (result cached in
  `node_modules/.cache/vidi6-e2e-browsers.json`) and skips the others with a printed
  warning instead of reporting a failure. `E2E_BROWSERS=chromium[,firefox]` (or `all`)
  overrides the probe. Nothing about the app or the specs was weakened to get here: every
  case that ran in Chromium also runs in Firefox and WebKit wherever they can start.
- **Playwright is pinned to 1.56.1**, not a newer line: newer Chromium builds are fetched
  from `storage.googleapis.com`, which this machine's proxy refuses (403). Revision 1194
  (Chromium), 1495 (Firefox) and 2215 (WebKit) are downloadable from
  `cdn.playwright.dev/dbazure`, so `PLAYWRIGHT_BROWSERS_PATH=…/browsers` versions were
  installed there manually. Node 24 also hangs the runner of Playwright ≤ 1.52, which is
  why the version is pinned in `package.json` rather than floated.
- **Browser binaries** come from `PLAYWRIGHT_BROWSERS_PATH` (set to
  `../browsers` here, where revisions 1194/1495/2215 were installed with
  `npx playwright install chromium firefox webkit`). `playwright.config.ts` does not
  hard-code a path, so the usual default (`~/.cache/ms-playwright`) also works.
- **`wrangler dev` metrics** are disabled in the e2e `webServer` command
  (`WRANGLER_SEND_METRICS=false`, `CI=1`) because the analytics upload tries to reach
  Cloudflare endpoints over a proxy that blocks them, which delays server start-up.

## Things worth knowing when story 2 starts

- `tests/component/fixtures/board.tsx` is the place to reuse: it renders the whole board
  with a jsdom `ResizeObserver` fixture (1280x800), reads the camera from
  `[data-testid="viewport"]` (`data-camera-x/y/zoom`, `data-state`), and has pointer,
  wheel and Safari-gesture dispatchers.
- `App.tsx` currently mounts only the board; the collaboration bits from stories 2–5 slot
  in there, and `src/shared/config.ts` is the single place for new named settings.

---

# Story 2: Capture ideas on sticky notes and rearrange them

Same rule as story 1: the design's file layout, exported names, function contracts and UI
text were followed literally. Everything below is either a place the design left a choice
open, an addition that was needed to make it work, or something this machine cannot do.

## Followed from the design exactly

- Every named setting in `src/shared/config.ts` (`STICKY_SIZE_WORLD = 200`,
  `STICKY_TEXT_MAX_CHARS = 1000`, `STICKY_COUNTER_THRESHOLD_CHARS = 50`,
  `STICKY_FONT_MAX_PX = 24`, `STICKY_FONT_MIN_PX = 10`, `DRAG_THRESHOLD_PX = 3`,
  `STICKY_COLORS` with the six swatches in toolbar order) and the exported contracts of
  `src/shared/board-model.ts` (`initDoc`, `createSticky`, `moveObject`, `bringToFront`,
  `setStickyColor`, `deleteObject`, `getStickyText`, `snapshot`, `LOCAL_ORIGIN`) and
  `src/client/objects/StickyText.ts` (`clampToLimit`, `counterVisible`, `applyTextDiff`,
  `fitFontSize`).
- Exact UI text: button label `Sticky note`, tooltip/`aria-label`
  `Sticky note – or double-click the board`, swatch labels `Yellow colour`,
  `Orange colour`, `Green colour`, `Blue colour`, `Pink colour`, `Violet colour`,
  `Delete note`, and the counter as `n/1000`.
- Selection and editing state never touch the document: they live in `useSelection` and
  nothing about them is written to the Y.Doc (asserted in
  `tests/component/sticky-notes.integration.test.tsx`).
- `sticky.text` mutations are made only through `board-model` functions, which never throw
  for user-driven input and return `false` on rejection; `applyTextDiff` never splits a
  surrogate pair, so emoji survive typing next to them (TC-16).
- Test layer split as designed: TC-01 to TC-17 and TC-39 in `tests/unit`, TC-18 to TC-29
  and TC-35 to TC-38 in `tests/component` (`StickyNote.test.tsx`,
  `StickyTextEditor.test.tsx`, `Toolbars.test.tsx`), TC-30 to TC-34 in
  `tests/e2e/sticky-notes.spec.ts`.

## Decisions and additions

1. **`createSticky(doc, at)` treats `at` as the centre of the note**, not its top-left:
   it subtracts `STICKY_SIZE_WORLD / 2` internally. TC-30 requires the note to be centred
   under the pointer that double-clicked, and TC-34 requires a button-created note to be
   centred on the screen, so "where the note goes" is a centre everywhere. The document
   still stores the top-left corner, which is what the world layer renders.
2. **Drag tracking is on `window`, not via pointer capture.** The design's state diagram
   uses `setPointerCapture` and `lostpointercapture`. In the real app, the drag-start
   `bringToFront` (required by TC-32) re-orders the keyed children of the world layer, and
   re-inserting the note's DOM node releases the capture — the drag died after the first
   pointer move. `src/client/objects/StickyNote.tsx` therefore registers
   `pointermove`/`pointerup`/`pointercancel` on `window` for the duration of the gesture and
   removes them when it ends (and on unmount). Every other edge of the diagram — Pressed,
   Dragging, `DRAG_THRESHOLD_PX`, rAF-throttled `moveObject`, one `bringToFront` per drag,
   position frozen at the last applied frame — is as designed.
3. **Additive exports beyond the design's contract list**: `objectExists(doc, id)` (used to
   ignore mutations aimed at a note that another tab deleted, TC-37) and `minimalEdit`
   from `StickyText.ts` (the shared prefix/suffix diff is asserted directly in TC-14 to
   TC-17). `LOCAL_ORIGIN` is exported as designed and used by every UI-driven mutation so
   story 3 can tell local edits apart.
4. **`useSelection` keeps `selectedId` and `editingId` in one state object** with an
   equality guard, so "double-click an unselected note" is a single update and React never
   sees a `setState` call inside another updater (StrictMode double-invokes those).
5. **The selected note gets a CSS `z-index` of 1,000,000** (`SELECTED_STACK_ABOVE`) on top
   of its model `z`, so its own toolbar is never hidden behind a neighbour that comes later
   in document order. Model `z` is untouched, so the stacking everyone else sees is
   unchanged.
6. **The text inset is one named constant**: `STICKY_PADDING_WORLD = 12` is written to a
   `--vidi6-sticky-pad` custom property on the note, which both `.vidi6-sticky-content` and
   `.vidi6-sticky-editor` read, so the measurement box and the editing box cannot drift
   apart from the constant.
7. **The editor is an uncontrolled `<textarea>`.** React's controlled textarea fights the
   clamp-and-restore-caret behaviour the design asks for: the component listens for `input`
   natively, clamps through `applyTextDiff`, restores the caret to the end of what the user
   just typed, and ignores the event while an IME is composing. `Escape` ends editing and
   leaves the note selected; a pointerdown outside the note ends editing and clears
   selection (TC-38).
8. **`BoardViewport` gained two optional props** (`onCreateStickyAt`, `onEmptyClick`) and a
   double-click handler that only fires when the double-click landed on the board itself
   (`event.target === event.currentTarget`), which is what makes TC-35 (double-clicking an
   existing note edits it, it does not create another one) fall out for free. The click that
   clears selection is distinguished from a pan by the same `DRAG_THRESHOLD_PX` used for
   notes, so no second magic number was introduced.
9. **`useBoardDoc` never destroys its `Y.Doc` on unmount** — React StrictMode mounts twice,
   and a destroyed document would leave the second mount empty. Story 3 attaches its
   provider to the same document.
10. **jsdom has no font metrics**, so `scrollHeight` is always 0 there: font fitting always
    reports "fits", and TC-33 (shrink to fit, then clip with the fade) is a browser-only
    case, exactly as the design's `sticky.text` row says. The component tests cover the
    text, the limit and the counter; e2e covers the 24px → shrunk → clipped-with-fade
    progression and the `1000/1000` counter.
11. **One extra test file the design does not list**:
    `tests/component/sticky-notes.integration.test.tsx`. The design deliberately has no
    integration layer for this story (there is no request-handling boundary yet). These
    tests sit in the same jsdom layer as the component tests, and stand in for story 3's
    second browser by editing the document directly: which fields of the document a drag is
    allowed to change, that a sub-threshold press changes nothing, that selecting and
    editing change nothing, and that a remote move/recolour/delete/text change shows up on
    the board. Nothing about the app was changed for them.
12. **`objectExists` and the stale-id path**: `deleteObject` and the drag path are safe
    against a note that vanished mid-gesture, and the note's own effects detach their
    window listeners on unmount, so a remote delete during a drag or an edit ends the
    interaction silently (TC-37).

## Blocked on this machine

- Unchanged from story 1: **Firefox and WebKit cannot be launched here**, so the four new
  e2e cases run in Chromium only (`tests/e2e/helpers/browsers.ts` probes and warns). They
  use nothing browser-specific — standard Playwright mouse/keyboard input, `boundingBox()`,
  `elementFromPoint()` and `getComputedStyle()` — and `E2E_BROWSERS=all npm run test:e2e`
  runs them in all three browsers on a machine that can start them.

## Current test totals

- `npm run test:unit` — 55 tests.
- `npm run test:component` — 67 tests (32 in the three design-named files, 10 in the
  integration file, the rest in story 1's camera tests).
- `npm run test:e2e` — 12 tests (8 from story 1, 4 from story 2).
- `npm run typecheck` — clean.

## yjs update streams are clock-contiguous per client (discovered building task 3)

Skipping a damaged row when replaying the log works for every *other* client's
updates, but a client's own later updates are held by yjs in
`store.pendingStructs` until the gap is filled: yjs integrates a client's structs
only against that client's own clock. Consequences baked into `BoardStore`:

- Quarantine keeps the damaged row's author's later rows in the log: they stay in
  yjs's `pendingStructs` on every load (inert — they cost display, not data, and
  never leave the disk).
- `compactIfNeeded` refuses to truncate while the last load left
  `store.pendingStructs` non-null (`logHasPending`), so compaction can never
  delete the only copy of paused rows (TC-09 gap guard).
- `load` applies each row to a throwaway probe doc first: `Y.applyUpdate` throws
  *inside* its transaction and poisons the target doc — everything applied
  afterwards is silently lost. The probe takes the hit; the real doc only ever
  sees bytes that survived.

## Hibernation changes what a room object is (discovered building tasks 4–5)

Switching `BoardRoom` to `ctx.acceptWebSocket` broke three things that story 3 took
for granted, all found by the real-SQLite/real-eviction integration tests:

- **`setInterval` blocks eviction.** A local DO is only evictable (`evictDurableObject`)
  once it is idle; a 10-second keepalive `setInterval` means the object is never idle
  while sockets are open, so hibernation never happens and eviction times out. The
  interval was replaced by a chain of `ctx.storage.setAlarm` fires (Cloudflare's own
  recipe for hibernatable-socket keepalive): the object sleeps between pings, the
  ping chain ends by itself when the last socket closes.
- **`binaryType = 'arraybuffer'` does not survive hibernation.** A socket accepted
  before an eviction hands its next message to the reconstructed object as a **Blob**,
  not an ArrayBuffer — and the new object never had a chance to set `binaryType` on
  that socket. `webSocketMessage` now normalises `Blob → ArrayBuffer` before decoding.
  (A `new Uint8Array(blob)` of a Blob is *empty*, not an error, so the old code
  answered every woken socket with a 1003 close: corrupted-invisible, not corrupt.)
- **A load failure must live in storage to be testable.** Anything injected into a
  live object (like `BoardStore.testBeforeExec`) dies with eviction, and forcing
  `loadNow()` on a `ready` room cannot reach `load-failed` — the pinned state machine
  has no such edge (correctly: TC-27 pins it). The integration fixtures damage the
  storage itself instead: the updates table is left present with the wrong columns,
  so `migrate`'s `CREATE TABLE IF NOT EXISTS` cannot heal it and the next room
  object's own load fails for real — and can be healed again from the same side.

Also found by tests: `createSticky(doc, at)` **centres** on `at`; the stored `x`/`y`
are `at - STICKY_SIZE_WORLD/2`. An assertion written as `x === 12` after
`createSticky(..., {x: 12})` is wrong by 100 and was not wrong in any earlier story
because no earlier test checked a created note's stored position.

## The persistence e2e suite (tasks 6 and 9)

`tests/e2e/helpers/wrangler-process.ts` owns a `wrangler dev` per suite: its own port
(27428), its own `--persist-to` temp directory, and a `restart()` that kills the process
and starts another on the same directory. That is the whole distinction story 4 turns on
— the process forgets, the storage does not — and no shared Playwright `webServer` can
offer it. `playwright.persistence.config.ts` is a separate project (`workers: 1`, no
webServer); the main config `testIgnore`s the two specs so neither suite runs the other's.

- Seeding is done through the room's own door, not around it: the `seed-notes` and
  `pump-notes` test hooks (TEST_HOOKS-gated, POST-only) call `createSticky` and colour
  sets on the room's doc, so every seeded note goes through `store.append` like any
  other change — and `pump-notes` crosses the compaction threshold for real, so TC-24
  damages a snapshot the server itself wrote.
- `tests/e2e/production-hooks.spec.ts` runs against the *production* webServer (started
  without `TEST_HOOKS`) and shows POSTing the hook routes gets a 404: the routes are
  not there.
- Load time is reported, not asserted: TC-21 measures navigation to fully rendered
  `PERSIST_TESTED_NOTES` notes (note *elements* in the DOM, not doc entries) against
  `BOARD_LOAD_BUDGET_MS`; measured ~2.1 s against a 3 s budget on this machine.
- What e2e geometry costs you (found the slow way): a double-clicked note is a note
  being typed into, so every `createNoteAt` leaves an editor open until `endEditing`;
  a note with text **grows downwards**, so typing must happen after every double-click
  of a test; and the bottom-left corner is the zoom widget's — a double-click at
  (250, ~700) zooms the board to 64% instead of creating a note.

# Story 5: Share a board with others using a link

## Followed from the design exactly

- Board ids stay 128 random bits (`newBoardId()`), never derived from time or counters;
  `BOARD_ID_PATTERN` decides what a board address is, on the Worker and in the client.
- `POST /api/boards` → 201 `{id}` / 500 `create_failed`, other methods 405;
  `GET /api/boards/:id` → 200/404; a malformed id is 404 with no RPC and no storage
  touched; the WebSocket route answers 404 before accepting anything.
- The board page is given an address and nothing else, so it asks the service whether the
  board exists, shows `Opening board…` while it asks, retries while the service is
  unreachable, and never decides "not found" from local memory.
- Share panel state `closed | open | copied | manual_copy`, `LINK_COPIED_MS` confirmation,
  manual-copy fallback that selects the field, and the security note under the link.
- Wall-clock budgets (`CREATE_BUDGET_MS`) are logged in e2e, never asserted.

## Decisions and additions

- **Existence is read-only and three questions deep** (`BoardStore.existsReadOnly`): tables
  in `storage_meta`? then `created_at`; rows in `updates`/`snapshot_chunks`? then it is a
  legacy board (story 1–4) and it exists. `load()` no longer migrates: a probe of an
  unknown link creates no tables, which is what makes TC-06/TC-09 negative assertions
  possible at all. `append()` migrates lazily, `initialize()` migrates and stamps
  `created_at`.
- **`initialize()` returns `created` | `exists`** and `markCreatedAtIfAbsent` is false the
  second time, so a collision can only ever end as `create_failed` — the app never takes
  over a board it did not make (TC-15).
- **A malformed board address gets the same 404 an unknown board gets**, not a 400:
  nothing is revealed, and `idFromName` is never called with junk (TC-07).
- **The router is `useSyncExternalStore` over `popstate`** plus an internal notify, with
  the route snapshot cached per pathname (an uncached snapshot re-renders forever).
  Story 3's `#/b/:id` links still open boards, so a saved hash link is not a broken link.
- **`checkBoard` has three answers, not two**: `exists`, `not_found`, `unreachable`.
  Anything that is not a decided 200/404 — a 500, a timeout, a body that is not JSON — is
  `unreachable`, i.e. "we do not know yet", which is the honest reading and the one that
  keeps retrying.
- **Page state machines are pure functions** (`src/client/pages/state.ts`), including the
  retry delay (`boardCheckDelayMs`, doubling from `BOARD_CHECK_RETRY_BASE_MS` up to
  story 3's `RECONNECT_MAX_BACKOFF_MS`). The retry count survives the
  checking→unreachable→checking cycle so a message that already explained the failure
  does not blink out (TC-21).
- **Component tests stub `fetch`, not `api.ts`** (the design's table says "mocked
  `api.ts`"). A mocked `api.ts` would let the status-code-to-outcome mapping — the thing
  the pages are built on — go untested at the component level, so the stub sits one layer
  lower at `tests/component/fixtures/api.ts` and records every request. That is also what
  lets TC-19 be a negative test: no request was made for an impossible id.
- **The Share button stays mounted while the panel is open.** Swapping button for panel
  would mean focusing an element React had just removed, and "the keyboard goes back where
  it came from" would silently stop working (TC-25).
- `renderBoard` in the component fixtures returns the board id, so a test can assert on the
  link the app built rather than one it invented.

## The e2e side of story 5 (task 7)

- `boardLink(boardId)` is now `/b/:id` (was `#/b/:id`). Since story 5 a link to a board
  nobody made is a board that is not there, so **every story that wants a board now makes
  one**: `createBoard` / `createBoardLink` in `helpers/participants.ts` POST to the same
  server the browser is talking to (via `context.request`, so the port comes from the
  config, not from a constant), and story 3's specs take the id from there. Story 1 and 2
  specs change in one place: `gotoBoard` now lands on Home and presses *New board*, because
  that is how anybody reaches a board.
- `tests/e2e/persistence.spec.ts` creates its boards with a plain `fetch` to the port it
  owns (`boardHere()`): TC-19/TC-20 need boards they can come back to after a process dies.
- **TC-31 owns a second `wrangler dev`** (port 27430, `TEST_HOOKS:1`) inside `share.spec.ts`.
  It needs the seeding hooks, and the shared webServer must not have them — their absence
  is story 4's `production-hooks.spec.ts`. The legacy board is seeded with `seed-notes`,
  which writes through `store.append` and never through `initialize()`, so it has
  `updates` rows and no `created_at`: exactly the board a story 1 visitor left behind. A
  control in the same test opens a never-seeded link on that same server and gets Board
  not found, so "its data is what makes it exist" is a comparison and not a coincidence.
- TC-28 aborts `**/api/boards/*` with `page.route`, waits for the retry message, marks the
  window with a property a reload would wash away, unroutes, and asserts the board arrived
  on the *same* page.
- TC-29 installs a rejecting `writeText` with `addInitScript`, so the fallback is the
  app's real behaviour against a clipboard that refused, and asserts the field's selection
  equals the address in the bar.

## Blocked on this machine

- **Only Chromium can launch here.** `helpers/browsers.ts` probes the installed browsers and
  this machine aborts Firefox and WebKit at process launch (`SIGABRT`, seen directly with
  `E2E_BROWSERS=firefox`), so the suite runs one browser. The design wants TC-27 and TC-29
  in Firefox and WebKit too; on this machine they run in Chromium only.
- TC-26 (real clipboard read-back) and TC-31 (needs the hooks server) are marked
  Chromium-only in the spec itself, for the reasons the design gives: clipboard permission
  is engine-specific (TC-29 forces the other path in every engine), and whether a board
  exists is the server's memory rather than a browser behaviour.

## Current test totals

Unit 129, integration 62, component 92, e2e 25 (Chromium) plus the persistence suite's 4.
The nightly suite (2 tests) compiles and is listed; the soak itself was not run for this
story, which does not touch what it measures.

# Story 8 — "Undo and redo my own changes without undoing anyone else's"

## Followed from the design exactly

- Both named settings in `src/shared/config.ts` (`UNDO_CAPTURE_TIMEOUT_MS = 500`,
  `UNDO_MAX_STEPS = 200`), every named file (`src/client/board/undo.ts`, `useUndo.ts`,
  `UndoButtons.tsx`, `tests/unit/undo-history.test.ts`, `tests/unit/undo-boundaries.test.ts`,
  `tests/component/UndoBoundaries.test.tsx`, `tests/component/UndoControls.test.tsx`,
  `tests/e2e/undo.spec.ts`, `tests/e2e/helpers/undo.ts`), and the exported contracts
  (`UndoController`, `UndoOptions`, `createUndo(doc, options)`, `UndoButtonState`).
- The UI text verbatim: `aria-label="Undo"` / `aria-label="Redo"`, tooltips
  `Undo (Ctrl/Cmd+Z)` and `Redo (Ctrl/Cmd+Shift+Z)`, both buttons in the left toolbar under
  the Sticky note button, disabled when their stack is empty.
- `undo.session_only` is what the design asks for and what `Y.UndoManager` gives: the history
  is a tab's own object, nothing about it goes into the document, and an undo or redo is a
  local transaction like any other change — which is exactly why the other person sees it.

## Decisions and deviations

1. **The controller is created in `Board.tsx`, not `App.tsx`.** The design's `App` passes a
   `doc` to `Board`, but the doc is made by `useBoardDoc` *inside* `Board`, and `App` has no
   doc to hand over. Creating it where the doc lives also puts `destroy()` on the board's
   unmount, so a board remount starts a fresh history — which is what "a person's history is
   scoped to one open board" means. A second mount of the same doc (React StrictMode in dev)
   creates a controller that is then destroyed; nothing observes it.
2. **`UndoContext` (`useUndoController()`) instead of a field on `ObjectProps`.** The object
   renderers (`StickyTextEditor`, `StickyNote`) need the controller to open a step around
   typing and around toolbar actions; `ObjectProps` is story 1/2's contract for every object
   type, and only one type cares.
3. **`useTransformGesture.ts` is unchanged.** The design lists it as a caller of
   `undo.boundary()`. It already had `onGestureStart`/`onGestureEnd` from story 7, so `Board`
   passes `undo.boundary` to both — the gesture stays undo-agnostic, and the boundary lands
   exactly once around the whole drag including its final coalesced write.
4. **The note toolbar's two actions take their boundary in `StickyNote`'s handlers**
   (`handleColor`, `handleDelete`), since `NoteToolbar` is presentational and owns no
   transactions. Discrete actions are wrapped *before and after*, so two quick clicks on
   different swatches are two steps rather than one merged pair.
5. **The undo/redo shortcut branch sits in front of the generic "some modifier is down, so
   this is not the board's key" bail-out** in `useBoardKeys`, because Ctrl/Cmd+Z *is* the
   board's key. When the board cannot be edited it is ignored *without* `preventDefault`, so
   the browser keeps its own undo on a board that must not change (TC-20).
6. **`useUndo` mirrors the stacks into React with a `useReducer` bump** from the manager's
   `stack-item-added`/`-popped`/`-updated`/`stack-cleared` events, and gates `canUndo`/`canRedo`
   on `canEdit` as well, so the buttons are disabled *and* the shortcut is left alone.
7. **Ctrl/Cmd+Z typed inside a note is handled by the editor itself** (preventDefault, then
   undo, then re-sync the textarea from the shared text). The browser's own textarea undo
   would otherwise move the caret and the shared `Y.Text` apart.
8. **Trimming the stack** is `undoStack.shift()` past `UNDO_MAX_STEPS` in the
   `stack-item-added` handler; the manager's own `stack-item-limit` event is never reached
   because `stackitem-limit` only fires when `undoManager.stackItemLimit` is set, and the
   design's default is `-1` (unlimited).

## yjs findings (building tasks 2, 7 and 9)

- **`lib0`'s `getUnixTime` is `Date.now`, captured at module load.** `vi.useFakeTimers()` or
  `vi.spyOn(Date, 'now')` installed afterwards do not move the capture window, because yjs
  holds the function reference it took from `lib0/time` at import. `tests/unit/fake-clock.ts`
  replaces `Date.now` on the module's *first import*, before `yjs`, and the boundary tests
  import it first. Measured against the setting: a 499 ms gap merges the two changes, exactly
  500 ms does not (`now - lastChange < captureTimeout`, strict `<`) — so TC-13's "exactly
  `UNDO_CAPTURE_TIMEOUT_MS` apart is two steps" is the real boundary.
- **`popStackItem` loops until something actually changed.** A stack item whose target has
  been deleted by somebody else is dropped silently and the same Ctrl+Z carries on to the
  next item. TC-07 records the consequence: one press restored the earlier of two steps whose
  note had vanished, and redo still worked.
- **Any new tracked change clears the redo stack** (`afterTransactionHandler` →
  `this.clear(false, true)`), so the Redo button goes from enabled to disabled the moment this
  person does something new (TC-18's second half).
- **Redo comes back oldest-first.** `undo()` pushes what it popped onto `redoStack`, and
  `redo()` pops the end — the *last* thing undone, which is the *earliest* step. In TC-22 the
  first redo brings back the move, and the deletion is the last change to return.
- **`manager.destroy()` removes the `afterTransaction` and `destroy` listeners it added**, so a
  destroyed controller leaves no transaction observer behind on a doc that outlives the board
  (TC-11 asserts that, by writing to a doc both managers can see).

## Running the three browser cases (task 5)

- `design.md` and `tasks.md` describe TC-22, TC-23 and TC-24 as three concrete browser
  workflows (box-select and delete eight notes; somebody else deletes the note I moved;
  `MAX_CONCURRENT_EDITORS` people each undoing their own steps at once) and `prd.md` uses
  those ids for three *different* stories. The three tests named TC-22/23/24 implement the
  design/tasks workflows, since tasks.md is what the acceptance list ticks; the PRD's three
  scenarios are each implemented too, named after the scenario, so nothing in either
  document goes untested.
- `tests/e2e/helpers/undo.ts` holds the four things every case needs: Ctrl/Cmd+Z and
  Ctrl/Cmd+Shift+Z, clicking the toolbar buttons by their accessible name, their tooltips, and
  one assertion for the enabled/disabled pair.
- TC-24 takes the room in two stages, and that is deliberate: after *everybody* has undone
  there is nobody's work left to be still there, so "without undoing anyone else's" cannot be
  asserted then. Stage one has one person undo their two steps *alone*, and checks in all five
  browsers that their own steps are gone and everybody else's work is untouched — a claim
  about the other four screens, not just theirs. Stage two has the rest undo at once and
  checks that the room ends on one identical board — the same board it started with, because
  every step was taken back by the person who made it.
- Between a drag and the typing that follows it in TC-24 the test waits
  `UNDO_CAPTURE_TIMEOUT_MS + 100`. Without that the two would merge into one step on a slow
  machine and stay two on a fast one, and the two `Ctrl+Z`s would mean different things.

## A cascade React was right to refuse (found by TC-24)

With five people on one board undoing at once, the production bundle threw minified React
error #185 — "Maximum update depth exceeded" — from inside the yjs observer, which y-protocols
caught and logged as `Caught error while handling a Yjs update`. The board carried on being
clickable while showing a state the document no longer held.

- **It was not undo's bug.** `useSelection` derived `presentIds` with `new Set(...)` from the
  object snapshot, and the snapshot array is rebuilt on every document change. Its prune
  effect therefore had a new dependency on every remote change, and dispatched a state update
  for each — on top of the store notification that brought the snapshot at all. When changes
  arrive one after another, every render pass leaves another still pending, which React calls
  a nested update cascade, and past fifty of them it stops the root rather than hanging the
  tab. Undo storms are only the first thing in this app that has ever arrived faster than
  React can render.
- **The fix** is in `useSelection.ts`: hand back the *same* set while the document holds the
  same objects, so the effect — and the dispatch — happens when objects come or go, and not
  once per keystroke of somebody else's typing.
- **Two things that looked like fixes and were dropped.** Coalescing the store notifications
  to one per burst of `observeDeep` calls, and routing them through `startTransition`, both in
  `useBoardDoc.ts`: each lowered the pass count, neither removed the crash, and both would
  have changed when story 1's bridge updates the screen for every surface in the app.
- **What guards it**: TC-24 failed in 3 of 3 runs (`--retries=0`) before the fix and has
  passed in every run since. The cascade itself is React-internal and only appears in the
  production bundle in a real browser, so the added component test ("the board keeps up with a
  burst of remote changes while something is selected", `tests/component/Selection.test.tsx`)
  pins the behaviour at component speed rather than the cascade.

## Current test totals for story 8

Unit 224 (14 files), component 158 (19 files), integration 62 (5 files), e2e 36 (Chromium
only, as ever on this machine — 6 of them `tests/e2e/undo.spec.ts`), plus the persistence
suite's 4 on its own config. The nightly suite compiles and is listed; the soak and load runs
themselves were not run for this story, which does not touch what they measure.

# Story 9 — Write free text anywhere on the board

## Followed from the design exactly

- The `text` schema is `objects[id] = { type:'text', x, y, width, height, z, createdAt,
  createdBy, text: Y.Text, size, widthMode }`; nothing text-specific is added to selection,
  move or delete code, which is what makes `text.consistent` true (TC-33, TC-34).
- The stored box is measured and written by the client that made the local change, in the
  same undo window, and is never rewritten by a client that only received it — so TC-12 and
  TC-13 hold, and five people typing into one board produce one writer per change.
- `layoutText` takes a `Measurer` so every wrapping rule is unit-tested with a fake
  (TC-07 to TC-11, TC-32) and the canvas only appears when one exists.
- The toolbar order the PRD gives (Select, Text, Sticky note), `aria-pressed` on the two
  pointer tools, the Sticky note button's label becoming "Sticky note (N)", `canEdit` false
  disabling the Text button and taking an active Text tool back to Select.

## Decisions and deviations

- **`TextSnapshot extends ObjectSnapshotBase`, not `ObjectSnapshot`.** `ObjectSnapshot` is a
  union of the per-type snapshots, and an interface cannot extend a union. The shared
  `snapshot()` reads text objects through the same base fields it always read, and the text
  fields are read by `readText` in `src/shared/objects/text.ts`. A stale `type` from a synced
  document is still just a string, so every read falls back to a default instead of drawing
  nothing.
- **`newObjectId()` and `topZ(doc)` are exported from `board-model.ts`** rather than
  re-derived in `text.ts`: the id scheme and the "on top of everything" rule belong to the
  model, and copying them would let the two drift. Neither export knows what a text is, which
  is the direction the requirement asks for.
- **`createdBy` needs an author and story 6 does not exist yet.** `src/client/useLocalIdentity.ts`
  is a per-tab random id, nothing more. It is deliberately not called `useIdentity`: when
  story 6 arrives with names and cursors it owns that name and this file goes away.
- **The Text tool intercepts a press at the document, in the capture phase.** React 19
  delegates its own handlers to the root, so anything listening inside the viewport sees a
  press too late to stop it; a capture listener on `document` is the one place that sees it
  first. It stops propagation for presses inside the viewport only, so the toolbar, the share
  panel and the zoom controls go on answering, and CSS puts
  `pointer-events: none` on the world layer so the cursor, the pan and the marquee agree with
  the events. A press is turned into a text on `pointerdown` rather than on `click`: while the
  tool is up nothing pans the board, so there is no drag to distinguish from a click.
- **The tool goes back to Select after it has placed a text** (PRD step 2, TC-17). My first
  attempt kept the tool up so several texts could be placed in a row; that is not what is
  specified, and it is not what a tool that puts things on a shared board should do — the
  second click of a double click would otherwise be a second text.
- **`n` is new in this story.** Story 2 gave the Sticky note button a tooltip with no
  shortcut in it, so `toolForShortcut` introduces `n` and routes it to the same
  create-a-note-at-the-view-centre action the button uses; TC-18 is its regression test. It is
  listed in the same map as `v` and `t` because a key that changes the tool and a key that
  creates an object must not have two opinions about what the current tool should be.
- **Task order:** task 8 is implemented before task 7's tests are written. TC-17 asserts that
  an editor is mounted for the new id, which needs a registered text object that renders;
  the alternative was a test file that could not pass. The commits are `feat` for both
  implementations, then `test` for both suites.

## The e2e side of story 9 (task 10)

`tests/e2e/text.spec.ts` (8 tests) and `tests/e2e/helpers/text.ts`. The design names no
end-to-end helper file, so the new helpers sit beside the ones stories 3 and 7 grew rather
than inside them; `tests/e2e/helpers/text.ts` reads text objects out of the document and
drives the Text tool, and nothing in it knows what a sticky note is.

- **The new text's id comes from the screen, not from the document.** `createTextOnBoardAt`
  used to diff `boardNotes()` before and after the click; on TC-30, where five people each
  place a heading at the same moment, that diff found somebody else's heading and typed into
  the wrong object. It now asks which text object *this* screen is editing
  (`editingTextId`: the element with `data-editing="true"` that holds the editor), which is
  the object the click made by definition.
- **`boardNotes()` lists every object, including texts.** Any test that counts sticky notes
  filters `type === 'sticky'` first — otherwise a heading that was just restored by Ctrl+Z
  looks like a note that came back too.
- **Ctrl+Z does not restore a selection**, because selection is per-person and undo is not
  about people. The mixed note-and-text test therefore asserts the objects came back (one
  sticky, one text saying what it said), not that the count badge returned.
- **A text's top-left is the point that was clicked** (PRD `text.tool`: "its top-left at the
  clicked point"), which is the opposite of a sticky note, which centres itself. The two
  tests that place a heading above a cluster of notes are written that way round.
- **Wrapping is measured off the browser.** TC-26 and TC-27 count the line boxes the browser
  made (`Range.getClientRects()` over the painted text, `renderedLines`) instead of counting
  what the client's own layout pass decided, since the point of those two tests is that the
  client measured with the fonts it actually has. TC-26 asserts the box the document holds
  and the box that is painted agree to within 2 units.
- **TC-29 compares characters, not strings.** Two people typing into one `Y.Text` merge into
  one run whose *order* depends on which insert won at each position, so the test asserts
  both screens hold the same string and that its sorted characters are exactly the ones the
  two of them typed — every character once, nothing lost, nothing doubled.
- **TC-30 opens `MAX_CONCURRENT_EDITORS` contexts** (5 here), one per heading, and drives
  them concurrently: `Promise.all` over people pressing `t`, clicking, typing and pressing
  Escape. Then every screen must show all five, drawn as well as stored
  (`[data-note-type="text"]` counted on each page).
- Ports are the same 27426/27427 as every earlier suite, inside the allowed range.

## Blocked on this machine (story 9)

- TC-26 is specified for Chromium, Firefox and WebKit, because where a line ends is the
  browsers' business and a client that only looks right in its own font engine is wrong
  twice. Firefox and WebKit cannot be launched on this machine (`SIGABRT` at process launch,
  documented for stories 1, 3 and 8), so all 8 tests in `tests/e2e/text.spec.ts` ran in
  Chromium. Nothing in the two wrapping tests is Chromium-specific: they read the line boxes
  the browser made and allow 2 units of slack on a width, so wherever the three browsers can
  start — `E2E_BROWSERS=all` — the same case runs three times.

## Current test totals for story 9

Unit 243 (16 files), component 190 (22 files), integration 62 (5 files), e2e 44 (Chromium
only, as ever on this machine — 8 of them `tests/e2e/text.spec.ts`), plus the persistence
suite's 4 and the nightly suite's runs on their own configs, which this story does not touch.

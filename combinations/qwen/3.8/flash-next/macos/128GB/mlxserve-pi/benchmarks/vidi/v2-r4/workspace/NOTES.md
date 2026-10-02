# Notes — story 1: Pan and zoom around an infinite board

Decisions, deviations and environment notes for the work in commits `1358dd7`..HEAD.

## How to run

```
npm run dev             # vite dev server on http://127.0.0.1:21056 (DEV_PORT to change)
npm run build           # production client build → dist/client
npm run build:test      # same build with window.__vidi6 camera hook (used by e2e)
npm run typecheck       # tsc --noEmit
npm run test:unit       # vitest, node environment   (tests/unit, camera.math)
npm run test:component  # vitest, jsdom environment  (tests/component)
npm run test:e2e        # playwright, serves dist/client with wrangler dev
npm test                # unit + component
```

`npm run test:e2e` starts its own web server: `npm run build:test && wrangler dev
--ip 127.0.0.1 --port 21062 --inspector-port 21063` (overridable with `E2E_PORT`
/ `E2E_INSPECTOR_PORT`). Everything listens inside the port range assigned to
this task (21056–21071).

## Design decisions

**Camera representation.** `Camera = { x, y, zoom }` where `x, y` is the world
coordinate at the top-left of the visible board area and `zoom` is screen pixels
per world unit. Everything else follows from that: `worldToScreen = (p - xy) *
zoom`, `panBy` shifts by `-delta / zoom`, and `zoomAt` holds the world point
under the pointer fixed by solving `x = w.x - p.x / newZoom`. Only one
transform is therefore needed in the DOM.

**One transform for the world, one background for the grid.** The world layer is
a zero-size, `overflow: visible` div with
`transform: scale(zoom) translate(-x px, -y px)` (`transform-origin: 0 0`), so
children placed in world coordinates need no per-child maths. The dot grid is
painted on the viewport surface itself as a `radial-gradient` background with
`background-size = GRID_SPACING_WORLD * zoom` and
`background-position = wrap(-x * zoom, spacing)` — a repeating pattern only needs
its phase, and empty board space stays part of the input surface. The origin
crosshair sits in the world layer at world `(0, 0)` and is counter-scaled by
`1 / zoom` so it stays a fixed size on screen.

**Pointer invariance is exact, zoom steps are snapped.** `zoomAt` is exact
algebra, so the point under the pointer is invariant to within ~1e-16 and
clamping at `ZOOM_MIN`/`ZOOM_MAX` preserves that. `zoomStep` snaps the result to
the nearest `ZOOM_STEP_FACTOR^n` when it is within `ZOOM_SNAP_EPSILON` (1e-9,
relative) so "step in, step out" returns *exactly* 1 instead of 0.9999999999999999
(TC-09), and repeated steps produce the clean 125 / 156 / 195 / 244 / 305 / 381 /
400 % sequence asserted in the e2e test.

**Object identity means "nothing happened".** `panBy` with a zero delta,
`zoomAt` that lands on the current zoom, and a rejected factor all return the
*input object*. `useCamera` uses that identity as the only signal for the
`hasNavigated` latch, which is exactly what TC-29 needs: a click without
movement, a zero-delta wheel and a zoom attempt at a limit do not dismiss the
hint, while any real movement does.

**Frame batching.** `useCamera` keeps `cameraRef` (newest camera, may not be
painted yet) and a React state copy (what is painted). Gestures mutate
`cameraRef` immediately and schedule one `requestAnimationFrame` flush, so a
burst of `pointermove`/`wheel` events causes at most one render per frame and no
movement is lost (each event is composed from the newest camera). `getCamera()`
exposes the newest camera so the test hook and assertions can settle on a frame.

**Cancelling page behaviour.** The wheel listener is added with
`{ passive: false }` in an effect and always calls `preventDefault()` while the
event is over the board; `touch-action: none` on the surface covers touch, and
`overscroll-behavior: none` on the root stops page scroll. Safari's
non-standard `gesturestart`/`gesturechange` are prevented too, zooming by the
ratio between successive `event.scale` values (the ratio, because Safari reports
a cumulative scale per gesture). `wheel.deltaMode` LINE and PAGE are converted
to pixels with the named constants `DELTA_LINE_TO_PIXELS` (16 px per line, the
usual platform wheel delta) and `DELTA_PAGE_TO_PIXELS` (100 px per page).

**Chrome is not board.** The zoom control stops wheel propagation on both the
capture and bubble phase so a Ctrl/Cmd wheel over it never reaches the board
window listener (TC-30).

## Deviations / additions to the written spec

- `src/client/canvas/cameraStub.ts` (mentioned nowhere) was never created; the
  red phase of task 1 was achieved by committing `camera.ts` with the real
  signatures throwing `not implemented`, then implementing the bodies in task 2
  (commit `1358dd7` is the red commit, all 20 unit tests failing with
  "not implemented").
- `wrangler.jsonc` has `assets.directory`, `not_found_handling:
  "single-page-application"` and **no `binding`**: wrangler 4 refuses to run an
  assets-only worker with an asset binding ("Cannot use assets with a binding in
  an assets-only Worker"). Story 3 adds `main` and can add the binding back.
- `@testing-library/user-event` is installed as required by task 1's dependency
  list but is not used: the gestures under test (pointer capture, `wheel` with
  `deltaMode`, `gesture*`) are exactly the ones user-event cannot synthesise, so
  the component tests dispatch real DOM events and assert `defaultPrevented`.
- `vite.config.ts` points the dev server at `127.0.0.1:21056` (`DEV_PORT`, falls
  back to the next free port if something already listens there) and
  `playwright.config.ts` at 21062/21063 (`E2E_PORT`, `E2E_INSPECTOR_PORT`) so
  every listener stays inside the assigned port range (21056–21071). The e2e
  `webServer` rebuilds `dist/client` in test mode before starting `wrangler dev`
  and reuses an already-running server only when one answers on that port.
- Extra `data-testid`s (`board-viewport`, `world-layer`, `origin-marker`,
  `zoom-controls`, `zoom-percent`, `reset-view`, `navigation-hint`, `app`) and
  `data-panning` on the surface, so tests can observe drag state without
  depending on styling. The aria-labels and visible text required by the design
  (`Zoom out`, `Zoom in`, `Reset view`, `Drag to move around · Ctrl/Cmd + scroll
  or pinch to zoom`, `${zoomPercent}%`) are exactly as specified.
- `window.__vidi6` (`src/client/canvas/testHooks.ts`) is installed only when
  `import.meta.env.MODE === 'test'`, i.e. by `npm run build:test`. The mode
  check is written out at the call site so Vite constant-folds it: `grep -r
  __vidi6 dist/client` is empty after `npm run build` and finds it after
  `npm run build:test`. `getCamera()` is included so tests can distinguish "the
  camera never moved" from "the camera moved and came back".
- Component tests cover a few cases beyond the eight listed ids, named `TC-13b`,
  `TC-14b`, `TC-15b`, `TC-17b`, `TC-32b` etc.: several small drag moves, lost
  pointer capture, horizontal scroll, line/page `deltaMode`, Cmd instead of
  Ctrl, invalid `gesture.scale`, drags that start on a board object, and the
  hint's exact text. Nothing from the listed set was dropped.

## Test-environment notes

- Vitest runs without `globals`, so `@testing-library/react` does not register
  its automatic unmount; `tests/component/setup.ts` calls `cleanup()` in
  `afterEach` (without it, renders accumulate and queries find multiple nodes).
- Component tests use `vi.useFakeTimers({ toFake: ['requestAnimationFrame',
  'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] })` and advance one
  frame to flush batched camera updates. `queueMicrotask`/`performance` are left
  real because React 19's scheduler uses them.
- jsdom has no layout (`getBoundingClientRect()` is all zeros, so screen ==
  client coordinates in those tests) and has neither `ResizeObserver` (
  `useElementSize` falls back to `window.innerWidth/innerHeight`, 1024×768) nor
  `setPointerCapture` (the viewport feature-detects it; real browsers capture,
  and the e2e tests cover the captured-drag behaviour, including
  `pointercancel`).
- e2e grid assertions read the *painted* `background-position` /
  `background-size` of the surface. Because the grid repeats, "the same dot moved
  by (dx, dy)" is asserted as a phase shift of `dx mod spacing` together with an
  exact origin-marker move; `tests/e2e/helpers/board.ts` has the helpers
  (`markerCentre`, `readGrid`, `expectGridPhaseMoved`, `expectGridSpacing`,
  `setCamera`).
- e2e camera jumps use `window.__vidi6.setCamera(...)` (test build), as the
  design's fixtures require — dragging 1 000 000 px is impractical.

## Environment limitations

- **Firefox and WebKit cannot start in this sandbox.** Playwright's browsers are
  installed (`chromium-1243`, `firefox-1543`, `webkit-2359`), but launching
  Firefox or WebKit aborts immediately (`SIGABRT` / `Abort trap: 6` before any
  page exists; Chromium is unaffected). This is the machine, not the tests: the
  suite runs 16/16 green in Chromium.
- `playwright.config.ts` therefore probes every browser once at config time,
  writes `test-results/browser-availability.json`, prints
  `[e2e] these browsers cannot start in this environment, their tests will be
  skipped: firefox, webkit`, and the tests of an unusable browser **skip with
  that reason** instead of reporting a false failure. On a machine where the
  browsers can launch, all three projects run normally — no test was deleted or
  weakened.
- Task 3's "Done when" includes a manual check in Chrome and Safari. Chrome (via
  Chromium e2e) is covered; a manual Safari check was not possible because
  WebKit will not launch here. Safari's pinch path is covered by the
  `gesturestart`/`gesturechange` component tests (TC-17, TC-17b), which is also
  what the story's test strategy prescribes ("Safari pinch gestures are not
  tested in e2e").
- npm requires `npm approve-scripts` for `esbuild` and `workerd` postinstall
  scripts (recorded in `package.json` under `allowScripts`); without it
  `wrangler`/`vite` do not work.

## Story 2 decisions (tasks 3-6)

- `fitFontSize(el, boxPx)` returns `{ fontPx, overflow }` and takes the box as a
  number, because both callers know it: the display box is
  `STICKY_SIZE_WORLD - 2 * 12`. It reads only `el.scrollHeight` after assigning
  `el.style.fontSize`, so it measures in whatever space the element lives in
  (world units here). Binary search, largest fitting size, ties to the larger
  size; if even the smallest size does not fit it returns the smallest and says
  `overflow: true`.
- The text box is block layout, not flexbox, and `fitFontSize` measures that box
  itself. A centred flex container hides overflow above the content box from
  `scrollHeight`, which would have made the overflow detection wrong; so text is
  centred horizontally and starts at the top. The display element and the
  editor's textarea share the `.sticky-text` box, so text does not move when
  editing starts or ends.
- The note is the positioned element (world x/y, width/height, fill, z-index);
  the text and the fade are placed inside it. Dragging writes world x/y through
  `moveObject` and the world layer's transform does the rest, which is what keeps
  the grabbed point under the pointer at any zoom: the press remembers note
  position and pointer position, and the delta is divided by the zoom.
- Dragging is rAF-coalesced exactly like camera panning in story 1: pointermove
  stores the newest position, one `moveObject` per frame, and pointerup/cancel
  applies the last position itself, then cancels the frame.
- The character counter and the fit are derived from the same render as the text:
  the counter length is the editor's own DOM value (clamped before it is
  counted), and `overflow` comes from the measurement effect, so the counter, the
  font size and the fade always agree.
- The note's toolbar is counter-scaled by a wrapper the note owns
  (`.note-toolbar-anchor`, `scale(1 / zoom)`, origin bottom-left), so
  `NoteToolbar` keeps the exact props the design gives it and still does not grow
  with the board.
- `useSelection` holds selected and editing ids in one object, so selecting can
  never leave an editor open. `endEdit` ignores a call when no editor is open,
  which is what a blur after Escape looks like.
- A swatch or bin click is for the toolbar: `pointerdown` and `dblclick` stop
  there, so the board never clears the selection or starts editing.

## Story 2 decisions (tasks 7-8)

- **A press is tracked on `window`, not on the note element.** This was found by
  the e2e tests and no jsdom test could show it: beginning a drag calls
  `bringToFront`, which changes the note's place in the painted order, and React
  therefore re-inserts the note's DOM node in its parent. Chromium releases
  pointer capture when a node is re-inserted, so `lostpointercapture` fires in
  the middle of the first move. Ending the drag there (which the design's
  "pointercancel/lostpointercapture → Selected" line suggests) left the note one
  coalesced step from where it started and every later pointermove was ignored.
  So `onLostPointerCapture` is not a handler at all; `pointercancel` still ends
  the drag (TC-21). The move and release listeners are `pointermove`, `pointerup`
  and `pointercancel` on `window` in the capture phase, added on press and
  removed in `stopDrag`, which the unmount cleanup also calls. That keeps
  tracking when the pointer moves faster than the note it carries — a real case,
  because the position update waits for its frame — and their identity never
  changes (both hand the event to `trackRef`, written during render, so the
  newest note, document and callback are used).
- Both the display box and the editor's textarea carry `data-sticky-text-box`, so
  the font fit measures whichever one is showing text, and so an e2e test can ask
  for the computed font size of a note that is not being edited.
- `tests/e2e/helpers/notes.ts` reads a note off the screen (`data-x`, `data-y`,
  `data-z`, `data-color`, `data-selected`, `data-dragging`, `data-overflow`, and
  the text from the textarea while editing or the display box otherwise), and
  converts between board units and screen pixels with the camera the board
  reports, so a screen delta of (dx, dy) at zoom z is asserted to be a board
  delta of (dx / z, dy / z). `noteAtPoint` uses `document.elementFromPoint`: what
  a user would hit at an overlap is the stacking order itself, which is how
  TC-32 checks the dragged note came to the front.
- `fittedFontSize` waits for the computed font size to stop changing before
  asserting on it, because the fit runs in a layout effect after a
  ResizeObserver notification, which is a frame or two after the text is written.
- "Click empty board space" points in the e2e tests are chosen per zoom: the zoom
  controls are in the bottom right, the Sticky note tool in the bottom left, and
  a click meant to deselect has to land on the board itself. (An early version of
  these tests clicked "Reset view" while believing it clicked empty board, which
  reset the camera and made a drag move the board instead of a note.)
- Creating a second note takes the selection with it: the first note goes back to
  being just a note, since one note is selected at a time.
- firefox and webkit cannot be launched on this machine (probed at config time by
  `playwright.config.ts`, which prints and skips with that reason). The story's
  e2e cases therefore run in chromium here; they use no browser-specific API —
  mouse clicks and moves, ordinary keys, computed styles — as story 1's do.

## Story 3 decisions (tasks 1-6: the room)

- **`src/worker/board-room.ts` does not hibernate.** `server.hibernate()` is what
  lets a Durable Object hold thousands of idle sockets; it also throws away the
  instance's state, including the `Y.Doc` the room merges into. With five people
  and a document to hold, the room is a plain non-hibernating object:
  `server.accept(client)` and the sockets live as long as the instance does.
- **`server.binaryType = 'arraybuffer'` before `accept()`.** A Durable Object
  socket defaults to `binaryType: 'blob'` in workerd, and a `Blob` cannot be read
  byte by byte without going async — every frame then looks like it "does not
  start with its type byte", and the room closes it with 1003. This cost a whole
  debugging cycle; it is written as a comment at the accept site.
- **The room asks back.** When a client's `SyncStep1` arrives, the room answers
  with a `SyncStep2` *and* sends its own `SyncStep1`. A room that has lost its
  document (evicted, restarted, first instantiation) is then rebuilt by whichever
  client resyncs, instead of staying empty and showing an empty board to whoever
  joins next. TC-18 checks exactly that with `evictDurableObject`.
- **`evictDurableObject(stub, { webSockets: 'close' })` is the restart**, not a
  test hook. It tears the instance down, discards the in-memory document and
  closes the sockets, which is what a real eviction does; nothing in production
  code exists only for the tests. All client sockets have to be closed before
  evicting, or the eviction waits for them.
- **DO RPC, not `runInDurableObject`.** `runInDurableObject(stub, cb)` may run the
  callback on a *different* instance than the one holding the live sockets, so it
  sees an empty room. The tests call the room through `stub.…()` (RPC) and read
  what the room itself reports.
- **The room is deliberately stateless about people.** No per-person record, no
  awareness of who is who: an update comes in from one socket, is applied and is
  relayed to the others. That is why capacity is one apply plus one send per
  socket (design "Capacity" note) and why 5 people cost the same as 2.
- **Malformed frames are answered, not silently dropped**: an unknown type byte
  closes the socket with 1003 after a `CloseFrame`-shaped log line in the room's
  own console; TC-31 asserts a bad frame from one client does not disturb the
  others.

## Story 3 decisions (task 4: the client's side of the connection)

- **`connectBoard` is `y-websocket` with two settings**: `maxBackoffTime:
  RECONNECT_MAX_BACKOFF_MS` (10 s, the design's ceiling for a reconnect) and
  `disableBc: true` — the browser-cast channel would let two tabs of the same
  browser agree without the room, which would make the multi-tab tests test
  nothing.
- **`trackConnectionState` is separate from `connectBoard`** so the badge's state
  machine is testable with a fake provider (TC-19 to TC-21) instead of needing a
  server. It listens to the provider's `status` and `synced` events; note the real
  event is called `synced` (`y-websocket` emits `synced`, the design's helper
  sketch says `sync`).
- **The badge shows 'Connected' for `CONNECTED_CONFIRMATION_MS` and then hides
  itself**, rather than being shown on every sync: a board that says "Connected"
  every time a change arrives is noise. `connected` therefore renders nothing.
- **Every client renews its own awareness every `AWARENESS_RENEWAL_MS` (15 s).**
  A `y-websocket` *server* renews awareness on that cadence; this room only
  relays, so a client that sends nothing at all is heard from by nobody — and a
  client that is not heard from for 30 s is dropped by its own provider's
  `messageReconnectTimeout`. TC-29 (45 s of nothing) is what proves the renewal
  works: without it the connection dies at 30 s and the badge says Reconnecting.
- **`useBoardDoc({ boardId, doc })`**: passing a `doc` connects nothing, which is
  what every story-2 component test does; passing a `boardId` (the `/b/:boardId`
  route) attaches the provider and destroys it on unmount. The board is editable
  in every connection state, so the badge never disables the board.

## Story 3 decisions (task 5-6: the tests around the room)

- **`tests/integration/ws-client.ts` speaks the real protocol** with `lib0`
  encoders — a client that constructs its own `SyncStep1` from a real `Y.Doc`,
  reads frames, and can send rubbish on purpose. `lib0`'s `readVarUint` throws on
  a truncated frame, which is how "the room understood my frame" is told apart
  from "it read past the end of it".
- The integration project runs in workerd through
  `@cloudflare/vitest-pool-workers`, which needs **`vitest@^4.1`**: with vitest 5
  the pool's proxy worker fails at import time (`SyntaxError: Unexpected
  identifier 'file'`). The pool also pins its own miniflare/workerd
  (1.20260815), whose newest accepted `compatibility_date` is 2026-08-22 — that
  is the date in `wrangler.jsonc`, and the reason it is not "today".
- `wrangler.jsonc` sets `assets.run_worker_first: true`. Without it the
  `not_found_handling: single-page-application` from story 1 answers
  `/api/rooms/…` with `index.html`, and a WebSocket upgrade never reaches the
  worker.
- `tests/integration/worker-env.d.ts` augments `Cloudflare.Env` with this
  project's `Env`. The root `env.d.ts` is not in `tsconfig.json`'s `include`, so
  augmenting there is invisible to the integration project.
- **Random operations, seeded** (`tests/integration/random-ops.ts`) for TC-12 and
  TC-30: a fixed seed means a failure can be reproduced, and "the three docs are
  identical" is the convergence assertion, not "the text I expected".

## Story 3 decisions (task 7-8: what a person sees)

- **An open note now shows what arrives from the room.** Story 2's editor was
  uncontrolled and one-way: typing went into the `Y.Text`, nothing came back. At
  the CRDT level two people in one note merged correctly, but the textarea on
  either screen only ever showed its own typist's words — which is not "seeing
  other people's edits". `StickyTextEditor` now observes the `Y.Text` and copies
  the shared text in, carrying the caret over the change with `mapCaret`.
- **`mapCaret(caret, before, after)`** (in `StickyText.ts`, next to
  `applyTextDiff`, which it is the other half of) compares the two texts, finds
  the changed run, and maps the caret: before the change it does not move, after
  it travels by the change's size, inside it it goes to the front of the change,
  and it never lands past the end. A caret sitting exactly where text was
  inserted stays with the text that was there — when somebody appends to a note
  you are typing in, your caret stays at the end of *your* words rather than
  jumping in front of theirs, which is what the component tests assert.
- **The mirror, not the DOM, is what an incoming change is compared against.**
  `mirrorRef` holds the shared text as this textarea is showing it. If the DOM
  value differs from it, something typed here has not been written yet, and the
  incoming change is left to the input handler to reconcile — copying over a
  not-yet-written keystroke would drop it, and `applyTextDiff` cannot do a
  three-way merge. IME composition is skipped for the same reason.
- **`data-testid="connection-status"`** on the badge, and `window.__vidi6.connectionState`
  in the test build, so an e2e test can read the connection the way the person
  sees it. The badge is `role="status"`; the zoom readout is another
  `role="status"`, so tests select by test id, never by role, on this screen.
- **`noteEditor(page, id)`** exists because "the note open for typing" is not "the
  first note on the screen": on a board with 25 notes, the helper that used
  `notes(page).first()` waited for the wrong element and timed out.
- **A test board is laid out so a test can never point at the wrong note.** In
  TC-26 and TC-30 the notes sit 400 world units apart at zoom 0.25 (50 px on
  screen, gaps of 50 px) and a move is 25 screen px = 100 world units, so a moved
  note touches nothing. The first version used half-cell shoves, notes overlapped,
  a drag grabbed the neighbour and a double-click landed on a note instead of the
  board — which looked like a collaboration bug and was a fixture.
- **`context.setOffline(true)` does not break an established socket at once** —
  the browser keeps the connection it already has and only fails new ones. The
  board notices the loss when its provider stops hearing anything (30 s,
  `messageReconnectTimeout`), which is the product's real behaviour. TC-27
  therefore waits up to `CATCH_UP_TEST_OUTAGE_MS + 15 s` for the 'Reconnecting…'
  line, and the wait appears in its latency report as a 30 s sample: the notice
  of a dead line is slow on purpose, and the 30 s absence is what makes the
  catch-up meaningful.
- **The two long checks are their own Playwright project** (`nightly`,
  `*.nightly.spec.ts`, `npm run test:e2e:nightly`), excluded from
  `npm run test:e2e` by `testIgnore`. They are ordinary assertions against the
  same build and the same room — 45 s of quiet, and 60 s of five people editing —
  which is what `IDLE_STABILITY_MS` and `IDLE_CAP_SOAK_MS` are for. Both say what
  they are doing while they wait (`[idle]` and `[soak]` lines), so a run that is
  being patient cannot be mistaken for a run that is stuck.
- **Latency is measured in the other person's browser and logged, never asserted**
  (`LatencyLog` in `helpers/participants.ts`): every `expectEventually` records how
  long it waited, and each test prints p50/p95/max against
  `LIVE_UPDATE_LATENCY_BUDGET_MS`. A recent run: TC-22 p50 2 ms, TC-26 203 changes
  p50 2 ms / p95 7 ms / max 15 ms, TC-30 883 changes p50 3 ms / p95 7 ms / max
  21 ms, 0 over budget.
- **`session.leave(name)`** closes one person's browser for real, which is how
  TC-29 checks that the others let go of a person who goes away instead of trying
  to bring them back.

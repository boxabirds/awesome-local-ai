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

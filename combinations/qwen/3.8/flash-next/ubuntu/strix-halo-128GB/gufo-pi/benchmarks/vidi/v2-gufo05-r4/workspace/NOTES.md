# Story 1 notes — decisions and deviations

## Decisions

1. **Camera convention** (as designed): `camera.x, y` is the world coordinate shown
   at the top-left of the board area, `zoom` is screen pixels per world unit, so
   `screen = (world - camera.xy) * zoom` and `world = screen / zoom + camera.xy`.
   `resetCamera(viewport)` is therefore `{ x: -width/2, y: -height/2, zoom: 1 }`,
   which puts world (0, 0) — the board's starting point — in the middle.

2. **`CameraProvider` lives in `useCamera.ts`.** The design's contract is a
   `useCamera(viewport)` hook that owns the camera, but `BoardViewport`,
   `ZoomControls` and `NavigationHint` are siblings and must share one camera.
   Instead of hoisting state into `App` (which would mean passing the whole
   controller down by props and re-creating it per render), `useCamera(viewport)`
   is implemented exactly as documented and `CameraProvider` is a thin wrapper
   that calls it, measures its own `.board-area` element with a `ResizeObserver`
   and publishes the controller through context (`useCameraContext()`). Only
   story 1's three components read that context.

3. **Two extra controller members.** `zoomAtPoint(point, factor)` — Safari's
   `gesturechange` reports a cumulative `scale`, so the handler needs to apply an
   incremental factor at a screen point rather than a wheel-style delta.
   `setCamera` / `getCamera` — used only by the test hook (see 10). Everything
   the design lists (`camera`, `hasNavigated`, `beginPan`, `panMove`, `endPan`,
   `wheel`, `zoomStep`, `reset`) is there with the documented shapes.

4. **Origin marker.** World (0, 0) is drawn as a 16 px crosshair positioned in
   screen space from `worldToScreen(camera, {0, 0})`, so it keeps a constant size
   at every zoom and gives the e2e tests a stable pixel target for "the board's
   starting point" and "a grid dot". It is `pointer-events: none`, so it never
   intercepts a drag. It is the only board content in this story; story 2 puts
   real content in the world layer.

5. **Grid is a CSS background on the input surface**, not an element:
   a `radial-gradient` dot per `GRID_SPACING_WORLD * zoom` tile, with
   `background-position: mod(-x*zoom - spacing/2, spacing)`. Using the background
   (rather than translating a huge painted layer) keeps every offset inside one
   tile, so precision is perfect at `UNBOUNDED_PAN_TESTED_EXTENT`, and the tile
   centre — where the dot is drawn — lands exactly on world multiples of the
   spacing, which is what the dot-attachment tests assert.

6. **Wheel delta units.** `deltaMode === LINE` → `WHEEL_DELTA_LINE_PX` (40 px),
   `PAGE` → `WHEEL_DELTA_PAGE_PX` (800 px), `PIXEL` → as-is; both constants are
   in `src/shared/config.ts`.

7. **Zoom-step snapping.** `zoomStep` snaps the new zoom back onto
   `ZOOM_STEP_FACTOR^n` when it is within `ZOOM_STEP_SNAP_TOLERANCE`
   (relative, 1e-9), so "+ then −" returns exactly 1.0 (TC-09). Pinch/wheel zoom
   is never snapped, so free zooming is unaffected.

8. **`hasNavigated` latches on real navigation only.** The no-op cases return the
   *same* camera object (`panBy` with a zero delta, `zoomAt` that clamps to a
   limit, invalid factors), and the latch flips only when the camera object
   changes — so a click without movement and zooming at a limit leave the hint up
   (TC-29). The initial centring of the view and `Reset view` from an already
   standard view do not dismiss it; any actual reset does (reset always yields a
   new object).

9. **Camera updates are coalesced in a `requestAnimationFrame`**: input handlers
   write the next camera into a ref and schedule one frame commit, so a burst of
   pointermove/wheel events causes at most one render per frame.

10. **Test hook `window.__vidi6`** (`src/client/canvas/testHooks.ts`) is installed
    only under `import.meta.env.MODE === 'test'`. That guard is a build-time
    constant, so `npm run build` dead-code-eliminates it — verified with
    `grep -c "__vidi6" dist/client/assets/*.js` → `0`. E2E uses
    `npm run build:test` (`vite build --mode test`), which contains the hook.
    `setCamera` deliberately does *not* flip `hasNavigated`: teleporting the
    camera in a test is not the user navigating.

## Deviations from the spec

1. **TC-30 mechanism (task 4 said "stop wheel propagation on the control
   container").** The board's wheel listener is attached to the viewport element
   only, and the zoom control and hint are siblings of the viewport inside
   `.board-area`, so a wheel over a control never reaches the board at all. The
   component test asserts the camera is unchanged *and* that
   `event.defaultPrevented === false` there — the board does not swallow events
   outside itself.

2. **E2E runs in Chromium only on this machine**; Firefox and WebKit projects are
   configured but skipped (see "Blocked" below).

3. **Ports.** `vite dev` 21328, `vite preview` 21329, `wrangler dev` 21330 (with
   `--inspector-port 21331`) — Playwright's `webServer` starts
   `npm run build:test && wrangler dev` on those ports instead of wrangler's
   default 8787, because only 21328–21343 are allocated to this machine. All are
   `--strictPort`, so a busy port fails loudly rather than drifting.

4. **`wrangler.jsonc` has no assets `binding`.** Wrangler 4 refuses to serve an
   assets-only Worker that declares an assets binding ("Cannot use assets with a
   binding in an assets-only Worker"). The binding arrives together with `main`
   in story 3.

5. **Extra named constants** in `src/shared/config.ts`, beyond the six in the
   design: `PERCENT_PER_ZOOM`, `ZOOM_STEP_SNAP_TOLERANCE`, `WHEEL_DELTA_LINE_PX`,
   `WHEEL_DELTA_PAGE_PX`, `GRID_DOT_RADIUS_PX`, `ORIGIN_MARKER_SIZE_PX`. They keep
   the "no magic literals in components" rule honest.

6. **Extra test-support files**: `tests/component/harness.tsx` (jsdom geometry,
   tracked `ResizeObserver` stub, rAF flush, pointer/wheel/gesture/keyboard
   dispatchers) and `tests/e2e/helpers/board.ts`. `useCamera` is exercised through
   the rendered board rather than a separate hook-test file, which is how its
   behaviour is actually observed.

7. **Layout wrapper.** `App` renders a fixed, full-window `.board-area` (the
   element the viewport size is measured from) containing the viewport plus the
   overlay zoom control and hint. The design only said "App mounts BoardViewport
   full-window".

8. **Component tests stub the environment** (jsdom has no layout, no pointer
   capture and no GestureEvent): every element reports a 1280x800 board area,
   `setPointerCapture` is optional in the handler (`typeof` check, so real
   browsers use it), and TC-17 synthesises a Safari-like `gesturechange`.
   TC-07's "UI level" case resizes the board area through the tracked observer.

## Blocked

**E2E in Firefox and WebKit cannot run on this machine.** Both need GTK:
`ldconfig -p | grep libgtk-3` returns nothing, `sudo` is refused
(`no new privileges`), and `apt-get install libgtk-3-0t64` reports the package is
not available. The browser builds themselves are present
(`PLAYWRIGHT_BROWSERS_PATH=/w/browsers`: chromium-1243, firefox-1543, webkit-2359)
but Firefox and WebKit fail to launch with "Host system is missing dependencies".

`playwright.config.ts` therefore filters those two projects out at load time and
prints `[e2e] skipping firefox and webkit: this host has no GTK libraries`; on a
host with GTK the same command runs all three. Nothing in the implementation is
Chromium-specific: the input paths use the standard Pointer Events, Wheel Events
(with `{ passive: false }`) and Safari `gesture*` listeners, and the
Safari-only gesture handler that Playwright cannot synthesise is covered by
component test TC-17.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run test:unit` | 24 passed (TC-01…TC-12 + 1000-case pointer-invariance property check) |
| `npm run test:component` | 30 passed (TC-13…TC-22, TC-29, TC-30, TC-32) |
| `npm run test:e2e` | 8 passed in chromium (TC-23…TC-28, TC-31, three workflows); firefox/webkit skipped |
| `npx playwright test --repeat-each=2` | 16 passed, no flakes |
| `npm run build` | succeeds; `grep -c __vidi6 dist/client/assets/*.js` → 0 |
| `npm run build:test` | succeeds; test hook present in the bundle |
| `npm run dev` (21328) / `npm run preview` (21329) | both serve the board |

---

# Story 2 notes — decisions and deviations

## Decisions

1. **One `Y.Map` of objects, one `Y.Text` each** (`src/shared/board-model.ts`).
   A note record holds `id`, `shape`, `x`, `y`, `z`, `color` as plain values and
   `text` as a `Y.Text`, so two people typing into the same note merge without a
   last-write-wins fight, while moving and recolouring stay single-value sets.
   `snapshot()` sorts by `z` then `id`, which is the order the notes are rendered
   in, so DOM order, document order and stacking order are the same order.

2. **Local edits are tagged with an origin** (`LOCAL_ORIGIN`). Nothing reads it
   yet; story 8's undo needs to tell our own changes from somebody else's, and
   tagging at the source is the only place that knowledge exists. Every mutator
   runs inside one transaction, so one user gesture is one update.

3. **Mutators answer `true`/`false` and emit nothing when the answer is false** —
   a stale id, a non-finite position, an unknown colour, a no-op. Tests assert the
   `update` event count (1 for a real change, 0 for a rejection), which is what
   story 3's traffic depends on.

4. **`useBoardDoc(provided?)` and `App`'s optional `doc` prop.** Story 3 hands
   them the document it syncs with the room. Component tests hand them a private
   `Y.Doc` and then read `snapshot(doc)` — so they assert on what the board stored,
   not on a rendering of it. Without an argument both make a fresh in-memory doc,
   as before.

5. **Auto-fit is measured by the note, not by the editor.** `StickyNote` keeps a
   hidden layer with the visible text's width, wrapping and line height;
   `fitFontSize(element, box)` binary-searches integer sizes and asks that layer
   whether the text is taller than the note gives it. The result drives the display
   layer, the textarea and the fade together, so typing feels like the text that is
   already there, and `StickyTextEditor` never changes its own box (design 4.4).
   `fitFontSize` takes the element as a *probe*, so the same search answers both
   questions: the largest size that fits, and whether even the smallest does not.

6. **Text edits are written as one delete plus one insert of the difference**
   (`applyTextDiff`), with the common prefix and suffix left alone. A concurrent
   change elsewhere in the same note then still merges (TC-38's basis; story 3 is
   where two people actually type at once).

7. **The note root is the drag target**; the text layer and the editor layer
   `pointer-events: none` except while typing. A click on the words therefore
   selects and drags the note, the note's `getBoundingClientRect()` stays the hit
   area, and the caret works the moment the note is being edited.

8. **Drag deltas are measured against the pointer's start and divided by `zoom`**,
   not accumulated from `movementX`: `movementX` is in device pixels, so it is
   fractional under browser zoom and integer-truncated in Chromium, which would
   make a note drift on a long drag. The commit is rAF-coalesced and written to the
   document on pointerup only, so a two hundred move drag is one update.

9. **A dragged note is raised only if it ends up overlapping another one**, at the
   end of the drag rather than the start: a move that does not need a new stacking
   order does not cause a document change or a DOM reorder mid-gesture.

10. **The note toolbar is a child of the note**, counter-scaled by `1 / zoom` with
    `transform-origin: 50% 100%` — the gap above the note is in world units and
    scales, the toolbar itself does not (verified in e2e at 50 %, 100 % and 200 %).
    The note root therefore does not clip with `overflow: hidden`: the text and
    edit layers inside it clip instead (see deviation 3).

11. **`window.__vidi6.getBoard()`** returns `snapshot(doc)`, so e2e asserts on
    stored positions and text rather than guessing them from the screen. Test hooks
    are now registered piecewise (`registerTestHooks`) because the viewport owns the
    camera half and the board owns the content half; still `MODE === 'test'` only,
    still tree-shaken out of `npm run build`.

## Deviations

1. **`STICKY_FADE_HEIGHT_PX` is named `STICKY_FADE_HEIGHT_WORLD`.** The design's
   setting text calls it a pixel height, but the design's own behaviour is that the
   fade scales with the note — it is a world-unit length. The name says which.

2. **`CameraControls` exposes `viewport`.** The sticky tool creates a note in the
   middle of whatever is on screen, and `App` works that out; only the camera hook
   knows the measured size of the board area. Nothing else about story 1's contract
   changed.

3. **`overflow: hidden` moved from the note to its text layers.** With it on the
   note, the note's own toolbar — which sits above the note's top edge — is clipped
   away and unclickable. AC-15 is about text not leaving the note, and clipping the
   two layers that hold text does exactly that while keeping the toolbar visible.

4. **A note is a `div` with `role="group"`, `tabIndex={0}` and an `aria-label`**, not
   a real `<button>`: it has to contain a textarea and a toolbar, which do not
   belong inside a button. Selection is drawn with an outline (`--note-selection`)
   rather than the focus ring, because a note is selected by pointing at it and
   focused in order to be moved or deleted — the two are not the same thing.

5. **`BoardViewport` gained `doc`, `onStickyCreated` and `onEmptyClick`.** The
   design puts double-click-to-create in the viewport and selection in `App`, so the
   viewport reports the fact and `App` decides what it means (create a note there
   and edit it; clear the selection). The viewport still knows nothing about notes.

6. **The overflow fade can only be verified in a browser.** jsdom performs no text
   layout — `scrollHeight` is always 0 — so the fade, the shrinking font and
   "nothing is drawn outside the note" are e2e (TC-33, TC-34). The part of the rule
   that is pure logic, the search between the two configured sizes, is unit-tested
   with a fake measurer (TC-33's range, `fitFontSize` never leaves `[min, max]`).

7. **File names.** The design mentions `tests/component/StickyTextEditor.test.tsx`;
   the typing tests live in `tests/component/StickyTextEditing.test.tsx` because
   they drive the whole app (double-click to open, click away to close) rather than
   the editor in isolation, which is how the behaviour is actually observed.
   `tests/component/harness.tsx` grew the note helpers (`fireInput`, `firePaste`,
   `fireComposition`, `flushFrames`, note and toolbar locators) and
   `tests/e2e/helpers/board.ts` grew `getBoard`, the note locators and `dragNote`.

8. **The IME case is driven by dispatching the composition events in the page**,
   in the order and with the values an input method really sends
   (`compositionstart`, provisional inputs, `compositionend`, final input):
   headless Chromium has no keyboard layout or input method to drive. The paste
   limit uses `keyboard.insertText`, which arrives as a single `input` event,
   exactly as a paste does. Both are e2e; the same paths are covered in jsdom by
   `fireComposition` and `firePaste`.

## Blocked

Nothing new. E2E still runs in Chromium only on this machine (story 1's note about
missing GTK applies unchanged); nothing in this story is Chromium-specific — the
interaction uses standard Pointer Events, and the one browser-only behaviour it
depends on, text measurement, is asserted in Chromium and unit-tested everywhere.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run test:unit` | 81 passed — 33 board model (TC-01…TC-12, TC-39), 24 sticky text (TC-13…TC-17), 24 story 1 camera |
| `npm run test:component` | 67 passed — 37 new (TC-18…TC-32, TC-34…TC-37) plus story 1's 30 |
| `npm run test:e2e` | 32 passed in chromium — 24 new (TC-16, TC-20, TC-21, TC-23, TC-25, TC-27…TC-29, TC-31…TC-38) plus story 1's 8 |
| `npx playwright test --repeat-each=2` | 64 passed, no flakes |
| `npm run build` | succeeds; `grep -rc "__vidi6" dist/client/assets` → 0 |
| `npm run build:test` | succeeds; test hook present in the bundle |

# Implementation notes, deviations and blocked items

Story 1 notes are first, story 2 notes are at the end. TC numbers refer to each
story's own `design.md`.

## Blocked

### WebKit (Safari) E2E project cannot run on this machine

`npx playwright install webkit` downloaded `webkit-2359` but the browser fails to
launch: the host is missing system libraries (Playwright reports
`Host system is missing dependencies … apt-get install libavif13`), the library
is nowhere on the filesystem (`ldconfig -p` and a filesystem search both find no
`libavif`), and it cannot be installed: `sudo` is disabled (no-new-privileges)
and `apt` cannot open its own package lists.

Consequence: `npm run test:e2e` runs **Chromium + Firefox**. Firefox was installed
during story 2 (`npx playwright install firefox`); the WebKit binary downloads
(`webkit-2359`) but exits with status 127 because its system libraries are missing.
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
   main one, so both are passed explicitly. Story 1 used main `27840`, inspector
   `27841` (that session's allowed range). Story 2 moved every port into the
   current allowed range 22752–22767 — see *Story 2 → Deviations* item 1.
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

---

# Story 2 — sticky notes

## Deviations from the design document

1. **All ports moved to 22752–22755.** This session's allowed range is
   `AGENT_PORT_FIRST=22752` … `AGENT_PORT_LAST=22767`, so story 1's ports (27840
   dev / 27840 wrangler / 27841 inspector / 27842 preview) are no longer used:
   Vite dev **22752**, `wrangler dev` for e2e **22753** with inspector **22754**
   (`npm run serve:e2e`, both passed explicitly), `preview` **22755**, and
   Playwright's `E2E_PORT` default **22753** (it must match the `webServer` port).
   Verified: dev and preview answer `200` on those ports, e2e runs against 22753.
2. **Stacking order is CSS `z-index`, not DOM order.** The design has the note
   elements painted in `snapshot()`'s z order. Sorting the DOM by z turned out to
   break dragging in a real browser: `bringToFront` runs once when a drag starts,
   which changes z, which made React *move* the note's DOM node, and Chromium
   treats that as an interrupted pointer — it fires `lostpointercapture` and the
   drag died after the first applied move (measured world delta 6.25 instead of
   50 at 200 %). `App` now renders notes in a stable creation order and each note
   carries `zIndex: note.z`, so a z change is a style change, never a node move.
   `snapshot()` still sorts by `(z, id)`, and the tests assert painting with
   `document.elementFromPoint` on the overlap plus the `z-index` value
   (`tests/e2e/sticky-notes.spec.ts` TC-32, `tests/e2e/sticky-toolbar.spec.ts`
   golden path, `tests/component/StickyNote.test.tsx` stacking cases).
3. **`StickyText` also exports the pure helpers the design describes as
   implementation prose** (`clampToLimit`, `applyTextDiff`, `counterVisible`,
   `fitFontSize`). TC-13 to TC-17 are unit tests, so those four have to be
   importable; `fitFontSize(el, box)` takes the element plus a box in *world*
   units and is the only part that touches the DOM.
4. **The text editor is uncontrolled DOM.** The textarea's value is set on mount
   from the `Y.Text` and every `input` event is written straight through
   `applyTextDiff` (clamped first). React never re-writes the value, which is what
   keeps the caret and IME composition sane; ending editing therefore performs no
   write at all (`applyTextDiff` returns without opening a transaction when the
   text is unchanged), which TC-24 and the "every keystroke is written" e2e case
   both rely on.
5. **Mid-interaction disappearance is detected with `getStickyText(...) ===
   undefined`** instead of adding an `objectExists` export: the design's board
   model contract lists exactly the functions it names, and TC-37 only needs to
   know whether the note is still there.
6. **Counter text is `n/1000`** (`data-testid="sticky-char-counter"`, rendered
   when `counterVisible`), the design says "shows `n/1000`" without an exact
   format. The overflow indicator is `.sticky-note-fade` (TC-33 asserts it).
7. **Extra cases beyond the numbered TCs**: TC-23b (Enter re-opens with the caret
   after existing text), TC-33b/33c/33d (fit → clip → clamp boundaries), the
   counter boundary at 949/950/951, "dragging a note does not pan the board",
   "a press does not clear the selection", board-unit note size at 100 %/50 %,
   toolbar size constant on screen at 50 %/100 %/200 %. No listed TC is missing.
8. **Golden path deletes with the Delete key** (as `tasks.md` words it); the bin
   button is covered separately by TC-29 in both component and e2e level.

## Notes that affect the tests

- **jsdom cannot measure text layout**: `scrollHeight` is always 0, so
  `fitFontSize` always reports the maximum font in component tests. Font fitting,
  the clip at `STICKY_FONT_MIN_PX` and the fade are asserted in e2e (TC-33) where
  a real engine lays the text out; component tests assert the *data* the fit
  produces (`data-overflow`, editor font size) instead.
- **jsdom has no pointer capture**: `setPointerCapture` /
  `releasePointerCapture` are missing, so `StickyNote` guards them (`?.`) and the
  component drag tests rely on the pointer staying over the note element.
- **"Paste" in e2e is one synthetic `input` event** after assigning
  `textarea.value` (`pasteIntoEditor` in `tests/e2e/sticky-text.spec.ts`):
  Playwright has no portable clipboard here. It exercises the same path a real
  paste takes — clamp, caret restore, `applyTextDiff`, refit.
- **Colour assertions ignore alpha.** Notes are painted with `rgba(..., 0.92)`, so
  `noteColor()` in `tests/e2e/helpers/stickies.ts` compares only the r/g/b part of
  the computed `background-color`.
- **Note positions in tests are read from the inline `left`/`top`**, which are the
  model's world coordinates: the world layer's `scale(zoom)` is what turns them
  into screen pixels, which is exactly what the drag geometry tests compare
  against (TC-31, TC-32).

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

---

# Story 2 — sticky notes: decisions, deviations and blocked items

## Blocked (unchanged from story 1)

**WebKit still cannot run on this machine.** `npx playwright install webkit`
downloads `webkit-2359` but `minibrowser-gtk/bin/MiniBrowser` fails with
`error while loading shared libraries: libavif.so.13`, `sudo npx playwright
install-deps` / `sudo apt-get install libavif13` are impossible (no-new-privileges,
and `apt` cannot open its package lists), and the library is nowhere on the
filesystem. `E2E_BROWSERS=webkit … playwright test` therefore fails at launch
(exit 127), with or without `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`.

`npm run test:e2e` runs **Chromium and Firefox** (both installed under
`/w/browsers`; Firefox 155 was installed during story 2) — 15 sticky/board cases
× 2 browsers = 30 e2e tests, all passing. Safari-only behaviour that story 2
depends on (pointer events, `setPointerCapture`, `pointer: coarse` sizing) is
covered by the component tests in jsdom and by the same code paths in Chromium
and Firefox.

## Deviations from the design document

1. **`useBoardDoc` takes the document.** The design writes `useBoardDoc(): {
   notes }` as if the hook created the `Y.Doc`. It is `useBoardDoc(doc: Y.Doc)`,
   and `App` takes an optional `doc` prop (`App({ doc })`, defaulting to a
   module-level `new Y.Doc()`). Reasons: component tests must create and delete
   objects on the *same* document they render, story 3 needs one doc per room,
   and a hook-owned document would be recreated on hot reload.
2. **`onSelect` accepts `null`.** `BoardViewport`/`StickyNote` selection props are
   `(id: string | null) => void` so a note can drop the selection when it is
   deleted from its own toolbar and so an empty-board click clears it.
3. **`objectExists(doc, id)` was added to the model.** TC-37 ("the note no longer
   exists mid-drag") needs the view to tell "someone else moved it" from "it is
   gone"; `moveObject` returning `false` alone cannot distinguish them.
4. **Notes are rendered in a stable (id) order, stacked with CSS `z-index`.**
   Rendering them in `snapshot()`'s `(z, id)` order made `bringToFront` reorder
   React's keyed children, and moving a DOM node that holds a pointer capture
   makes browsers fire `lostpointercapture` — which ended a drag after its first
   animation frame (the 200 % drag test moved 12.5 px instead of 100). Stacking is
   carried by the `z` field, which is what the design's z-order requirement is
   about; `snapshot()` still returns `(z, id)` order (TC-11 unchanged).
   `StickyNote` additionally re-takes the pointer on `lostpointercapture` while a
   drag is live, and watches `pointerup` / `pointercancel` on `window` so a drag
   always ends even without capture.
5. **Auto-fit is measured in world units.** The fitted font size is derived from
   the rendered text box's `clientHeight` / `clientWidth` divided by the current
   zoom, so the size is zoom independent (TC-33 sees 24 world px at 50 % and at
   200 %). Measurement re-runs on text change, on entering/leaving editing and on
   zoom change; the measurement happens on the read-state text element in the read
   state and on the textarea while editing.
6. **Two test ids for the text.** The read display keeps `data-testid="sticky-text"`
   (the element `design.md` names) and the editing textarea is
   `data-testid="sticky-textarea"`; giving both the same id made strict-mode
   Playwright locators resolve to two elements. The editor wrapper is
   `data-testid="sticky-editor"` (also the accessible name target).
7. **Overflow is a gradient overlay.** "A visible fade indicates more text than
   fits" is `.sticky-note-overflow::after` — a 28 px linear-gradient from
   transparent to the note colour at the bottom edge, shown only when
   `overflow` is set. Text clipping itself is done by `.sticky-text` /
   `.sticky-textarea` (`overflow: hidden`, `overflow-wrap: break-word`), not by the
   note: the note must not clip, because the toolbar floats above its top edge.
8. **The padding inside a note is a CSS variable** (`--sticky-text-padding`) set
   from `STICKY_TEXT_PADDING_WORLD`, so the fitting maths and the layout cannot
   drift apart.
9. **`BoardViewport` gained two optional props** — `onCreateAtScreen(point)`
   (double-click on empty board space, screen coordinates → `App` converts with
   `screenToWorld`) and `onEmptyBoardClick()` (clears the selection). Story 1's
   pan/zoom behaviour and all its tests are untouched. The double-click handler
   ignores events whose target is not the viewport or the grid, so a double-click
   on a note edits that note instead of creating a new one (TC-35).
10. **Toolbar sizing.** The toolbar is laid out in fixed screen pixels (22 px
    swatches, 26 × 22 px bin button) and hung off the note with
    `transform: scale(1 / zoom); transform-origin: 0 100%`, which cancels the world
    layer's scale so it keeps that size at every zoom level and never scales with
    the note (design: "positioned above the note in screen space so it does not
    scale with zoom"). Touch-specific target sizes are out of scope for this story
    (prd.md "Out of scope: Touch devices").
11. **No new production test hook.** `window.__vidi6` stays camera-only. e2e
    helpers read note state from the DOM (`data-note-id`, inline `left`/`top`,
    `getComputedStyle` background and font size, `data-selected` /
    `data-dragging`), so story 2 adds no test-only code to the shipped bundle.
12. **Extra e2e case beyond the numbered TCs**: "double-click on an existing note
    edits it instead of creating a new one" — the negative path TC-35 names.
13. **Keyboard routes** (PRD "Keyboard": Enter / F2 edit, Delete / Backspace
    delete) live in `App`, guarded by `isEditableTarget()` so typing in the note
    editor or a future text field never deletes the note.
14. **The first-use hint *is* the empty state.** `App` renders `NavigationHint`
    with `visible={notes.length === 0 && !board.hasNavigated}`. Story 1's rule
    (shown until the first pan or zoom, never persisted) is unchanged; story 2's
    "board with no notes shows story 1's hint" adds the other half — the first
    note makes way for it.

## Notes that affected the tests

- **jsdom normalises colours**: `getComputedStyle(el).backgroundColor` comes back as
  `rgb(255, 245, 157)`, so tests compare against a local `rgbOf()` conversion.
- **React and raw pointer events**: dispatching `new PointerEvent(...)` from a test
  does not flush React state; the component tests use
  `fireEvent.pointerDown/Move/Up/Cancel` from `@testing-library/react`, which wraps
  in `act()`. jsdom has no `Element.setPointerCapture`, and
  `PointerEvent.prototype.pointerId` defaults to `0`, so `StickyNote` guards every
  capture call (`?.` plus `try/catch`).
- **`rAF` writes vs. assertions.** Drag writes are coalesced into one animation
  frame per batch, so component tests `settle()` (two rAF ticks plus a macrotask)
  before reading the document, and the e2e `dragNote()` helper waits until no note
  reports `data-dragging="true"` before asserting positions.
- **jsdom has no layout**: `clientHeight` / `clientWidth` are 0, so a fitted font
  size in component tests is `STICKY_FONT_MIN_PX` unless the test overrides the
  text box metrics; TC-33's real 24 px fit is verified in Chromium and Firefox.

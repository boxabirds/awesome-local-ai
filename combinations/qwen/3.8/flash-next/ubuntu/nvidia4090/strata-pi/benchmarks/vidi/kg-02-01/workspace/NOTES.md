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

# Story 2 — sticky notes: implementation notes, deviations and blocked items

## Blocked

**WebKit is still unavailable** (same reason as story 1: `libavif` and other system
libraries are missing and cannot be installed without root). Story 2's e2e cases run in
**Chromium and Firefox** — 37 cases per browser. Nothing in story 2 is WebKit-specific; the
auto-fit text measurement runs identically in both installed browsers. Note that Firefox has
to be present in the Playwright browser path (`npx playwright install firefox`); the config
adds it only when installed, so a machine with just Chromium silently runs Chromium.

## Deviations from the design document

1. **`useSelection` has one more field: `draggingId` / `setDragging`.** `design.md` names
   `selectedId`, `editingId` and their setters. The note toolbar must vanish while a note is
   being dragged, and "Dragging" is a state of the same per-note state machine, so it belongs
   in the same hook. It is still local UI state: nothing about dragging or selection is ever
   written to the Y.Doc.
2. **A note's drag gesture is tracked on `window`, not on the note element.** `StickyNote`
   still calls `setPointerCapture`, but it listens for `pointermove` / `pointerup` /
   `pointercancel` on `window` from press to release, and has no `onLostPointerCapture`
   handler. Reason found by measurement: `bringToFront` at drag start changes `z`, which
   re-orders the note in the DOM, which drops pointer capture — in Chromium the drag stopped
   exactly at the threshold and the note never moved. The gesture is now independent of
   capture, and a note that unmounts mid-gesture removes its listeners.
3. **`App` accepts an optional `doc` prop** (`<App doc={yDoc} />`). Component tests need the
   exact `Y.Doc` the UI mutates to assert what was written; story 4 passes the Durable
   Object-backed document through the same prop. Without the prop, `useBoardDoc` creates one.
4. **Creating a note uses `screenToWorld(camera, screenPoint)`** (story 1's helper) rather
   than `camera.x + width / 2`. The latter is only correct at zoom 1: at 50 % it would put the
   note twice as far from the origin, which TC-28 / TC-34 would miss. Both the double-click
   path and the Sticky note button convert the *visible centre of the board*, so the button
   works when the board has been panned a million units away (TC-34).
5. **`STICKY_PADDING_WORLD` was added to `config.ts`.** The design puts padding in CSS only,
   but the auto-fit measurement needs the inner box in JS, so the value is set from JS (inline
   style) and used by both the note and its hidden measuring twin.
6. **`BoardViewport` clears the selection only on an empty-space press that never moved.**
   `design.md` says "empty-space click without drag → clear selection"; the implementation now
   matches it: panning the board (press + move) leaves the selection and its toolbar in place.
7. **The toolbar colour order comes from `Object.keys(STICKY_COLORS)`** (`STICKY_COLOR_ORDER`
   in `NoteToolbar`), so the swatches can never drift from the six colours in `config.ts`.
8. **A second test-only global: `window.__vidi6Board.notes()`** (`src/client/board/boardTestHooks.ts`),
   installed only in `MODE === "test"`, returning the snapshot in paint order. E2E assertions
   compare what is *painted* with what is in the *model*; production builds do not define it.
9. **A focused note becomes the selected note** (`onFocus` → `select`). Without it, Tab could
   reach a note but Enter / Delete would do nothing, because those keys act on the selection.
10. **`EMPTY_TEXT`** is a module-level `Y.Text` fallback used if a note in the snapshot has no
    `Y.Text`, so rendering never crashes and never writes to the document.

## Notes that affect the tests

- **jsdom has no layout engine.** `scrollHeight` is always `0`, so in component tests
  `fitFontSize` always returns `STICKY_FONT_MAX_PX` with `overflow: false`. Component tests
  therefore assert the *wiring* (the fitted size reaches the display text, the textarea and the
  measuring twin; the counter appears; the editor mounts and unmounts), while TC-33 (font
  shrinking to the minimum, the fade, nothing painted outside the note) is asserted in real
  browsers.
- **Firefox sequential navigation** continues from the element that was focused before, even
  after `activeElement.blur()`, so a keyboard-only e2e case must start from a known focus
  point: the test focuses `[data-testid=board-viewport]` and then Tabs once, which reaches the
  note in both browsers (DOM order: viewport → notes → toolbar → note toolbar → zoom controls).
- **Drag writes are rAF-coalesced** (one `moveObject` per animation frame, carrying the newest
  pointer delta), so tests never assume a write per pointermove: e2e polls the model
  (`expect.poll`) until the position settles, component tests use `settle()`.
- **`deleteObject` on a note that is being dragged or edited** (TC-37) ends the interaction
  silently: `StickyNote` watches for its own note disappearing from the snapshot, cancels the
  pending animation frame, and never re-creates it.
- **`getByTestId` and overlapping notes.** Several e2e cases create notes by double-click at
  fixed screen points; when two notes overlap, the top one receives the click, which is why the
  golden-path case spreads its notes out before selecting one of them.
- **Text limit and caret.** Typing beyond 1,000 characters is refused in the editor itself
  (`clampToLimit` + caret reset), so `applyTextDiff` never sees an over-limit string; the unit
  tests (TC-14 to TC-16) exercise the same clamp and the Y.Text diff shape (single insert or
  delete, surrogate pairs intact).

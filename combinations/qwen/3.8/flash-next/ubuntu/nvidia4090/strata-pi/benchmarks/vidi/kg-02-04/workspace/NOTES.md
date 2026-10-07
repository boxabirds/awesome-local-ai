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

# Story 2 — implementation notes, deviations and blocked items

## Blocked

Nothing behavioural. E2E runs in **Chromium and Firefox** (`npm run test:e2e`:
38 tests, 19 per browser). WebKit is still the one blocked browser, exactly as
recorded in the story 1 section above: `npx playwright install webkit` fails on
this host because its system libraries (libavif) are missing and cannot be
installed without root, and `playwright.config.ts` therefore builds its project
list from the browsers that are actually installed and runnable — WebKit joins
automatically on a machine that has it. Story 2 has no browser-specific code
path: dragging, font fit and clipping are ordinary DOM/CSS behaviour, and
TC-31/TC-32 (drag geometry) and TC-33 (font fit and clipping) pass in both
browsers available here.

## Deviations from the design document

1. **`createSticky` returns `string | null`, not `string`.** The design's model
   table gives every mutation a success/failure result, and creation can fail
   (non-finite coordinates, TC-39). Returning `null` on rejection keeps the
   result honest and lets `App` skip the selection/edit that would otherwise
   point at a note that was never written.
2. **`bringToFront` and `setStickyColor` return `false` for a no-op.** A drag of
   the already-topmost note (TC-10) and a swatch click that picks the current
   colour emit no Yjs update; `false` means "nothing was written", not "the
   interaction failed", and the callers (drag, toolbar) continue regardless.
3. **A drag is listened to on `window`, not only on the note element.**
   Bringing a note to the front re-orders its DOM node, and browsers release
   pointer capture when a captured element is moved — with element handlers only,
   the drag stopped after the first pointer move (found by the e2e tests: the
   note moved by exactly one drag step and then froze). `StickyNote` attaches
   `pointermove` / `pointerup` / `pointercancel` on `window` for the duration of
   a drag and removes them when it ends, so re-ordering cannot interrupt it.
   `lostpointercapture` is deliberately *not* treated as the end of a drag.
4. **Extra named settings.** `STICKY_PADDING_WORLD` (16) is the note's padding,
   which the design gives as a number but not as a setting; `STICKY_TEXT_BOX_WORLD`
   (size − 2 × padding) is derived from it. `NOTE_TOOLBAR_HEIGHT_SCREEN` (34) and
   `NOTE_TOOLBAR_GAP_SCREEN` (8) are the note toolbar's screen-space geometry,
   needed for its `scale(1 / zoom)` counter-scaling. All live in
   `src/shared/config.ts` next to the settings the design names.
5. **Board object layer.** `BoardViewport` renders story 2's notes inside the
   existing world layer (children of the viewport component). `board-world` keeps
   `width: 0; height: 0` so empty board space is still hit-tested by the grid and
   story 1's pan/drag behaviour is unchanged; notes re-enable pointer events.
6. **`window.__vidi6Board` test hook.** Not in the design. Component and e2e
   tests assert what the *document* holds (position, colour, z, text) rather than
   what the DOM shows, and story 3 will need the same view of the doc. Installed
   only in `--mode test`, like story 1's camera hook.

## Notes on the implementation

- **Yjs from the first story.** Notes live in `doc.get("objects", "map")`, one
  Y.Map per note with a `Y.Text` for the text, so stories 3 and 4 only add a
  provider and persistence: no storage rewrite, no merge of a REST shape.
  Every mutation is one explicit transaction with `LOCAL_ORIGIN`, and the unit
  tests count `update` events so a rejected mutation is provably silent.
- **Selection and editing are local React state** (`useSelection`), never written
  to the document: two users can select and edit different notes without
  interfering, and nothing about interaction reaches the sync layer.
- **Text edits are minimal diffs.** `applyTextDiff` matches the common prefix and
  suffix and writes only the changed middle (TC-13); the editor drives it from the
  textarea value, applies `clampToLimit` first (surrogate-safe), and defers IME
  input to `compositionend` so a composed character is written once.
- **Font fit** (`fitFontSize`) measures the text element and binary-searches
  between `STICKY_FONT_MIN_PX` and `STICKY_FONT_MAX_PX`; it short-circuits at both
  ends (one measurement for a short note, two for text that never fits) and
  reports `overflow`, which the note renders as a fade over the clipped bottom.
- **jsdom has no text layout**, so `fitFontSize` is unit-tested with an element
  whose `scrollHeight` follows the font size just measured, and the real layout
  path (24 px for one word, clipped at the limit with a fade) is asserted in e2e
  (TC-33).
- **Test helpers for notes** in `tests/e2e/helpers/board.ts`: `boardNotes()` reads
  the document through the test hook, `noteBox` / `noteCentre` / `notePaintOrder`
  describe what is painted, and `dragNote` waits until no note is dragging before
  the assertions run.

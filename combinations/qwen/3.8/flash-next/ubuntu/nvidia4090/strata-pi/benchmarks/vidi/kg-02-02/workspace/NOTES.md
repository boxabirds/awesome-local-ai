# Implementation notes, deviations and blocked items

(Spec sections are shared across stories; story 1's notes are kept below story 2's
history notes, and everything is cumulative.)

# Story 2 — sticky notes

## Blocked

### The reload half of TC-34 is skipped (`test.skip`)

Nothing in story 2 stores the board document: there is no worker entry at all
(`wrangler.jsonc` is assets-only, `assets.directory: "./dist/client"`), so a
reloaded page starts from a fresh `Y.Doc`. Story 2's non-goals say "no persistence
beyond a single client's Y.Doc", so the test that reloads the page and expects the
notes to be back is `test.skip` in `tests/e2e/sticky-notes.spec.ts` with a comment
pointing at story 3 (Durable Object / provider). Everything story 2 *does* promise
about the document is asserted instead: both creation routes, drag, recolour and
delete all go through the Y.Doc and are read back from the rendered board.

### WebKit is still not runnable here (unchanged from story 1)

`npx playwright install webkit` fails host validation (missing system libraries,
no root). Story 2's e2e runs in **chromium + firefox** — Firefox had to be
re-installed in this sandbox (`npx playwright install firefox`), which is why
`npm run test:e2e` runs 2 projects here and 1 project before that install.

## Deviations from the design document

1. **`createSticky` returns `string | false`.** The design's signature is `: string`,
   but TC-39 requires `createSticky` to *reject* non-finite coordinates ("returns
   false; 0 updates"). A union is the only way to express both. Callers in the
   client ignore the return value when the input came from the model's own maths.
2. **`useBoardDoc(doc?: Y.Doc)` takes an optional document.** The design's hook
   creates its own `Y.Doc`; the optional argument lets component tests inject a
   prepared document (and lets story 3 pass the provider's document later) without
   a second hook. Without an argument it behaves exactly as designed: one `Y.Doc`,
   `initDoc`, `objects.observeDeep`, memoised `snapshot`, `useSyncExternalStore`.
3. **"Text centred" is horizontal centring only.** The PRD asks for centred text in
   both display and edit mode. Vertically centring a textarea needs measured height
   and makes the text jump when editing starts/ends, so centring is
   `text-align: center` in both states and padding lives on `.sticky-body`
   (12 world units), which keeps the fit calculation (`scrollHeight` of
   `.sticky-text` against `STICKY_SIZE_WORLD − 2 × STICKY_TEXT_PADDING_WORLD`) the
   same in display and edit mode.
4. **The note toolbar is anchored inside the note and counter-scaled** rather than
   rendered in a separate screen-space layer: `.note-toolbar-anchor` sits at the
   note's top-left and applies `scale(1 / zoom) translateY(-100%)`, so its on-screen
   size and position are zoom-independent while it still moves with the note. That
   required removing `overflow: hidden` from `.sticky-note` (the toolbar sticks out
   above the note box); the clipping that the text needs lives on `.sticky-body`
   and `.sticky-text` instead. Found by the e2e run: with `overflow: hidden` the
   swatches were unclickable ("board-grid intercepts pointer events").
5. **`BoardViewport` stays sticky-agnostic.** The design has the viewport call
   `createSticky`. It does not know the model: it decides *empty space vs. note*
   (a `dblclick`/click whose target is the viewport or the grid) and calls
   `onEmptyDoubleClick(worldPoint)` / `onEmptyClick()`; `App.tsx` performs the model
   write, the selection and the start of editing. Panning a note-less board and
   story 1's tests are untouched, and story 2 adds no camera coupling.
6. **The character counter is shown whenever the note is within 50 characters of
   the limit**, not only inside the editor: the PRD describes it while editing, and
   the design's TC-33 checks it after the paste has been committed. A near-full
   note therefore keeps its `n/1000` counter when it is only selected.
7. **Keyboard handling is at window level with an editable-target guard**
   (`App.tsx`): Enter edits the selected note, Delete/Backspace delete it, and both
   are ignored while editing or when focus is in an input/textarea — this is what
   makes TC-26 (Backspace while editing edits text, never deletes the note) hold.
   `StickyTextEditor` handles its own Escape/Enter/blur.
8. **Ports moved to this agent's sandbox range.** Story 1's notes name 27840/27841;
   story 2 runs with `AGENT_PORT_FIRST=29440`, so `vite.config.ts` uses 29440 (dev)
   and 29441 (preview), and `serve:e2e` uses `--port 29440 --inspector-port 29441`.
   `E2E_PORT` / `E2E_BASE_URL` can move the e2e port inside the range.
9. **Extra e2e cases beyond the numbered TCs**: text-boundary coverage in the
   browser (typed and pasted overflow, counter appearing at 950 not 949), a
   keyboard-reachability case (focus → Enter → Escape → Tab → Delete, and the bin
   button), and a story 1 regression case (pan, zoom, click still behave with notes
   on the board). No listed TC is missing.

## Notes that affect the tests

- **Playwright `webServer` must name the URL, not the port.** With `port:` only,
  Playwright polls `http://localhost:<port>`; `wrangler dev --ip 127.0.0.1` does not
  bind `::1`, so the probe never succeeds and the run dies with
  *"Timed out waiting 180000ms from config.webServer"*. `playwright.config.ts` uses
  `url: "http://127.0.0.1:29440"` instead, which both reuses a server that is already
  up and waits correctly for one it starts itself.
- **`renderedCamera()` in `tests/e2e/helpers/board.ts` is only exact at zoom 1**: in
  the inline-transform branch it takes the world layer's `translate(...)` values as
  world units without dividing by zoom (story 1 code, left as it is because story 1's
  assertions only use it at 100 %). Story 2's pixel assertions use `readCamera()`
  (the camera state) plus `settle()`, and `setCamera()` to put the board at an exact
  50 % / 200 % zoom.
- **jsdom has no layout engine**, so `scrollHeight` is 0 and `fitFontSize` always
  returns the maximum font in component tests. Font fitting, clipping and the fade
  are only asserted in e2e (TC-33: 24 px for one word, ≥ 10 px for 1,000 characters,
  `scrollHeight > clientHeight`, fade element visible, nothing painted outside the
  note box).
- **`data-panning` lives on `[data-testid="board-viewport"]`**, not on the grid —
  the "the board did not pan" assertion reads it from the viewport element.
- **Pointer events in jsdom** need `setPointerCapture`/`releasePointerCapture`
  stubs and `pointerId`; `tests/component/helpers/notes.tsx` builds them, presses
  below/above `DRAG_THRESHOLD_PX`, and `settle()` (two animation frames plus a
  macrotask) waits for the rAF-throttled drag writes to land.
- **Surrogate safety is tested at both layers**: `clampToLimit` and `applyTextDiff`
  unit tests (TC-13 extras) and an emoji drag/edit case in the component tests.

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

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

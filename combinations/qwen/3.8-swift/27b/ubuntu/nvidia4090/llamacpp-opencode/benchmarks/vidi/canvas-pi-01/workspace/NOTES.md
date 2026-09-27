# Story 1 — Notes

Pan and zoom around an infinite board. All tests pass:

- `npm run typecheck` — clean
- `npm run test:unit` — 16/16 (camera maths, TC-01..12 + property check)
- `npm run test:component` — 19/19 (TC-13..22, 29, 30, 32 + extras)
- `npm run test:e2e` — 12/12 (4 tests × chromium/firefox/webkit, via `wrangler dev`)
- `npm run build` — production bundle builds; the `window.__vidi6` test hook is
  absent from production output (guarded by `import.meta.env.MODE === 'test'`)

## Design contract extensions

The implementation keeps the design contract and adds members it needs; nothing
in the contract was changed or removed.

### `useCamera` return value (`CameraApi`)

Beyond `camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset`:

- `panning: boolean` — true while a pointer drag is in progress; the viewport
  renders `data-panning` and a `grabbing` cursor from it, and TC-13/TC-14 assert
  the Idle → Panning → Idle cycle through it.
- `gestureStart(): void`, `gestureChange(scale: number, point: Point): void` —
  Safari trackpad pinch (the design lists `gesturestart/gesturechange` as
  inputs; the contract signature list omitted the corresponding hook methods).
- `setCamera(cam: Camera): void` — test-only camera jump; wired to
  `window.__vidi6.setCamera` in `testHooks.ts`, enabled only in test mode.

### `BoardViewport` props

The design shows `BoardViewport({ children? })`; the implementation is
`BoardViewport({ children?, cam: CameraApi })`. `App` owns the single
`useCamera` instance (so the viewport, zoom controls and hint share one camera)
and injects it as a prop — matching the structure diagram, where everything
wires to the one hook.

## Decisions and deviations

- **`wrangler.jsonc`**: no `assets.binding`. Wrangler 4.141 rejects an
  assets-only config that declares a binding without a Worker `main`. The
  `ASSETS` binding returns in story 3 together with the Worker script.
- **E2E build**: `npm run build:e2e` (`vite build --mode test`) so the
  `__vidi6` hook exists in the bundle served to the e2e suite; `npm run build`
  (production mode) excludes it.
- **E2E drag robustness (WebKit)**: WebKit + Playwright can deliver synthetic
  `pointerdown` late (after queued `pointermove`s) or drop it under load.
  `dragBoard` in `tests/e2e/helpers/board.ts` verifies `data-panning` after
  `mouse.down()` and retries if the down was lost; a shortfall pass compensates
  for coalesced `pointermove` events so the asserted net pan is exact.
  The app code itself is unchanged by this — moves before `pointerdown` are
  simply ignored by the hook.
- **Transform assertions are numeric**: JS stringifies `±1000000` as
  `±1e+06` in inline styles, so e2e helpers parse the world-layer transform
  and compare numbers, not strings.
- **Grid rendering**: the dot grid is a CSS `radial-gradient` background on the
  viewport with `background-size = GRID_SPACING_WORLD * zoom` and
  `background-position` wrapped with a positive modulo — even at zoom 0.1 far
  from the origin (TC-27).
- **Origin marker**: a small crosshair at world (0,0) (`data-testid="origin-marker"`)
  so e2e can measure "the board's starting point" directly.

## Test-to-spec map

- `tests/unit/camera.test.ts` — TC-01..12 + a seeded property check
  (round-trip / invariance, clamping, drift over 10 000 zoom steps).
- `tests/component/BoardViewport.test.tsx` — TC-13..18, TC-29, TC-30 +
  deltaX wheel panning + drag-target restriction.
- `tests/component/ZoomControls.test.tsx` — TC-19..21, TC-32.
- `tests/component/NavigationHint.test.tsx` — TC-22 + visibility/positioning.
- `tests/e2e/navigation.spec.ts` — TC-23..28, TC-31 (three design workflows +
  page-zoom isolation), on chromium, firefox and webkit.

# Story 2 — Notes

Capture ideas on sticky notes and rearrange them. All tests pass:

- `npm run typecheck` — clean
- `npm run test:unit` — 41/41 (camera 16 + board-model TC-01..12 = 15 + sticky-text TC-13..17 = 10)
- `npm run test:component` — 40/40 (sticky.interaction TC-18..22/25/35..37, sticky.text TC-23/24/26/38, sticky.toolbar TC-27..29 + standalone drag-state-machine tests)
- `npm run test:e2e` — 30/30 (navigation 4 + sticky-notes 6, × chromium/firefox/webkit)
- `npm run build` — production bundle builds; `window.__vidi6` excluded (test-mode guard)

## Decisions and deviations

- **`createSticky` rejection**: non-finite coordinates return `''` (no id),
  matching the board-model contract in the design.
- **Drag end notification**: `onDraggingChange(null)` fires only if a real
  drag (≥ `DRAG_THRESHOLD_PX`) started, so a plain click never emits a
  start/end pair (TC-19: "no onDraggingChange calls").
- **Pointer capture vs. z-reorder**: bringing a note to the front on drag
  start reorders the DOM (React `insertBefore` removes the node transiently),
  and browsers release pointer capture on removal. Two consequences:
  - a defensive `onLostPointerCapture` handler would abort the drag, so it was
    not used — real cancellations arrive as `pointercancel` (TC-21);
  - the capture is re-acquired in a post-commit effect once `dragging` turns
    true, so the drag keeps receiving pointer events even when the pointer
    outruns the note.
  This only matters for notes that are *not* already topmost (single-note
  boards no-op in `bringToFront` and never reorder).
- **Component tests under fake timers**: React 19's scheduler cannot run
  scheduled tasks while time is frozen, so raw `dispatchEvent` interactions
  leave state unflushed. `tests/component/helpers.tsx` wraps clicks/keys/input
  in `act()` (`click`, `keyOn`, `windowKey`, `inputValue`, `dispatch`).
- **jsdom colour normalisation**: inline `#F48FB1` reads back as
  `rgb(244, 143, 177)`, so TC-27 asserts the rgb form.
- **E2E drag robustness (sticky notes)**: `dragNote` probes 3px after
  `mouse.down()` and verifies `data-dragging="true"` on the note *under the
  grab point* (not the first DOM note) before committing; `dragNoteExactly`
  measures the dragged note's centre before/after and compensates dropped
  `pointermove` events (WebKit) so asserted movements are exact.
- **E2E camera fixtures**: `screen = zoom · (world − camera)`, so keeping
  world (0,0) at screen (640,400) needs camera `(−640/z, −400/z)`: 50% →
  (−1280,−800), 200% → (−320,−200).
- **E2E doc inspection**: `page.evaluate` reads the Y.Doc through
  `window.__vidi6.getDoc()`; `Y.Map` items require `.get('x')`, not
  property access, and evaluate callbacks must be self-contained (no
  module-scope references).

## Test-to-spec map (story 2)

- `tests/unit/board-model.test.ts` — TC-01..12 (each mutation test asserts
  the `update` event count: 1 on success, 0 on rejection).
- `tests/unit/sticky-text.test.ts` — TC-13..17.
- `tests/component/StickyNote.test.tsx` — TC-18..22, TC-25(+b), TC-35..37
  (app level) + standalone drag-state-machine tests against a real Y.Doc
  (threshold, zoom division, pointercancel, deletion mid-drag).
- `tests/component/StickyTextEditor.test.tsx` — TC-23, TC-24, TC-26, TC-38.
- `tests/component/Toolbars.test.tsx` — TC-27..29.
- `tests/e2e/sticky-notes.spec.ts` — TC-30..34 + the brainstorm golden path,
  on chromium, firefox and webkit.
- `tests/fixtures/texts.ts` — shared prose fixtures (short phrase, 1,000 and
  1,200 character paragraphs).

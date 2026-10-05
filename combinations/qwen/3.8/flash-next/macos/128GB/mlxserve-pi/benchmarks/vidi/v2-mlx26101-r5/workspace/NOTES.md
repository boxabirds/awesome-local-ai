# Notes

Decisions, deviations and environment findings while implementing story 1 (everything
up to "Findings while testing the implementation") and story 2 ("Story 2: sticky
notes", at the end).

## Ports

The allowed range is 20784–20799. Defaults: `npm run dev` → 20786 (Vite),
`npm run e2e:serve` / Playwright → 20784 (`wrangler dev`), inspector → 20785.
All three are overridable (`VIDI6_DEV_PORT`, `VIDI6_E2E_PORT`,
`VIDI6_E2E_INSPECTOR_PORT`). `server.host = true` is set in `vite.config.ts` so the
dev server answers on both `127.0.0.1` and `localhost` (with the Vite default it
bound to the IPv6 loopback only and `curl http://127.0.0.1:20786` failed);
`strictPort` is deliberately off so a busy port moves to the next free port in
range instead of exiting.

## Contract deviations (all additive)

- **`BoardViewport` takes a `controller` prop.** The design's contract is
  `BoardViewport(props: { children?: ReactNode })`. One camera has to be shared by
  the viewport, the zoom control and the hint, so `App` calls `useCamera` and passes
  the resulting `CameraController` (camera, `hasNavigated`, `isPanning`, and the
  handlers named in the `useCamera` contract) down as a prop. `children` still works
  and is rendered in world coordinates.
- **`useCamera` returns a superset** of the contract: `isPanning` (drives
  `data-panning` and the grabbing cursor), `zoomBy(factor, point)` (the Safari
  gesture path) and `setCamera(patch)` (the `window.__vidi6` hook). Everything named
  in the contract is there with the documented signature.
- **`hasNavigated` is `useState` backed by a `useRef` latch**, because a ref alone
  cannot re-render the hint away. The latch semantics from the design hold: it only
  flips when `camera.ts` returns a *different* object, so TC-29 (click without
  movement, no-op zoom at a limit) does not dismiss the hint, and it never resets
  during the visit.
- **Extra files:** `src/client/canvas/testHooks.ts` (the `window.__vidi6` fixture,
  listed under "Fixtures" in the design) and `src/client/styles.css`.

## Camera maths

Exactly as specified: immutable `Camera`, `x`/`y` = world point at the viewport's
top-left, `zoomAt` keeps the world point under the pointer and returns the *input
object* for no-ops and invalid factors, `zoomStep` snaps to the nearest
`ZOOM_STEP_FACTOR^n` (epsilon `STEP_SNAP_EPSILON = 1e-9`) so 125 % → 100 % lands on
exactly 1.0. All limits come from `src/shared/config.ts`; `PERCENT = 100` is named.
The unit suite includes the seeded 1,000-case property check for pointer invariance.

## Grid rendering

The dot grid is the viewport's own `background-image` (radial-gradient), with
`background-size = GRID_SPACING_WORLD * zoom` and `background-position` = `-camera.xy *
zoom mod spacing`, so dots stay welded to world intersections. Two details:

- CSS values go through `px()`, which renders `Number(value.toFixed(6))`. Camera
  values around 1e6 would otherwise serialise as `1e+6px`, which CSS rejects.
- The offset is taken modulo the spacing so it stays small at any distance; that is
  what makes 1,000,000 units out look identical to 0.
- The world layer uses `transform: scale(zoom) translate(-x px, -y px)` with
  `transform-origin: 0 0` (one composited transform, no per-dot DOM). The origin
  marker counter-scales by `scale(1/zoom)` about its own centre so the crosshair
  stays a fixed screen size while its centre stays welded to world (0,0).
- The world layer is `pointer-events: none`; object stories re-enable it per object.
  `cursor: grabbing` is applied to the viewport while panning.

## Event handling details worth remembering

- `wheel` is bound natively with `{ passive: false }` (React's `onWheel` is passive)
  and always `preventDefault()`s — that plus prevented Safari `gesture*` events and
  the three prevented shortcuts is what keeps page zoom from moving.
- `deltaMode` is converted with named constants: `WHEEL_DELTA_LINE_PX = 16`,
  `WHEEL_DELTA_PAGE_FRACTION = 0.9` of the viewport height.
- The keyboard shortcuts are on `window` (the viewport is a `div` and does not take
  focus first), are skipped when the target is editable, and handle `=`/`+`,
  `-`/`_` and `0` with Ctrl **or** Cmd. `Ctrl/Cmd + 0` is prevented, which also stops
  the browser's own "reset zoom".
- Drag starts only when `event.target` carries `data-board-surface` (the viewport or
  the grid), so object stories can own their own pointerdown.
- `lostpointercapture` is handled with a **native listener on the viewport** rather
  than React's `onLostPointerCapture`: React's root-delegation does not deliver that
  event in jsdom, and a native listener is also closer to the browser's own dispatch.
- The zoom control stops wheel propagation (passive listener) so Ctrl-wheel over the
  buttons never reaches the board (TC-30).

## Test infrastructure

- **Vitest projects**: `unit` (node, `tests/unit/**`), `component` (jsdom,
  `tests/component/**`, setup `tests/component/setup.ts`). Config lives in
  `vitest.config.ts` (Vitest reads the `projects` field there; `vite.config.ts` stays
  build-only).
- **rAF batching vs fake timers:** the design suggested fake timers. The hook batches
  with `requestAnimationFrame`, and jsdom's rAF plus React 19's `act()` interact badly
  with fake timers, so component tests use a real ~40 ms `settle()` inside `act()`
  (exported from `tests/component/harness.tsx`) to let the queued frame land.
- **jsdom gaps** (all guarded in the implementation, so production code is unaffected):
  no `setPointerCapture`/`hasPointerCapture` (tests fire `lostpointercapture`
  directly), no `ResizeObserver` (the viewport size comes from `window.innerWidth` in
  the harness), and `PointerEvent`/`WheelEvent` constructors exist but Testing Library
  `fireEvent` cannot build them with pointer semantics — the harness dispatches
  `window.PointerEvent` instances itself. `@testing-library/user-event` is installed
  per the design's dependency list but is not used for the viewport, because it
  cannot express pointer capture or Safari gesture events.
- `IS_REACT_ACT_ENVIRONMENT` is set in the component setup file (React 19 requires it).
- Component tests assert on the *rendered* camera (`data-camera-x/y/zoom`) and the
  world layer transform rather than on internals, and expected values are computed
  from the same config constants the implementation uses.

## E2E

- The `test:e2e` webServer runs `npm run e2e:serve` (`vite build --mode test` +
  `wrangler dev --local`), so the tests hit the real serving path.
- `window.__vidi6.setCamera/getCamera` is installed only when
  `import.meta.env.MODE === 'test'`; verified by grep: the production bundle contains
  zero occurrences of `__vidi6`, the test build contains it.
- **Firefox and WebKit cannot launch in this sandbox** (`SIGABRT` / `Abort trap: 6`
  during browser start, before any test code runs). Chromium passes 7/7. Instead of
  deleting the two projects from the browser matrix, the project list is env-driven:
  the default is `chromium` (so `npm run test:e2e` is green everywhere) and
  `VIDI6_E2E_PROJECTS=chromium,firefox,webkit npm run test:e2e` runs the full matrix
  on a machine where those browsers start. This is the only story-1 task that could
  not be fully executed here.
- `wrangler.jsonc` declares **no `ASSETS` binding**: wrangler 4 rejects an asset
  binding in an assets-only Worker ("Cannot use assets with a binding in an
  assets-only Worker"). The binding comes back with story 3's `main` entry point.
  `not_found_handling = single-page-application` is kept.
- Playwright waits on state, not sleeps: `expect.poll` on the rendered camera,
  `toHaveText` on the label. `dragAndSettle` asserts the camera delta itself, which
  is how "200 px drag moved the board exactly 200 px" is checked 1e6 units out where
  the marker is off screen; the on-screen variants measure the origin marker's
  `boundingBox()` centre.

## Findings while testing the implementation

- An early version of the grid test asserted `background-position` with `Number()`,
  which returns `NaN` for fractional CSS values like `12.5px`; `Number.parseFloat`
  is the right parse. Not an implementation bug.
- A component test that left a drag open (no `pointerup`) made the following drag's
  delta start from the previous drag's last point, which is correct behaviour for
  `beginPan` being a no-op while already `Panning` — the test now ends its drags. This
  confirmed the state machine really ignores a second `pointerdown`.
- `expect.closeTo(v, 6)` is too tight for e2e because the `data-camera-*` attributes
  are rounded to 6 decimals; precision 5 is used for camera comparisons.
- TC-33 (shortcuts while the address bar has focus) is not testable in-page, as the
  design says; nothing implemented for it.

---

# Story 2: sticky notes

## Contract deviations (all additive)

- **`createSticky` returns `string | false`** instead of `string | null`, and
  **`moveObject` returns `false` for a no-op as well as for a rejection**. The design
  only says "returns null / returns false"; the point of the return value is "did this
  mutate the document", and every mutation test asserts exactly one `update` event, so
  a no-op has to be `false` too. `LOCAL_ORIGIN = 'vidi6:local'` is exported from
  `board-model.ts` and passed to `applyTextDiff` so the diff helper can skip its own
  updates.
- **Extra config constant: `STICKY_PADDING_WORLD = 12`.** The design's constant list has
  no inner padding, but the text box, the editor and the fade all need the same inset,
  and the note's content box (`STICKY_SIZE_WORLD - 2 * 12 = 176`) is what the auto-fit
  measures against. It is handed to CSS once per note as `--sticky-pad`, so there is
  one source of truth.
- **`StickyNote` takes a `doc` prop** (plus `onDeleted` for the toolbar's bin button)
  besides the props in the design's signature, because the note writes to the document
  itself (drag, colour, delete) rather than through callbacks.
- **`BoardViewport` takes two more optional props**: `onCreateSticky(world)` (a
  double-click on the board surface, already converted to world coordinates) and
  `onClearSelection()` (a press on the surface that never passed the drag threshold).
  Both are gated on `data-board-surface`, so an object's double-click and press never
  reach them.
- **`App` is now a thin default export over a named `Board`**, which accepts
  `{ viewport?, handle? }`. `viewport` pins the window size for jsdom (which has no
  layout and reports 0x0) and `handle` exposes `{ doc, notes, selection }` to component
  tests. Rendering `<App />` is unchanged.
- **`isTypingTarget` lives in `StickyTextEditor.tsx`** and is imported by `App` for the
  window-level Delete/Backspace/Enter handler, so there is one definition of "focus is
  in a field".
- **Extra `data-*` attributes for testability**, all documented in the tests that read
  them: `data-interaction` on a note (`unselected | pressed | selected | dragging |
  editing`), `data-x/y/z`, `data-font-px` (computed font size, in world units),
  `data-overflow`, and `--inv-zoom` on the world layer so the note toolbar can
  counter-scale with the camera.

## Dragging: pointer capture is not something you can lean on

Two findings from the first real-browser run, both of which the component suite could
not see (jsdom has no `setPointerCapture` and no layout):

- **Coming to the front drops pointer capture.** A drag starts with `bringToFront`,
  which changes the note's `z`; the note list is rendered sorted by `z`, so React moves
  the note's DOM node, and Chromium releases pointer capture for a node that is taken
  out of the tree. The resulting `lostpointercapture` ended the drag on the very first
  `pointermove` — the note never moved. `onLostPointerCapture` is gone: the drag is
  ended by `pointerup`/`pointercancel` only.
- **Following the pointer needs a capture-phase window listener.** While dragging, the
  note's own `pointermove` handler calls `stopPropagation()` so the board never pans,
  which also stops the event from ever reaching a bubble-phase `window` listener. So
  the listeners that keep the note under the pointer (moves outside the note's box,
  `pointerup`, `pointercancel`) are registered on `window` with `capture: true` while
  `dragging` is true, and removed on cleanup. Capture calls are wrapped in
  `try/catch`, because a pointer that is no longer active makes `setPointerCapture`
  throw and that used to abort the handler before it wrote a position.
- **The flush has to run before the session is cleared.** `finishDrag` originally set
  `dragRef.current = null` first and then called `writePosition()`, which reads
  `dragRef.current` and silently returned: the last pointer position was never written
  (up to one frame of lag at the end of every drag). Now: cancel the pending frame,
  flush, then clear.
- Positions are written once per animation frame, from `lastClient{X,Y}`, so
  `data-x/data-y` can trail the pointer by a frame. E2E reads use `expect.poll` on the
  note position rather than reading the DOM immediately after a synthetic move.

## Text, limits and auto-fit

- The editor is **uncontrolled** (`defaultValue` from the `Y.Text`) and every `input`
  event writes a minimal diff straight into the `Y.Text`; ending editing performs no
  further write, so nothing typed is lost if a remote peer deletes or recolors the note
  mid-edit. `applyTextDiff` keeps the common prefix/suffix and replaces the middle —
  a keystroke is one `insert`, never a rewrite of 1,000 characters — and never splits
  a surrogate pair, so an emoji is typed and deleted as one character (TC-20, TC-38).
- **Too-long input is taken back**: on a clamped input the textarea's own value is
  reset to the kept text and the caret is put at the end, which is what keeps a
  1,200-character paste from leaving the extra characters on screen (TC-15).
- **IME**: `compositionstart` sets a flag, `input` events during composition only update
  the counter, and `compositionend` commits `el.value` once (TC-16, TC-26). Escape is
  ignored while composing: during a composition the input method owns Escape.
- **Auto-fit** is a binary search between `STICKY_FONT_MIN_PX` and `STICKY_FONT_MAX_PX`
  over a hidden mirror of the text box (`.sticky-measure`, the same width and
  `overflow: hidden`), so "the text never renders outside the note box" holds at 50 %,
  100 % and 200 %: zoom scales the whole note, the fitted font size is in world units.
  When even the smallest font overflows, the fade element is rendered
  (`data-overflow="true"`), and the whole text is still in the DOM — the fade is only
  a gradient over the bottom of the note (TC-17, TC-33).

## Test infrastructure added in story 2

- `tests/fixtures/texts.ts` is the only source of long note text: the golden-path
  phrase, a three-line retrospective item, an exactly-1,000-character English paragraph
  (built from real sentences, so it wraps like real text) and a 1,200-character paste.
  Surrogate-pair text lives with the tests that need it: nothing splits an emoji —
  `applyTextDiff` keeps pairs intact (TC-13) and `clampToLimit` drops a dangling high
  surrogate instead of leaving half an emoji behind (TC-15). The limit is counted in
  UTF-16 code units, which is what `Y.Text` indexes and what the counter shows.
- `tests/component/harness.tsx` gained `renderBoard()` (whole `Board` with a pinned
  viewport, an empty note list and a `handle`), plus `dragOn`, `click`, `type`,
  `setInput`, `doubleClick`, `noteText`, `centredOn` and `nextFrame`. Tests that need
  real Yjs behaviour use a real `Y.Doc` and count `update` events; no Yjs call is mocked.
- `tests/e2e/helpers/board.ts` is page-first like story 1's helpers and adds
  `doubleClickCreate`, `toolbarCreate`, `pressNoteAndMove`, `dragNote`,
  `waitForNoteAtRest`, `noteWorld`, `noteScreenBox`, `noteColor`, `noteInteraction`,
  `noteFontPx`, `noteText` and `editorValue`. **`setCamera` now waits for the rendered
  camera** (`expectCamera`) after calling the hook, because the patch goes through React
  state and the DOM attribute lands one frame later — reading it immediately used to
  return the pre-patch camera and made an assertion about a note's world position
  meaningless.

## Findings while testing the sticky note implementation

- A component test cannot see anything about overflow: jsdom's
  `getBoundingClientRect()` is all zeros, so font fitting and the fade are only asserted
  in e2e; the component suite asserts `data-x/y/z`, `data-interaction`, text and colour
  instead.
- `data-interaction="pressed"` only exists inside a pointer session, so the note
  re-renders (`setPressRender`) when the session opens and closes; without that the
  attribute would skip the state the tests are named after.
- `expect.closeTo(v, 2)` is still too tight for a note position read straight out of the
  DOM after a synthetic mouse move (Playwright's own coordinates can be fractional);
  precision 0 is half a world unit, which is far stricter than the PRD's "grabbed point
  within one screen pixel" and is what the drag tests use.
- Firefox and WebKit still cannot launch in this sandbox (`SIGABRT` / `Abort trap: 6`
  during browser start, before any test code runs) — the same finding as in story 1, so
  the 38 sticky note e2e tests were run in chromium only, three times over, with no
  flakiness. `VIDI6_E2E_PROJECTS=chromium,firefox,webkit` fails in `browserType.launch`,
  not in an assertion.
- `BoardViewport`'s `onCreateSticky` already passes **world** coordinates (the design says
  "the point is converted screen→world before it reaches here"). App passed it through
  `screenToWorld` a second time, which put notes at `(screen - cam)/zoom` instead of
  `screen + cam`: invisible until you panned, and invisible to the drag tests because the
  note box and the pointer were both off. Both creation paths now agree on "world in".
- **Keyboard-only authoring had a gap**: Enter/Delete were wired to the *selection*, but
  Tab-focus and selection are different things — a keyboard user could focus a note and
  nothing happened. The shortcuts now fall back to the focused note
  (`event.target.dataset.noteId`), and only for the note element itself: a focused swatch
  or bin button keeps the browser's own Enter/Delete meaning.
- Chromium's sequential focus navigation resumes **after the position of the element that
  was removed**: after the editor unmounts, the first Tab goes to the note's first toolbar
  button, and the note element itself is reached only when the ring wraps around. A Tab
  test therefore walks the ring (bounded) instead of asserting "the first stop is the note".
- Test marker files (`.test-unit`, `.test-component`, `.test-e2e`, `.dev-server`, …) appear
  in the repository root while the scripts run; `git status` should not be alarmed, they
  are removed when the run finishes and are not committed.

## Final test counts (story 2)

| Suite | Files | Tests |
| --- | --- | --- |
| `npm run test:unit` | 3 | 65 (25 board-model, 24 camera from story 1, 16 sticky-text) |
| `npm run test:component` | 6 | 65 (16 StickyNote, 10 StickyTextEditor, 14 Toolbars, 25 from story 1) |
| `npm run test:e2e` | 5 | 38 (31 sticky note, 7 from story 1), chromium, `--repeat-each=3` stable |

`npm run build` and `npm run typecheck` are clean.

# Notes

Decisions and judgement calls made while implementing stories 1 and 2 (story 2's start
below the `## Story 2` heading). The spec (`spec/`) is read-only, so anything that
needed interpreting is recorded here.

## Toolchain

- **Vite 8 + React 19 + TypeScript 5.9**, client output to `dist/client`, served by
  `wrangler dev` (`wrangler.jsonc` is assets-only; Worker code arrives in story 3).
- **`.npmrc` sets `legacy-peer-deps=true`.** npm 9.2.0 on this machine aborts on a
  peer-set conflict between `@testing-library/react` 16 and its peers; the flag keeps
  installation working. `@testing-library/dom` therefore has to be a direct dependency
  (it is a peer of `@testing-library/react` v16, not a transitive one).
- **One `vitest.config.ts` with two projects**: `unit` (node environment,
  `tests/unit`) and `component` (jsdom environment, `tests/component`, setup file
  loads `@testing-library/jest-dom`). `test:unit` / `test:component` select them;
  jsdom is deliberately not used for the maths tests.
- **Ports** all sit inside the allowed 20192–20207 range: the e2e `wrangler dev` runs on 20194
  (its inspector on 20195, which is still a localhost listener on 127.0.0.1), and
  `npm run preview` pinned to 20196. Vite's own dev server default (5173) is unused by
  the tests.

## Camera and rendering

- `camera.ts` is **pure maths only** (no DOM, no React), which is what makes TC-01 to
  TC-12 fast unit tests and lets the e2e spec re-use the same functions to predict the
  zoom label sequence.
- Camera updates are **coalesced to one React render per animation frame** in
  `useCamera`: pointer and wheel events update a ref immediately (so a rapid sequence
  of events accumulates exactly) and schedule a `requestAnimationFrame` flush. When
  there is no rAF (jsdom without rAF, hidden tab) it falls back to a 16 ms timer.
  Tests wait for the camera to settle before asserting on pixels.
- **Resize does not move the board**: the camera is the world coordinate at the
  *top-left* of the board area, and the world layer is
  `scale(zoom) translate(-x, -y)` with `transform-origin: 0 0`, so a window resize
  changes only how much board is visible. Covered by an e2e test.
- **Dot grid**: `background-size = GRID_SPACING_WORLD * zoom`, and the position is the
  design's `-x * zoom mod spacing` shifted by half a tile, because a radial gradient
  paints its dot in the *centre* of the tile. Without that half-tile shift every dot
  would sit half a grid cell away from the world coordinates it is supposed to mark.
  The dot radius stays 1 CSS px at all zooms and its alpha fades as the grid gets
  denser, otherwise at 10% the dots (2.4 px apart) merge into a grey wash. Dot alpha
  does not change spacing, so TC-27's spacing assertion is unaffected.
- **Origin marker**: a zero-size element pinned to world (0,0) with a 17 px crosshair
  drawn by a child that is counter-scaled by `1 / zoom`, so the crosshair keeps a
  constant size on screen while its bounding box centre remains exactly the world
  origin — a stable, exact pixel target for the e2e tests (the design asks for a
  marker in all builds).

## Input handling

- **Wheel listener is attached natively with `{ passive: false }`** (React's `onWheel`
  is registered passive, so `preventDefault()` there is ignored and the page would
  scroll or zoom). It converts `deltaMode` lines/pages into CSS pixels with
  `WHEEL_LINE_DELTA_PX` / `WHEEL_PAGE_DELTA_PX`, pans for a plain scroll and zooms at
  the pointer for Ctrl/Cmd + scroll using `exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
- **Safari pinch** uses `gesturestart` / `gesturechange` / `gestureend`; the starting
  scale is remembered so each event applies the ratio since the previous event.
  Playwright cannot synthesise a `GestureEvent`, so the handler is covered by the
  component test TC-17 (the design says the same).
- **Keyboard** shortcuts listen on `window` for Ctrl/Cmd with `=`, `+`, `-`, `_` and
  `0`, and are ignored while focus is in a text field, `select`, `textarea` or a
  `contenteditable`. `preventDefault()` runs on every match so the browser's own
  page zoom never fires (TC-31 checks `visualViewport.scale` and `devicePixelRatio`).
- **Drag only starts on empty board space**: `pointerdown` is accepted when its target
  is the viewport itself, so later stories can put objects in the world layer and stop
  propagation. Pointer capture is best effort — engines refuse unknown pointer ids, and
  the drag must still end cleanly, so capture calls are wrapped and `lostpointercapture`
  also ends the drag.
- **The controls are not the board**: `ZoomControls` stops `wheel` and `pointerdown`
  propagation, so a Ctrl+wheel over the panel is left to the browser and never zooms
  the board (TC-30).

## State, hint and the test hook

- `hasNavigated` latches on the first *user* camera change and is never cleared;
  the system changes (first sizing of the window, the test hook) do not dismiss the
  hint. The camera and the hint are per-visit in-memory state, so a reload returns to
  the reset view and shows the hint again — which is what PRD `nav.hint` asks for
  ("... until the page is reloaded").
- **`window.__vidi6`** (`setCamera` / `getCamera`) is installed only when
  `import.meta.env.MODE === 'test'`; `setCamera` ignores non-finite or non-positive
  input. Verified by building both modes: the production bundle contains no `__vidi6`
  string, the test bundle does. Vite dead-code-eliminates the whole block in production.
- The viewport carries `data-camera-x/-y/-zoom`, `data-grid-spacing` and `data-mode`
  attributes. They are a cheap inspection surface: the tests measure the camera the
  same way the renderer sees it instead of duplicating the maths in the test.
- Accessibility: the buttons are real `button`s with the exact accessible names
  "Zoom out", "Zoom in", "Reset view", disabled at the limits (so a click there is a
  no-op, TC-32), and the zoom label is an `aria-live="polite"` output.

## Browsers I could not run here

`playwright.config.ts` declares **chromium, firefox and webkit** projects as the design
requires, but on this host only Chromium can actually launch: the Firefox and WebKit
binaries are installed, their **system libraries are not** (`libgtk-3.so.0`,
`libepoxy.so.0`, `libjpeg.so.8`, `libwebp.so.7`, `libharfbuzz-icu.so.0`, `libGLESv2.so.2`),
and installing them needs root, which this account does not have (`sudo` is blocked by
a no-new-privileges flag). Rather than fail the suite, the config probes the dynamic
linker's cache and skips an engine with a printed reason:

```
[e2e] skipping "firefox": the host is missing libgtk-3.so.0
[e2e] skipping "webkit": the host is missing libgtk-3.so.0, libepoxy.so.0, ...
```

`E2E_BROWSERS=chromium,firefox,webkit` overrides the selection. The specs use nothing
engine-specific (no Chromium-only APIs), so they should pass in Firefox and WebKit on a
machine that can start those browsers — that has not been verified here.

## Story 2: board model

- **Test-first order**: tasks 1 and 3 (the unit tests) were written and seen red/green
  before the code they test; task 2's model came after task 1's tests, task 4's
  `StickyText` after task 3's tests. The component tests (task 7) were written after
  the components of tasks 5–6, which is the one place where the task list's order was
  not followed step by step — every behaviour listed there is nevertheless covered.
- **`createSticky(doc, at)` takes the centre** of the new note (double-click point or
  view centre) and stores the top-left, `at − STICKY_SIZE_WORLD / 2`, because
  `StickyNote` renders at `(x, y)`. `moveObject` also takes the top-left.
- **Non-finite coordinates are rejected**: `moveObject` returns `false` and writes
  nothing; `createSticky` cannot fail partially, so it returns the empty string (and
  `App` then does not select or edit anything). TC-39.
- **`bringToFront` on the note that is already topmost returns `false` and emits no
  update.** The design's drag test asks for exactly one update when a note below is
  dragged, and the `z = maxZ + 1` rule is still what the function does; a note that is
  already on top does not need a new slot.
- **`snapshot` returns a frozen array sorted by `(z, id)`**, so the id breaks a tie
  between equal `z` values and React's `key` order is stable. Text is copied into the
  snapshot, which is what lets the fit logic re-run on a text change.
- **`useBoardDoc` publishes `[doc, notes]`** as one memoised tuple: `useSyncExternalStore`
  compares `getSnapshot()` by identity, and a component always needs the doc as well as
  the notes, so both live in the same store. `observeDeep` fires *after* the transaction
  has been applied, so reading the map inside the listener is safe.
- `LOCAL_ORIGIN` is exported from `board-model` (the design places the origin constant
  there) and used by the editor.

## Story 2: notes, selection and creation

- **Selection and editing live in `useSelection`** in `App`, never in the document, and
  at most one note is ever selected or edited. Ending an edit takes `"selected"` or
  `"unselected"` so the component that ends it (Escape versus a click outside) decides
  what is left selected.
- **`App` also clears the selection when the selected note disappears** from the
  snapshot. Deleting a note from another tab would otherwise leave the outline,
  the toolbar and the keyboard pointing at a note that is gone.
- **`BoardViewport` stays object-agnostic**: it gained `onEmptyDoubleClick(point)` and
  `onEmptyClick()` instead of importing sticky-note behaviour. Both fire only when the
  event's target is the viewport itself, so an object that stops propagation is enough
  to keep the gesture.
- **A press on empty space shorter than `DRAG_THRESHOLD_PX` no longer moves the
  camera** (it used to pan by the full jitter). That is what makes "click empty space to
  deselect" leave the camera exactly where it was, and the notes use the same
  threshold, so one number decides when a press became a drag. Story 1's tests still
  pass with it.
- **The note's toolbar clears the selection through `onEndEdit('unselected')`** after it
  deletes the note, instead of adding a prop to the design's `StickyNote` signature.
- **Tab reachability**: a note is `tabIndex={0}` and focusing it selects it, so Tab +
  Enter edits a note without any pointer. `Enter`, `Delete` and `Backspace` are handled
  once, on `window` in `App`, so a clicked note and a tabbed-to note behave identically.
- **Long-press selects**: `contextmenu` on a note is prevented and selects it. A touch
  long-press produces it in Chromium, and there is nothing else to do on a board with
  no clipboard.
- **Drag maths**: the delta is measured in client pixels and divided by the zoom, from
  the note's position at pointer-down (not from its previous written position), so a
  drag cannot accumulate rounding error, and `pointerup` writes the final position once
  more so the note lands exactly under the pointer. `bringToFront` runs once, on the
  transition into Dragging.

## Story 2: text editing

- The editor is an **uncontrolled textarea**: React re-renders would reset the value in
  the middle of an IME composition. `onChange` (and `compositionend`) push the DOM value
  through `clampToLimit` and `applyTextDiff`; when characters are dropped the caret is
  restored to the end of what is really in the note.
- **Fit is measured with `scrollHeight` against `clientHeight`** of the text element, so
  CSS owns the box (12 world-unit padding, `overflow: hidden`, `white-space: pre-wrap`)
  and JS only owns the font size. The size is world units, so the note's text scales
  with the board — which is why zoom is deliberately not an input to the fit.
- **The bottom fade** is a `sticky-note__fade` element rendered by whoever measured the
  overflow: the note in display mode, the editor while typing (where `overflow` is true
  only at the 10 px floor).
- **A pointerdown outside the note** ends editing through a document-level capture
  listener in the editor (it compares the closest `[data-sticky-note]` ancestor), because
  clicking another note or a toolbar has to end editing too and the note itself keeps the
  click.
- jsdom specifics for the component tests: there is no layout (everything measures 0),
  no pointer capture (the harness routes moves to the element that received the press,
  like capture does) and React's value tracker swallows `element.value = …`, so the
  harness writes through the prototype setter before firing `input`.
- **`App` takes an optional `doc` prop** so a component test can inspect the very
  document the board is editing.

## Out of scope

Stories 6 and 13–17 (presence, offline device copies, sign-in, dashboard, comments,
export) are not implemented and nothing was added for them.

## Story 2 decisions

- **`Enter` inside the editor writes a newline; `Escape` or a click outside ends editing**
  (prd.md:48, design.md:424, tasks.md:86). The same key on a *selected note that is not
  being edited* starts editing (prd.md:90). Because both readings of "Enter" are live on the
  window, the window handler stands down whenever the focused element takes its own keys —
  a text field, or a button or link. Without that, pressing Enter on the delete bin pressed
  the bin *and* asked the board to start editing the note behind it.
- **`createSticky(doc, at)` takes the *centre*.** The stored position is the top-left, as
  `BoardObject` and the renderer need it, so the note is placed at `at - STICKY_SIZE_WORLD/2`
  and the click point ends up in the middle of the note. The double-click handler passes the
  raw world point without knowing the size.
- **The press is followed on `window`, not on the note.** Bringing a note to the front moves
  its DOM node to the end of the world layer, and the browser drops pointer capture when a
  node is re-inserted — the drag died on the first move. Listening above the tree survives
  the raise, and also survives the pointer leaving the note.
- **The note does not clip; its text does.** `overflow: hidden` on `.sticky-note` also cut
  off the toolbar, which floats above the note and is a child of it (the design puts the
  toolbar inside the note, and counter-scales it by `1/zoom`). `.sticky-note__text` and the
  textarea clip the text, which is the only thing that can overflow the note box.
- **`useSelection` holds selection and editing**, as React state, never in the shared
  document: they are per-user. `endEdit(next)` takes what the selection should be
  afterwards — `'selected'` for Escape/Enter, `'unselected'` for a click outside and for the
  delete bin — because the editor cannot know who is asking.
- **`Enter`/`Delete` are handled once on `window`** (in `App`) rather than per note: a note
  focused with Tab and a note clicked with the mouse then run exactly the same code, and the
  handler steps aside whenever the keystroke belongs to a text field.
- **Fit is measured with `scrollHeight > clientHeight`** on the element that holds the text,
  at the padding the CSS gives it (12 world units), stepping down through
  `STICKY_FONT_SIZES`. The CSS owns the geometry, the JS only picks the font size, so a
  change to the padding cannot silently change what fits. The text is never truncated in the
  document: only what is *shown* is clipped, and the fade marks it.
- **The counter is scaled back by `1/zoom` inside the world layer**, so it stays readable at
  any zoom without a second DOM. Same for the toolbar.
- **Notes expose `data-note-x/-y/-z`, `data-color`, `data-text-length`, `data-selected`** for
  the browser tests, in the same spirit as the camera attributes from story 1: the tests
  compare what the document says with what the browser painted, instead of trusting either
  one alone.
- **The `App` accepts an optional `doc`**, so a component test can inspect the real document
  while driving the real component tree; the production entry point passes nothing and gets
  its own document.

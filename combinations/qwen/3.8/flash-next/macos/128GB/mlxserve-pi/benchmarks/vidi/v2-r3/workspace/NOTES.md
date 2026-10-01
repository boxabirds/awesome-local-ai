# Story 1 — Pan and zoom around an infinite board: implementation notes

## Camera model

- `Camera = { x, y, zoom }` where `(x, y)` is the **world coordinate at the
  viewport's top-left corner**. `worldToScreen(p, c) = (p - c) * zoom`,
  `screenToWorld(s, c) = s / zoom + c`. All camera math lives in
  `src/client/canvas/camera.ts` as pure functions (no DOM, unit-tested).
- Zoom is clamped to `[ZOOM_MIN=0.1, ZOOM_MAX=4]`. After every zoom the value
  snaps to the nearest power of `ZOOM_STEP_FACTOR=1.25` when within 2 % — so
  the 100 % → 125 % → 156 % … button ladder lands exactly on powers and the
  button sequence terminates at 400 % / 10 % (this is what makes
  `+`/`−` disable deterministically at the bounds).
- Wheel zoom uses `factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY *
  pixelsPerLine)` with `deltaMode` conversion (lines/pages → px). Trackpad
  pinch on browsers that send `ctrlKey` wheel events falls out of the same
  formula; Safari's `gesturestart/change/end` events are handled separately
  (each `gesturechange` zooms by the scale *ratio* around the pointer) and
  `preventDefault`-ed so the page zoom never changes (TC-24/TC-31).
- Camera mutations are coalesced: a mutable `cameraRef` is updated per event
  and one `requestAnimationFrame` per frame flushes a `setState`. A drag of
  N pointermove events renders once — and because the ref is updated
  immediately, consecutive drags never lose deltas (exactness of TC-23).

## Initial centring and resize

The camera starts at `{0, 0, 1}` and, as soon as the real viewport size is
known (first non-zero `ResizeObserver` report), becomes
`{x: -w/2, y: -h/2, zoom: 1}` — the board's start point sits at the screen
centre. Later resizes deliberately do **not** move content (design decision);
the once-guard also checks `cameraRef.current === INITIAL_CAMERA`, so a
camera set explicitly (e.g. via the e2e test hook) is never clobbered by a
late-flushing centering effect.

## Rendering

- One world layer with `transform: scale(zoom) translate(-x, -y)` and
  `transform-origin: 0 0` — pan and zoom cost nothing and work uniformly at
  1,000,000 units.
- The dot grid is a `radial-gradient` background on the surface:
  `background-size = GRID_SPACING_WORLD * zoom` and
  `background-position = mod(-x*zoom, spacing)` — the modulo keeps every CSS
  number small at any world distance (TC-27).
- The origin crosshair is a world-space marker with
  `transform: scale(1/zoom)` so it keeps constant screen size at any zoom.
  A second marker at world `(1e6, 1e6)` is rendered **only in test builds**
  (`import.meta.env.MODE === 'test'`).

## Test hook

`installTestHooks` (`src/client/canvas/testHooks.ts`) exposes
`window.__vidi6.getCamera/setCamera` for e2e camera teleporting (TC-26/27).
It is imported by `App.tsx` only under `import.meta.env.MODE === 'test'`,
and is verified absent from the production bundle (`grep __vidi6` on
`npm run build` output). `npm run build:test` = `vite build --mode test`;
Playwright's `webServer` runs it behind `wrangler dev` (same asset-serving
path as production Cloudflare Pages).

## Component props superset (deviation from design.md)

Design sketches `BoardViewport` with a `children`-only contract. The
implementation takes `camera` plus interaction callbacks
(`onBeginPan/onPanMove/onEndPan/onWheel/onZoomAtPoint/onZoomStep/onReset/
onViewportSize`) instead of owning the camera itself. This keeps the
component a pure renderer, lets `ZoomControls` and the hint share one camera
state (`useCamera`), and makes both testable. `useCamera` additionally
exposes `zoomAtPoint(point, factor)` for Safari gesture events.

## Test-environment findings (worth knowing)

- **WebKit stale renders:** pointer events are processed synchronously into
  the camera ref, but the DOM render lands a frame later, and WebKit's CDP
  reads can lag input handling. Geometry assertions must first wait for the
  world-layer transform to match `__vidi6.getCamera()` (`settle()` in
  `tests/e2e/helpers/board.ts`) and then poll (`expect.poll`), otherwise a
  ctrl+wheel zoom measured from a stale frame looks 120·zoom px off. With
  that, e2e passes on both Chromium and WebKit.
- **Firefox cannot launch at all in this sandboxed macOS box** (even outside
  Playwright). The `firefox` project exists in `playwright.config.ts` for
  real CI, but `npm run test:e2e` runs `--project=chromium --project=webkit`
  so the suite is green where firefox won't start.
- **Disabled-button click race:** clicking `−` until disabled must not loop
  on `isEnabled()` (the button can become disabled between check and click
  and the click waits forever); the test clicks with a short timeout and
  breaks on the first timeout.

## Grid/keyboard behaviour summary

`Ctrl/Cmd + =/+/−` zoom one step (1.25× / ÷1.25, clamped+snapped),
`Ctrl/Cmd + 0` resets the view; all `preventDefault`-ed so the browser's own
page-zoom shortcuts stay out of the way. Wheel events over the board are
handled with `passive: false` and always `preventDefault`-ed (page never
scrolls/zooms over the board). Non-primary buttons don't start a pan;
`setPointerCapture` failures (WebKit+CDP) degrade gracefully.

## Verification

- `npm run test:unit` — 18 camera tests (TC-01…TC-12 + property check)
- `npm run test:component` — 16 tests (TC-13…TC-22, TC-29, TC-30, …)
- `npm run test:e2e` — 8 tests = TC-23…TC-28, TC-31 × (chromium, webkit)
- `npm run typecheck`, `npm run build`, `npm run build:test` all pass.

---

# Story 2 — Capture ideas on sticky notes and rearrange them: implementation notes

## Document model (`src/shared/board-model.ts`, Yjs)

- One `Y.Doc` per board session. Objects live in `ymap` (`Y.Map<Y.Map<any>>`),
  the creation order counter in `meta.nextZ`, the local cursor in `cursor`
  (a `Y.Map` with `lastActive` in the model but never written by this story).
- `stickyNote.text` is a `Y.Text` so characters merge per-operation; everything
  else is a plain key on the object's inner `Y.Map`. Position is `x`/`y`
  (**top-left corner**, board units), stacking is the integer `z`.
- Every read (`snapshot`, `noteText`, `getMaxZ`) and every write goes through
  `transact`/`withOrigin`, which sets a module-level `activeOrigin` so nested
  calls reuse the transaction instead of trying to open a second one (Yjs throws
  on `transact(doc, …)` from inside a transaction). Origin rules: local
  `create/move/setColor/delete` and remote presence use the caller's origin,
  text edits always use `LOCAL_TEXT_ORIGIN = 'sticky-text'`, and a nested call
  whose transaction is already open inherits it. That is how a collaborator's
  `Y.transact(doc, 'remote', …)` still gets `remote` for the whole update.
- Writes are minimal: `moveObject` skips the write when `x`/`y` are unchanged
  and `setNoteColor` when the colour already matches, so a drag that jitters
  back to its start emits nothing. `applyTextDiff` keeps the common prefix and
  removes the rest before inserting the common suffix, so typing one character
  emits one `retain`+`insert`, never a rewrite.
- `snapshot` returns notes sorted by `(z, id)`. **The board deliberately does not
  render in that order** (see pointer capture below).

## Text fitting (`src/client/objects/StickyText.ts`)

`fitFontSize(text, boxWidthPx, boxHeightPx)` binary-searches 1 px steps between
`STICKY_FONT_MIN_PX` (10) and `STICKY_FONT_MAX_PX` (24) using a cached canvas
2D context with the note's font stack, so it works with no layout at all: line
widths are measured with `measureText`, and the height budget is
`lines * 1.35 * size`. It returns `{fontPx, overflow}`, where `overflow` is "no
size fits", which is what drives the fade. `clampToLimit` slices by grapheme
(`Intl.Segmenter` when present) so a pasted emoji is never cut in half.

## Dragging a note and pointer capture (the one real trap)

Bringing a dragged note to the front changes its `z`, which changes the order of
the keyed children, which makes React **move the note's DOM node** out of and
back into the document — and moving the capturing element out of the document
fires `lostpointercapture` and ends the drag after the first pointermove. In
Chromium this silently froze the note 5 board units behind the pointer.

Fix: the board renders notes in a **stable order (by id)** and paints stacking
with `zIndex: note.z` on the note element instead of relying on DOM order
(unique `z` per creation, `bringToFront` = `maxZ + 1`, so painting is identical).
`snapshot`'s `(z, id)` order is kept for tests and for any future renderer.
`bringToFront` is called once, at the moment the drag crosses
`DRAG_THRESHOLD_PX` — not on every move.

Pointer capture is best-effort (`try/catch`): without it the note still follows
the pointer, because the note's own `pointermove` keeps firing while the pointer
is over it. The board surface ignores pointermove unless *it* captured the
pointer, so a note drag can never turn into a pan even after capture is lost.

## Text editing

- The textarea is **uncontrolled**, seeded with the note's text, because
  re-rendering a controlled textarea mid-IME-composition is the classic way to
  duplicate characters (TC-24). Every `beforeinput`/`input` (composing or not)
  flushes the whole value through `applyTextDiff`, which only emits the
  difference and clamps to 1,000 characters — so the 300 ms IME test in e2e
  types 5 CJK syllables and lands exactly `你好世界吗`.
- `Escape` while `e.isComposing` (or between `compositionstart` and
  `compositionend`) is ignored: WebKit/Chromium send Escape to cancel the
  composition, and that must not end editing (TC-38).
- `onDoubleClick` on a note bubbles to the board surface but is ignored there,
  because the surface handler requires `event.target === event.currentTarget`.
  The same guard covers `pointerdown`, so a note press never reaches the pan
  logic; the note calls `stopPropagation` anyway.
- While editing, the display text is `visibility: hidden` (not `display: none`)
  so `fitFontSize` can keep measuring it and the text shrinks as you type.

## Constant screen size for the note toolbar

`StickyNote` publishes `--note-inv-zoom: 1 / zoom` on the note element and
`.note-toolbar` uses `transform: scale(var(--note-inv-zoom, 1))` with
`transform-origin: bottom left`. `useBoardDoc` re-renders on camera changes
(camera `onChange → sync`), so the inverse stays current at any zoom; TC-34
measures a swatch's bounding box at 100 % and 200 % and gets the same size.

## Test seams and helpers

- `App` takes an optional `onDocReady(doc)` (used only by component tests).
- `tests/e2e/helpers/stickies.ts` keeps every geometry assertion in board/screen
  space: `expectMovedBy` (screen delta equals pointer delta, i.e. the grabbed
  point stays under the pointer), `expectWorldAt`, `noteFontPx`,
  `noteHasFade` (getComputedStyle mask-image), `textBoxInside`
  (bounding box inside the note + scrollHeight > clientHeight for the clipped
  case), `topNoteIdAt` (`document.elementFromPoint`) and `cameraOf`.
- `createNoteAt` returns the *new* note's id (ids before/after), so it works
  with notes already on the board.
- Component tests drive the drag with real `PointerEvent`s (jsdom has no
  `setPointerCapture`, so the code path under test is the fallback branch) and
  flush `requestAnimationFrame` explicitly.

## Verification (story 2)

- `npm run test:unit` — 53 tests (TC-01…TC-12, TC-39, TC-13…TC-17)
- `npm run test:component` — 53 tests (adds TC-18…TC-29, TC-35…TC-38)
- `npm run test:e2e` — 15 tests × (chromium, webkit) = TC-30…TC-34 plus
  recolour/bin-delete/toolbar-size/multi-line/paste-limit workflows
- `npm run typecheck`, `npm run build`, `npm run build:test` all pass; the
  `__vidi6` hook is still absent from the production bundle.

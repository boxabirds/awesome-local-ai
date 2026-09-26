# Story 1 notes — pan and zoom around an infinite board

Implementation of `spec/stories/001-pan-and-zoom-around-an-infinite-board`.

## How to run

```bash
npm run dev                      # Vite dev server
npm run build                    # production client bundle -> dist/client
npm run build:test               # test-mode bundle (adds window.__vidi6)
npm run typecheck
npm run test:unit                # camera maths + camera store (vitest, node)
npm run test:component           # React components (vitest, jsdom + user-event)
npm run test:e2e                 # Playwright; Playwright starts wrangler itself
npm run preview                  # wrangler dev on the current dist/client
```

`npm run test:e2e` builds the client in test mode, serves `dist/client` with
`wrangler dev` on `127.0.0.1:8787`, and runs the Chromium project. Playwright
stops the server when the run finishes.

## Camera model (read this before story 2)

`src/client/canvas/camera.ts` is the whole camera: `{ x, y, zoom }`.

* `x`, `y` are **the world coordinates that sit at the viewport's top-left
  corner**. The board start (world origin) is `(0, 0)`.
* Conversions, exact inverses:
  * `screen = (world - camera.xy) * zoom`
  * `world = camera.xy + screen / zoom`
* Example, viewport 1280x800, camera `{ x: 100, y: -50, zoom: 2 }`:
  world `(140, 30)` appears at screen `(80, 160)`; screen `(640, 400)`
  (viewport centre) is world `(420, 150)`.
* On load the camera is `{ x: 0, y: 0, zoom: 1 }`, i.e. the world origin sits at
  the top-left of the viewport. `Reset view` centres the origin instead:
  `{ x: -width/2, y: -height/2, zoom: 1 }`.
* Every camera-returning function is pure and returns the *same object* when it
  would not change anything. The store uses that identity to skip notifies, and
  it keeps the exact camera object so repeated zoom steps never drift.

The world layer is `<div data-testid="world-layer" style="transform:
scale(zoom) translate(-x, -y)">` with `transform-origin: 0 0`. It has **zero
size at the world origin** (`.board-world` is `width: 0; height: 0`), so it can
never cover the viewport and steal a pan. Story 2 appends content positioned by
world coordinates into it (`style.left/top = world`, `width/height` in world
units, overflowing the zero-size layer) and it appears at the right screen
position with no extra transform work. The viewport ignores a pointerdown whose
target is such a child, which is how board objects keep their own dragging.

## Input decisions

* **Pan**: pointerdown on the viewport (left button only) captures the pointer,
  each pointermove applies `-delta / zoom`, pointerup/pointercancel/
  lostpointercapture release. A pointerdown whose target is neither the viewport
  nor the world layer is ignored — that is the "empty space" rule that lets
  story 2/10 elements receive their own events.
* **Zoom**: wheel with Ctrl/Meta, Safari `gesturestart/change/end` (preventDefault
  so Safari does not page-zoom), the zoom buttons, and Ctrl/Cmd `+`/`-`/`0`
  (handled with `e.code`, `Digit`/`Numpad`, plus `shiftKey` for `=`).
* **Trackpad vs mouse wheel**: Chromium reports a two-finger scroll as
  `wheel` with `ctrlKey === false`; a pinch arrives as `wheel` with `ctrlKey ===
  true` (Safari: `gesture*` events). Anything without the modifier pans, so a
  mouse wheel scrolls the board.
* **Wheel distance**: `deltaMode === 1` (lines) -> 16px per line,
  `deltaMode === 2` (pages) -> one viewport, using the measured element size.
  `panBy(cam, dx, dy)` moves the camera by `-d/zoom`, i.e. it takes a **pointer
  movement** and the content follows it. So the drag path calls
  `panBy(dx, dy)` with the pointer delta, and the wheel path calls
  `panBy(-deltaX, -deltaY)` because a wheel delta is a scroll of the content, in
  the opposite direction (native scrolling behaviour).
* All listeners are registered in a `useEffect` on the viewport node: React
  attaches `wheel` passively, and zooming needs `preventDefault()`.
* CSS: `touch-action: none` on the viewport, `overscroll-behavior: none` and
  `overflow: hidden` on `html, body`, `user-select: none` on the viewport, so no
  gesture reaches page scroll or browser zoom (TC-31, PRD nav.nopagezoom).

## Grid

The dot grid is one CSS `background-image: radial-gradient(...)` on the viewport
element: `background-size: GRID_SPACING_WORLD * zoom`, and
`background-position: mod(-camera.x * zoom, spacing) mod(-camera.y * zoom, spacing)`.
`mod` keeps the offset in one tile (the background repeats), which avoids
multi-million pixel `background-position` values while panning far away and keeps
the dots perfectly regular at 1,000,000 units (TC-27). Because the offset comes
from the same camera the content uses, the grid can never desynchronise.

## State and rendering

The camera lives in `CameraStore` (`src/client/canvas/useCamera.ts`): a plain
external store (useSyncExternalStore) with React context, batching every update
into one `requestAnimationFrame` flush — the store notifies at most once per
frame (PRD perf.framerate, asserted in `tests/unit/cameraStore.test.ts`).
`hasNavigated` latches on the first snapshot whose camera object actually
changed, so a click without movement, or a zoom at a clamp limit, does not
dismiss the hint (TC-22, TC-29). `panning` is published so the cursor can show
`grab`/`grabbing` without local component state.

## Test-mode camera hook

`src/client/canvas/testHooks.ts` installs `window.__vidi6.setCamera(camera)` and
`getCamera()` **only when `import.meta.env.MODE === 'test'`**. Verified:
`npm run build` -> 0 occurrences of `__vidi6` in `dist/client`, `npm run build:test` ->
1 occurrence. e2e tests use `setCamera` for far-away start states (TC-26, TC-27);
production builds do not contain the hook (TC-02, design testing.md).

## Test coverage

| Tests | Where |
| --- | --- |
| TC-01..TC-12, TC-04b, TC-08b..d, TC-10b, TC-12b | `tests/unit/camera.test.ts` |
| TC-29 (no-op gestures do not latch), frame coalescing, dispose | `tests/unit/cameraStore.test.ts` |
| TC-13..TC-18, TC-29, TC-30, TC-19..TC-22, TC-32 | `tests/component/*.test.tsx` |
| TC-23..TC-28, TC-31 | `tests/e2e/navigation.spec.ts` |

`tests/e2e/helpers/board.ts` is the shared harness (`openBoard`, `dragBoard`,
`ctrlWheel`, `setCamera`, `markerCentre`, `expectMarkerAt`, `expectGrid`,
`metrics`). `tests/component/helpers.tsx` is its jsdom equivalent, including a
`ResizeObserver` stub (`tests/component/setup.ts`) that reports 1200x800 and can
be resized to exercise TC-07 in jsdom.

## Deviations from the spec files

1. **`wrangler.jsonc` has no `"binding": "ASSETS"`.** Wrangler 4.141 refuses to
   serve an assets-only Worker that declares an asset binding ("Cannot use assets
   with a binding in an assets-only Worker"). The binding comes back with
   story 3, together with `main`.
2. **Device projects are filtered to installed browsers.** The design's matrix is
   chromium/firefox/webkit at 1280x800; `playwright.config.ts` declares exactly
   those three, but skips a project whose browser is not installed. This
   environment has Chromium only (the brief also limits e2e to Chromium), so
   `npm run test:e2e` runs 10 Chromium tests and logs
   `skipping firefox, webkit (browser not installed)`. Install the rest with
   `npx playwright install --with-deps firefox webkit`; no config change needed.
3. **`src/worker/` is not created** — story 3 adds the collaborative Worker
   (`package.json` `deploy` still runs `wrangler deploy`).
4. **The percentage label is an `<output aria-live="polite">`** so screen readers
   announce zoom changes; its accessible text is the percentage, e.g. `125%`
   (`data-testid="zoom-percent"` for tests).
5. **Wheel panning is deliberately not clamped to whole tiles**, and `panBy` only
   clamps to `CAMERA_COORD_LIMIT` (PRD zoom.limits edge case: clamping is
   allowed).

## Not covered (as specified)

* TC-33: focus in the browser address bar — the page cannot receive those
  events, so there is no in-page test (design test table).
* Frame-rate smoothness: manual check only.
* Trackpad hardware differences (inertia, per-OS delta scaling): only synthetic
  wheel events are tested.
* Safari pinch in e2e: Playwright WebKit cannot synthesise `GestureEvent`;
  TC-17 covers the handler logic and real pinch is a manual check. I could not
  run Safari here (only Chromium is installed), so the pinch path is covered by
  TC-17 plus the reading of `event.scale` in `BoardViewport`.
* Touch input: out of scope for this story.

Manual check list for a machine with all browsers (run `npm run preview`):
Chrome and Safari — drag to pan, two-finger scroll, pinch, Ctrl/Cmd `+`/`-`/`0`;
confirm the page zoom indicator never changes and nothing scrolls the window.

## Notes for later stories

* Story 2 renders into `[data-testid="world-layer"]` (world coordinates, no extra
  transform needed) and must keep pointer events off the layer itself so the
  board keeps panning; content elements receive their own events because the
  viewport ignores pointerdowns that target children.
* Story 3 can read `useCamera()` for viewport-aware placement and reuse
  `screenToWorld`/`worldToScreen` for cursor broadcast and snapping.
* `UNBOUNDED_PAN_TESTED_EXTENT` (1,000,000) is the tested distance for
  "infinite"-enough; `CAMERA_COORD_LIMIT` is 1e9.
* e2e runs `wrangler dev`; if a run is interrupted, an orphan `workerd` may keep
  port 8787 — kill it by pattern (`pkill -f 'wrangler de[v]'`).

---

# Story 2 notes — capture ideas on sticky notes and rearrange them

Implementation of `spec/stories/002-capture-ideas-on-sticky-notes-and-rearrange-them`.

## Architecture

```
src/shared/board-model.ts     — pure Y.Doc mutations, snapshot helpers
src/client/objects/StickyNote.tsx   — interaction component (select, drag, edit)
src/client/objects/StickyText.ts    — clampToLimit, applyTextDiff, counterVisible, fitFontSize
src/client/objects/StickyTextEditor.tsx — IME-aware textarea
src/client/objects/NoteToolbar.tsx  — swatches and delete button
src/client/board/useBoardDoc.tsx    — Y.Doc provider and React hooks
src/client/board/useSelection.ts    — local selection/editing state
src/client/App.tsx                  — BoardApp, BoardContent, NoteToolbarOverlay
```

## Key implementation decisions

### Drag state machine
The note uses a ref-based state machine (`Unselected | Pressed | Selected | Dragging | Editing`)
to manage interaction without spurious re-renders. Critical fix: the external `useEffect`
that syncs `selected`/`editing` props must NOT override `Dragging` or `Pressed` states —
this was a bug where `bringToFront` triggered a Y.Doc update → snapshot change → re-render
→ effect set state back to `Selected`, breaking all subsequent pointer moves.

### Synchronous drag (no rAF)
`moveObject` is called synchronously on each pointermove. The design mentions "rAF-batched"
but tests fire pointer events faster than rAF can flush; synchronous application is
correct and the Y.Doc's transaction batching already coalesces updates within a microtask.

### Absolute position drag with zoomRef
Drag uses `startWorld + (pointer - pressOrigin) / zoom` (absolute delta from origin)
rather than incremental position updates. This avoids floating-point accumulation errors.
The `zoomRef` pattern avoids stale `zoom` values inside `useCallback` closures.

### Empty-click detection (BoardViewport)
Replaced `panning` state check with `didPanRef` (a ref tracking whether any `pointermove`
event fired during a viewport pan attempt). This correctly distinguishes "click on empty
space" from "pan gesture that started at the same position" since the `panning` state was
always true by the time `pointerup` fired (set synchronously by `beginPan`).

### Note toolbar in screen space
The toolbar is rendered OUTSIDE the world layer as a `position: fixed` overlay, positioned
by converting the note's world coordinates to screen via `worldToScreen(camera, ...)`.
This prevents the toolbar from being clipped by the note's `overflow: hidden` and keeps
it at constant screen size regardless of zoom level (matching the design spec:
"rendered in screen space above the selected note, not scaled by zoom").

### Font fitting
`fitFontSize(el, box)` in `StickyText.ts` performs binary search over font sizes
(`STICKY_FONT_MIN_PX..STICKY_FONT_MAX_PX`) checking `el.scrollHeight <= box`.
The `StickyNote` component calls this via `useLayoutEffect` whenever text changes.
In jsdom, `scrollHeight` is always 0, so the function always returns max font size
(harmless for component tests). In the real browser (e2e), it correctly shrinks font.

### Text overflow fade
When `fitFontSize` returns `overflow: true` (text still doesn't fit at min font),
the text element gets class `overflow-fade` which applies a CSS mask-image gradient.

## Test coverage

| Tests | Where |
| --- | --- |
| TC-01..TC-12 (board model) | `tests/unit/board-model.test.ts` |
| TC-13..TC-17 (sticky text) | `tests/unit/sticky-text.test.ts` |
| TC-18..TC-29 (components) | `tests/component/StickyNote.test.tsx`, `StickyTextEditor.test.tsx`, `Toolbars.test.tsx` |
| TC-30..TC-34 + workflow (e2e) | `tests/e2e/sticky-notes.spec.ts` |

## Deviations from the spec

1. **Camera store: rAF-coalesced but synchronous object mutations.** Story 1 uses
   rAF for camera updates; Story 2's note moves apply synchronously. This is fine because
   the design's rAF mention for drags was an optimization suggestion, not a requirement.

2. **`isDragging` is a React state** (not purely a ref) to trigger re-render for
   the `data-dragging` attribute, allowing the App to hide the toolbar during drag.

3. **`estimateFontSize` fallback removed** — font fitting uses only real DOM measurement.
   The initial render uses CSS `font-size: 24px` (max), then `useLayoutEffect` corrects it
   synchronously before the browser paints.

4. **`NoteToolbar` is rendered by `BoardContent`** (not inside the note component) to avoid
   `overflow: hidden` clipping and to render in screen space per the design spec.

## Not covered

* Presence cursors (Story 6): selection/editing state is local only, per design.
* Undo/redo (Story 9): no undo manager attached.
* Shape/connection components: hooks exist in board-model for Stories 4/5.
* Frame-rate profiling under 100 notes: manual perf check only.

# Notes

## Story 1: Pan and zoom around an infinite board

### Decisions made

1. **jsdom PointerEvent polyfill**: jsdom does not implement `PointerEvent`, so we added a polyfill that extends `MouseEvent` in the test setup (`tests/component/setup.ts`).

2. **Native event handlers in tests**: Wheel and gesture events use `addEventListener` with `{ passive: false }` to call `preventDefault()`. In component tests, these are dispatched via `el.dispatchEvent()` wrapped in `act()` to ensure React state updates flush synchronously.

3. **Architecture**: The `useCamera` hook is lifted to the `Board` component in `App.tsx`, and `BoardViewport` receives `camera` and handler callbacks as props (slight deviation from the design's `BoardViewport({ children })` contract to enable testing). The `useCamera` hook manages camera state, `hasNavigated` latch, and all interaction handlers.

4. **Zoom step snapping**: `zoomStep` snaps the result to the nearest `ZOOM_STEP_FACTOR^n` when within `1e-9`, preventing float drift over many zoom in/out cycles.

5. **Playwright browsers**: Only Chromium is configured for e2e tests (design allows "Chromium is sufficient if other browsers are not installed"). Firefox and WebKit are not installed in the environment.

6. **E2e test build**: The `test:e2e` script runs `npm run build:test` (vite --mode test) before playwright, which exposes `window.__vidi6.setCamera` for tests that need to jump to distant positions.

7. **Origin marker**: Rendered as an SVG crosshair at world (0,0) inside the world layer, present in all builds. Gives e2e tests a stable pixel reference.

8. **Wrangler config**: Assets-only configuration (no `binding` field) to support `wrangler dev` for static file serving without a Worker script (Worker code arrives in story 3).

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions made

1. **Yjs from day one.** Notes live in a `Y.Doc` (`src/shared/board-model.ts`, framework-free so the story 4 Durable Object can import it). Schema: `meta: Y.Map {schemaVersion}`, `objects: Y.Map<id, Y.Map{type,x,y,color,z,createdAt,text: Y.Text}>`. Every successful mutation runs inside `doc.transact(fn, LOCAL_ORIGIN)`; rejections (stale id, unknown colour, non-finite coordinates, `bringToFront` on the top note) return `false` before a transaction opens, so an observer never sees a no-op update. Story 3 only has to attach a provider, story 4 only has to persist the same document.

2. **Snapshot reads are React-safe.** `useBoardDoc` observes `objects.observeDeep` and exposes an immutable snapshot through `useSyncExternalStore` with a cached snapshot compared field-by-field, so unrelated Yjs updates cannot cause an infinite render loop.

3. **Selection is local.** `useSelection` keeps `selectedId`/`editingId` outside the Y.Doc: another user's presence is a later story. `endEdit('unselected')` only clears the selection when it still points at the note that was edited, so clicking a second note while editing the first leaves the second note selected (blur arrives after the new `pointerdown`).

4. **Notes are stacked with CSS `z-index`, not DOM order.** The first implementation rendered notes in `(z, id)` order, but `bringToFront` then *moved the dragged element in the DOM*, which silently drops pointer capture mid-drag (found by the 200% zoom e2e test: the note stopped following the pointer). Notes now render in a stable order (by id) and the wrapper carries `zIndex: note.z`. Stacking semantics are unchanged; `snapshot()` still returns `(z, id)` order for anything that paints by array order.

5. **Drag is rAF-throttled and zoom-correct.** Pointer moves only record the latest point; one `requestAnimationFrame` per frame calls `moveObject` with the screen delta divided by the current camera zoom. `pointerup` applies the trailing point synchronously so the note ends exactly under the pointer. `bringToFront` is called once when the `DRAG_THRESHOLD_PX` is exceeded. Pointer down on a note calls `stopPropagation()` so the board never pans (asserted in e2e by watching `data-camera-x/y`).

6. **Text is written per keystroke with a minimal diff.** `applyTextDiff` computes the common prefix/suffix and issues one delete and/or one insert inside a single transaction (unit-tested by watching the `Y.Text` delta), so story 3's concurrent typing will not be clobbered. Surrogate pairs are never split, and input beyond `STICKY_TEXT_MAX_CHARS` is clamped with the caret restored — a 1,200 character paste yields exactly `1000/1000`.

7. **Auto-fit is measured, not estimated.** A hidden measuring element with the note's width/padding is binary-searched between `STICKY_FONT_MAX_PX` (24) and `STICKY_FONT_MIN_PX` (10) against `scrollHeight`; below the minimum the text layer keeps the last size, clips (`overflow: hidden`) and shows a bottom `.sticky-note-fade` gradient. Fit is recomputed on text change only, since zoom scales world units uniformly.

8. **IME safety.** `compositionstart`/`compositionend` gate the `input` handler; the commit happens on `compositionend` so composed words are inserted once.

9. **Deleting the note under an active interaction ends it silently.** While dragging or editing, if the note vanishes from the snapshot (or `moveObject` returns `false`), the interaction state is reset instead of throwing — the component tests cover both paths.

10. **Keyboard reachability.** Notes are `tabIndex=0` inside a `role="group"` with an accessible name; focusing selects, Enter edits (caret at end), Escape ends editing with the note still selected, Delete/Backspace deletes only when not editing. Toolbar buttons, swatches (`aria-label="<Colour> colour"` + `aria-pressed`) and the delete button all have names, so colour is not the only signal.

11. **Test hooks.** `window.__vidi6` (test build only) gained `getCamera` next to story 1's `setCamera`, used by the "pan far away" and zoomed-drag tests. Notes expose `data-note-id`, `data-x`, `data-y`, `data-z` so e2e can assert world positions and stacking.

12. **Test isolation gotcha.** Wrapping an async `act()` body in `expect(...).resolves.not.toThrow()` leaves React's act queue in a state where the *next* test's render is never flushed; capture errors inside the `act` body instead (see the "deleted while dragging" test).

13. **Scale check.** `tests/component/Scale.test.tsx` seeds 500 notes into a real `Y.Doc`, renders them and drags one — the whole file runs in well under a second in jsdom, which is the smoke test for the "500 notes stay responsive" constraint (not a hard gate in this story).

### Deviations from the design

- `StickyTextEditor` is rendered as an overlay `<textarea>` on top of the note's text layer instead of making the text layer `contenteditable`; this keeps the caret, IME and clipboard behaviour native while still writing through `applyTextDiff`.
- The note toolbar is positioned in world space and counter-scaled (`scale(1/zoom)`), which keeps it a constant pixel size above the note at any zoom without a portal or measuring pass.
- e2e runs in Chromium only (unchanged from story 1: Firefox/WebKit binaries are present but cannot launch in this environment).

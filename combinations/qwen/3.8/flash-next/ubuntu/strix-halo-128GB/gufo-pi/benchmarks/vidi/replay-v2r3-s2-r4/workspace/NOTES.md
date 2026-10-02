# Implementation Notes

## Story 1: Pan and zoom around an infinite board

### Decisions made

1. **Wrangler config**: Used assets-only mode (no `main` Worker script, no binding) since the design specifies Worker code arrives in story 3. The `wrangler dev` command serves static assets from `dist/client`.

2. **Vitest workspace**: Used `vitest.workspace.ts` with `extends` to configure unit (node) and component (jsdom) projects, since Vitest 2.x requires this file-based workspace config (not `test.projects`).

3. **PointerEvent polyfill**: jsdom (v25) does not implement `PointerEvent`, so a polyfill extending `MouseEvent` was added to the component test setup. This is necessary because the BoardViewport uses pointer events for drag-to-pan.

4. **rAF batching**: The `useCamera` hook coalesces camera updates via `requestAnimationFrame` (at most one re-render per frame). Tests use `vi.useFakeTimers()` + `vi.advanceTimersByTime(16)` wrapped in `act()` to flush.

5. **Test hooks**: `window.__vidi6.setCamera()` is registered only when `import.meta.env.MODE === 'test'`, which is the default with `vite build --mode test`. The production build excludes this code path.

6. **Step zoom snapping**: `zoomStep` snaps the result to the nearest `ZOOM_STEP_FACTOR^n` within 1e-9 epsilon to prevent floating-point drift (e.g., 1.0 * 1.25 * 0.8 = 0.9999... instead of exactly 1.0).

7. **Wheel handler**: Attached via `addEventListener('wheel', handler, { passive: false })` in a `useEffect`, not via React's `onWheel` (which React attaches passively). This ensures `preventDefault()` works to suppress browser page scroll/zoom.

8. **E2E test build**: E2E tests build with `--mode test` to enable test hooks. The `npm run test:e2e` script uses `npm run build:test && vite preview` as the web server command.

9. **Grid rendering**: Dot grid is rendered via CSS `radial-gradient` with computed `background-size` and `background-position` derived from camera position and zoom modulo grid spacing. No canvas.

10. **World layer transform**: Uses `transform: scale(zoom) translate(-x, -y)` with `transform-origin: 0 0`. Origin marker is a crosshair at world (0,0) rendered in all builds for e2e assertions.

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions made

1. **Drag listens on `document`, not pointer capture**: bringing a note to the front
   changes its `z`, `snapshot()` returns notes sorted by `(z, id)` and React moves the
   note's DOM node. Moving a node drops implicit pointer capture (and
   `releasePointerCapture` throws `NotFoundError` for an id the node never explicitly
   captured), which ended every drag on the first frame. `StickyNote` therefore
   attaches `pointermove`/`pointerup`/`pointercancel` listeners to `document` for the
   duration of a drag and detaches them on release, cancel and unmount.

2. **Drag bookkeeping lives in refs**: `DragState` (phase, start screen point, origin
   position, pending position, rAF handle) is a single ref mutated in place, so a
   re-render caused by an observation can never reset the interaction state. A
   `latest` ref feeds the listeners the current `doc`, `zoom`, `onSelect` and note
   position.

3. **rAF-coalesced moves with a flush on release**: at most one `moveObject` per frame;
   the last pointer position is applied on `pointerup` so the note lands exactly under
   the pointer, and is dropped on `pointercancel` (`sticky.drag_cancel` keeps the last
   shown position).

4. **Auto-fit measurement**: the font size is fitted in a hidden element the exact
   width of the text box (`STICKY_SIZE_WORLD - 2 * 16`), in a `useLayoutEffect` keyed on
   the note's text. Font sizes are board units, so zoom scales text with the note and
   never re-triggers fitting. `fitFontSize(el, textBoxPx)` returns `{ fontPx, overflow }`
   and the note passes `fontPx` to the text, the editor and the measure element.

5. **Text is centred, top-aligned only when it overflows**: the PRD asks for centred
   text, so the text box flex-centres both ways; when the text no longer fits, the
   element switches to top alignment so the hidden part is the end of the text, which
   is what the bottom fade marks. The measure element uses the same layout so it wraps
   text identically.

6. **Fade colour**: the design's `color-mix(in srgb, var(--sticky-fade-from) 92%, white)`
   needs a per-colour CSS variable per note. The fade is a white gradient at 90%
   opacity instead, which reads correctly on all six light note colours and needs no
   extra variable.

7. **`Y.Text` diffs are minimal** (common prefix/suffix) so a two-character typo does
   not retransmit the whole note once story 3 adds sync, and a remote change that does
   not touch the caret range leaves the selection untouched (`Y.relativePosition` clamps
   on its own). The shared-type undo manager is deliberately not wired up: story 8 owns
   undo, and adding history here would change what `Ctrl+Z` does.

8. **Paste needs no special handler**: the textarea is committed on every `input`
   event and the commit clamps to `STICKY_TEXT_MAX_CHARS`, so pasting 1,200 characters
   keeps exactly the first 1,000 and the counter reads `1000/1000`. Cut and copy keep
   the browser default (plain text).

9. **Selection and editing ids live in `useSelection`**, outside the document, per the
   design ("interaction state must not be stored in the document"). `App` clears a stale
   selection when the note disappears from the snapshot, so a note deleted by anyone
   ends its interaction silently.

10. **Keyboard shortcuts are guarded, not scoped**: `Enter`/`Delete`/`Backspace` are on
    `window` but ignored while a note is being edited or when the event target is a text
    field, which keeps `Backspace` working as "delete character" in the textarea and
    keeps story 1's `Ctrl`+`+`/`-`/`0` shortcuts working everywhere.

11. **`BoardViewport` grew two optional callbacks** (`onEmptyClick`, `onEmptyDblClick`)
    that fire only when the press started on the viewport/grid and moved less than
    `DRAG_THRESHOLD_PX`, so panning never clears the selection and dragging a note never
    pans the board. Notes stop propagation on `pointerdown`.

12. **Test hooks**: `window.__vidi6` gained `getObjects()`, `getSelection()` and
    `deleteObject(id)` (used for "note deleted mid-drag", which no mouse gesture can
    express). They are registered when `MODE === 'test'` or in `vite dev`, still never in
    a production build. E2E must therefore run against a `vite build --mode test` bundle.

13. **Ports**: the Playwright server moved from 5173 to 28544 (`--inspector-port 28545`)
    to stay inside the port range allowed on this machine; viewport stays 1280x800
    because story 1's e2e assertions depend on it.

14. **jsdom limits worked around**: `fitFontSize` cannot measure in jsdom, so component
    tests assert the fitting contract (`data-overflow`, font size passed to the text and
    editor) and e2e asserts real sizes in Chromium. Typing is driven with
    `fireEvent.input(textarea, { target: { value } })` because jsdom does not implement
    textarea editing; `act` is imported from `@testing-library/react`.

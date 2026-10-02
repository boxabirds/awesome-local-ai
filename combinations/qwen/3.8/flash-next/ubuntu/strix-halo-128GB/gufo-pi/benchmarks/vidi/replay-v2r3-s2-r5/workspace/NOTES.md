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

1. **Ports**: every server listens inside `AGENT_PORT_FIRST..AGENT_PORT_LAST`. Story 1's
   Playwright config used 5173, which is outside that window, so `playwright.config.ts`
   now uses `E2E_PORT` (default 29328 = `AGENT_PORT_FIRST`) for `baseURL`, the
   `wrangler dev --port` command and the readiness probe.

2. **Firefox and WebKit cannot run here.** Their Playwright binaries are installed but the
   host is missing system libraries (`libgtk-3-0t64` for firefox; `libhyphen.so.0`,
   `libsecret-1.so.0`, `libGLESv2.so.2`, `libx264.so`, ... for webkit) and the sandbox has
   no root (`sudo` is blocked by a `no new privileges` flag), so `npx playwright
   install-deps` cannot be run. The e2e specs are browser-agnostic; the config builds its
   project list from `E2E_BROWSERS` (default `chromium`) so all three run as soon as the
   libraries exist: `E2E_BROWSERS=chromium,firefox,webkit npm run test:e2e`.

3. **Drag uses window listeners, not pointer capture.** The design's sequence diagram ends
   a drag on `pointerup` / `pointercancel` / `lostpointercapture`. A capture-based drag
   silently dies in Chrome here: `bringToFront()` at drag start re-orders the note's DOM
   node inside the world layer, and moving the captured node makes the browser release the
   capture after the first pointermove. `StickyNote` therefore tracks the pointer on
   `window` while pressed (`pointermove`, `pointerup`, `pointercancel`, plus `blur` for a
   release outside the window). Same state machine and same outcomes (release keeps the
   position, cancel/blur keeps the last shown position), but independent of DOM reordering.

4. **The note root does not clip.** The root carries position, `zIndex`, the blue selection
   outline and `data-*`; a child `sticky-note-surface` carries the colour fill, shadow and
   `overflow: hidden`. With `overflow: hidden` on the root the selection toolbar (which
   floats above the note) was invisible.

5. **Editing ends on a document-level capture-phase `pointerdown`**, not on `blur`:
   `BoardViewport` calls `preventDefault()` on pointerdown, which suppresses focus changes,
   so a textarea never receives `blur` when another part of the board is clicked. The
   listener checks `note.contains(event.target)` so clicks inside the note or its own
   toolbar keep the editor open.

6. **`App` takes an optional `store` prop** (`BoardStore` from `useBoardDoc`) so component
   tests can hold the `Y.Doc` while the shipped app still owns its own document
   (`main.tsx` renders `<App />` unchanged).

7. **`createSticky(doc, at)` takes the centre point** and subtracts
   `STICKY_SIZE_WORLD / 2` internally, so the double-click path and the toolbar path both
   get a note centred on the given world point without duplicating the offset.

8. **Keyboard delete/Enter live in two places.** The note element itself (`tabIndex=0`)
   handles Enter/Delete/Backspace when it has DOM focus and stops propagation; `App`'s
   window listener covers a selected note whose focus is elsewhere (for instance right
   after a swatch click). Both paths ignore the keys while `editingId` is set, so
   Backspace/Delete keep editing text instead of removing the note (TC-26).

9. **Drag geometry**: the screen delta is divided by `camera.zoom`, so the grabbed point
   stays under the pointer at 50/100/200% (TC-31, TC-32) and writes are coalesced to one
   `moveObject` per animation frame. `stopPropagation` on note pointerdown plus the
   viewport's grid-target-only guard means dragging a note never pans the board (TC-20,
   e2e "dragging a note never pans the board").

10. **Font fit is measured in world units** with a hidden node that mirrors the text
    layer's width, `white-space: pre-wrap` and `word-break`. Because zoom scales the whole
    world layer uniformly, the fit does not depend on zoom, so it is recomputed on text
    change and mount only. jsdom has no text layout, so fit and clipping are asserted in
    the browser (TC-33).

11. **Toolbar counter-scale**: the note toolbar is wrapped in an anchor with
    `transform: scale(1 / zoom)` and `transform-origin: bottom`, so swatches keep a
    constant on-screen size at any zoom (asserted in the e2e selection/toolbar test).

12. **IME-safe text writes**: `StickyTextEditor` skips `input` while
    `compositionStart..compositionEnd` and applies the diff on `compositionend`; every
    input is written to `Y.Text` immediately (common prefix/suffix diff, surrogate pairs
    kept whole), so ending editing (Escape, outside click, blur) performs no extra write.

### How to run

```
npm run build           # production build
npm run typecheck
npm run test:unit       # vitest project "unit" (node)
npm run test:component  # vitest project "component" (jsdom)
npm run test:e2e        # playwright, chromium (see note 2); its webServer runs
                        # `vite build --mode test && npx wrangler dev --port 29328`
```

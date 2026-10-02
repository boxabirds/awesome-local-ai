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

### Commands verified (2026-07-29)

| Command | Result |
| --- | --- |
| `npm run test:unit` | 63 passed (63) — `board-model` 22, `sticky-text` 23, story 1 `camera` 18 |
| `npm run test:component` | 47 passed (47) — `StickyNote` 17, `StickyTextEditor` 9, `Toolbars` 7, story 1 `BoardViewport` 8, `useCamera` 6 |
| `npm run test:e2e` | 11 passed (11) — story 1 `navigation` 7, story 2 `sticky-notes` 4 (chromium) |
| `npm run build` | builds, `dist/client/assets/index-*.js` ≈ 311 kB (97 kB gzip) |
| `npm run typecheck` | clean (`tsc --noEmit`, `strict` + `verbatimModuleSyntax`) |

`npx vite build --mode test` is required before `npx playwright test` when no server is
already listening; the Playwright `webServer` does exactly that and reuses a live server
(`reuseExistingServer: true`). `wrangler dev` prints an out-of-date warning and a
"Proxy environment variables detected" notice; both are harmless. Run it with `CI=1`
to suppress its analytics prompt.

### Decisions and deviations from the design

1. **Notes are stacked with CSS `z-index`, not DOM order.** The design said "render order
   sorts by (z, id)". Rendering in that order made a drag that raises itself re-insert the
   note's DOM node, and Chromium fires `lostpointercapture` when the captured element is
   moved — the drag died on the first move (caught by TC-32 e2e, invisible in jsdom).
   App now renders notes sorted by **id** and sets `zIndex: note.z` on each. Paint order is
   identical: equal z falls back to DOM order, which is id order — the same (z, id) rule.
   `readBoard()` still returns objects sorted by (z, id), so every model-level and
   collaboration-facing order is unchanged.

2. **Auto-fit measures in world units, not screen pixels.** The note and its hidden
   measuring probe both live inside the scaled world layer, so the CSS transform scales them
   identically: measuring `probe.scrollHeight` against `STICKY_SIZE_WORLD - 2 * STICKY_PADDING`
   is correct at every zoom level, and the chosen font size is a world-unit size that renders
   as `fontPx * zoom` screen pixels (24 px at 100 % zoom, as specified). Multiplying the box
   by zoom here would be wrong, because `clientHeight` is the *layout* height and ignores
   ancestor transforms. Consequence: no `ResizeObserver` and no re-measure on zoom, and the
   note never resizes the box it clips to. TC-33 asserts the font size is unchanged when the
   camera goes from 100 % to 200 %.

3. **`fitFontSize(el, box)` takes the probe element** (the design described a generic
   "measure(text, fontPx)"); it mutates `el.style.fontSize` and reads `scrollHeight`, which is
   the only measurement that respects the real font, wrapping and `word-break`. The pure parts
   (`clampToLimit`, `applyTextDiff`, `counterVisible`) stay DOM-free and unit-tested.

4. **`clampToLimit` returns `null` only for non-string input.** The editor clamps and writes
   the clamped value back into the textarea (caret to the end of the kept text), which is the
   "character budget is not exceeded" behaviour the design describes.

5. **Model no-ops return `false`, which is not "the object is gone".** `moveObject` and
   `setStickyColor` return `false` for a same-value call, so the drag loop must not treat
   `false` as deletion; it checks `getStickyText(doc, id) === undefined` instead. `createSticky`
   returns `''` (falsy) when it rejects a point or a colour.

6. **`BoardViewport` gained two viewport-level props** — `onEmptyClick(point)` and
   `onEmptyDblClick(worldPoint)` — plus `children` in the world layer (already present). Empty
   detection is "a press that began on the viewport or the grid layer and ended within
   `DRAG_THRESHOLD_PX`", evaluated on pointerup so a pan that starts on empty space never
   fires it. No object logic entered the viewport, per the design's boundary rule.

7. **Test hooks grew.** `src/client/canvas/testHooks.ts` now registers
   `getNotes(): StickySnapshot[]` and `getDoc(): Y.Doc` alongside story 1's camera hooks
   (still only under `import.meta.env.MODE === 'test'`). Component tests assert real model
   state through them instead of asserting on pixels.

8. **New files not listed in the design's key files**: `src/client/board/useSelection.ts`
   (one tiny hook, so `StickyNote` and `App` stay decoupled from selection state shape) and
   `tests/fixtures/texts.ts` (TC-13/TC-15 fixtures shared by unit, component and e2e suites —
   `LONG_TEXT_1000` is exactly 1,000 characters, `TEXT_1001` exactly 1,001).

9. **Focus handling.** A note has `tabIndex={0}`; focusing it (Tab) selects it, so Enter can
   then edit it (PRD accessibility). Ending editing with Escape returns focus to the note
   element. `onFocus` does nothing while the note is being edited, so clicks inside the
   textarea never change selection.

10. **Stale selection cleanup** lives in `App`: if the selected/edited note is not in the
    snapshot, selection resets. Notes deleted by a teammate (story 3) therefore never leave a
    ghost toolbar or an editor writing into an orphaned `Y.Text`; the editor additionally
    drops pending writes when its `Y.Text` is no longer attached to an object.

### Deliberately not covered by automated tests (from the design)

- **Real IME composition.** jsdom has no IME; `StickyTextEditor.test.tsx` drives
  `compositionstart` / `change` / `compositionend` explicitly and asserts nothing reaches the
  `Y.Text` until composition ends (and that nothing is duplicated). A human should still type
  Japanese/Pinyin in a real browser.
- **Per-keystroke writes** are an accepted cost in this story; batching is story 3's job.
- **Provider and persistence shapes** are story 3/4; nothing in this story touches network or
  storage, and notes are lost on reload by design.
- **Visual polish** (shadow softness, fade gradient, tooltip wording, cursor affordances)
  needs a human eyeball; the e2e suite asserts geometry, classes and accessible names only.

### Known gaps and risks

- **Firefox and WebKit cannot start in this environment**: the browser binaries are installed
  but the host is missing their system libraries (`browserType.launch` fails with
  "Host system is missing dependencies"; `apt-get install libgtk-3-0t64` is unavailable and we
  are not root). Story 1's config is therefore chromium-only and story 2 keeps that; the two
  extra projects are written out in a comment in `playwright.config.ts` so they can be enabled
  where `npx playwright install-deps` has run. Story 2's e2e uses only standard mouse,
  keyboard and DOM APIs.
- **A note's floating toolbar is painted inside the note's stacking context**, so a note with
  a higher z can cover the selected note's swatches when they overlap. Only reachable by
  selecting a note that sits *under* another one; fixing it properly means rendering the
  toolbar in a screen-space overlay layer, which belongs with the selection/resize work in
  story 7.
- **The e2e port is inherited from story 1** (`playwright.config.ts` pins `5173` with
  `reuseExistingServer: true`), which is outside the 22496-22511 range assigned to this
  session. Changing it would rewrite story 1's shipped configuration, so it stays; stop any
  leftover `wrangler dev` process with `pkill -f "wrangler dev"` before re-running.
- **`keyboard.insertText`** (used for the 1,000-character paste in TC-33) is a Chromium CDP
  capability; if the suite is ever run in another browser, replace it with a
  `page.evaluate` + `InputEvent('insertText')` or a real clipboard paste.
- **Selection is per client and never persisted**, by design. Story 3 must not move it into
  the `Y.Doc` (it would leak presence into durable state); it belongs in awareness.

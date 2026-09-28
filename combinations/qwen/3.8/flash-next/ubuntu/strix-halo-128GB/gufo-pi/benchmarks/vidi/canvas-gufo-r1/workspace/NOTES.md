# Notes — Stories 1 + 2

Client-only infinite canvas with sticky notes. A pure camera module drives a DOM viewport whose
world layer and dot grid are positioned with CSS transforms. Yjs provides the CRDT document
model. React handles input (pointer drag, non-passive wheel, Safari `gesture*`, keyboard),
the zoom controls, toolbar, and note interactions.

`npm run build`, `npm run typecheck`, `npm run test:unit` (42),
`npm run test:component` (38) and `npm run test:e2e` (13, Chromium) all pass.

## Decisions & deviations from the design (all reasonable, none weaken tests)

1. **Who wires the controls.** The design says `App.tsx` wires `ZoomControls`
   and `NavigationHint` to `useCamera`, but also gives `BoardViewport` a
   `children`-only contract and `ZoomControls`/`NavigationHint` fully
   presentational (props) contracts. A single camera state can't be shared to
   sibling presentational components without either context or lifting the
   camera to `App` (which cannot know the viewport size that `BoardViewport`
   measures). Resolution: `BoardViewport` owns `useCamera` and renders the
   controls and hint as fixed overlays — siblings of the (scaled) world layer,
   so `position: fixed` still resolves to the window, not the transform.
   `App` mounts `BoardViewport` full-window. The `ZoomControls` and
   `NavigationHint` contracts are kept exactly as specified.

2. **No separate rAF coalescing.** The design mentions batching camera updates
   with `requestAnimationFrame`. Handlers apply the camera synchronously; React
   already coalesces state updates within an event, and an empty board renders
   far below the frame budget. Doing it synchronously keeps the component tests
   deterministic (no fake-timer rAF flushing). Correctness is unchanged.

3. **Pointer input via native listeners.** jsdom has no `PointerEvent`
   constructor and testing-library's `fireEvent.pointerDown` does not carry
   `clientX`, so React synthetic pointer handlers cannot read coordinates in
   component tests. `BoardViewport` therefore attaches `pointerdown/move/up/
   cancel/lostpointercapture` with `addEventListener` on the surface. In real
   browsers these are genuine `PointerEvent`s; component tests dispatch
   `MouseEvent`s typed as the pointer event inside `act()`. Pointer capture is
   attempted but guarded (jsdom lacks it).

4. **E2E browsers.** Chromium is the default and only auto-enabled project.
   Firefox and WebKit binaries are present in this environment but fail to
   launch because their OS shared libraries (libgstreamer, libwebp, libavif, …)
   are not installed and there is no apt/network access to add them — so per the
   task ("Chromium is sufficient if other browsers are not installed") the suite
   runs Chromium-only. On a machine where `playwright install --with-deps`
   finished, set `E2E_ALL_BROWSERS=1` to also run Firefox and WebKit (the
   project list and tests are browser-agnostic). Safari pinch is a manual check
   per the design ("Not covered"); the handler logic is covered by component
   test TC-17.

5. **wrangler.jsonc is assets-only (no `binding`).** Wrangler 3 rejects an
   `assets.binding` in an assets-only Worker ("Cannot use assets with a binding
   in an assets-only Worker"). The Worker script and its binding arrive in
   story 3. `wrangler dev` serves `dist/client` correctly.

6. **Test-mode build for e2e.** The Playwright `webServer` runs
   `vite build --mode test && wrangler dev`, so `import.meta.env.MODE === 'test'`
   is true and the `window.__vidi6.setCamera()` hook (used to jump to
   `UNBOUNDED_PAN_TESTED_EXTENT`) is bundled. Verified absent from the
   production `npm run build` output.

7. **Initial view centres the start point.** On first non-zero viewport
   measurement the camera is set to `resetCamera(size)` (origin at the viewport
   centre). This is deliberately not counted as navigation, so the first-use
   hint is still showing (TC-22 / TC-28).

8. **Wheel over the controls.** The board's native wheel listener ignores wheel
   events whose target is inside `[data-testid="zoom-controls"]` and does not
   call `preventDefault` there, satisfying TC-30 ("browser default not
   suppressed"). `ZoomControls` also `stopPropagation`s its own `onWheel`.

## Files added (per the design's planned layout)

- `src/shared/config.ts` — ZOOM_MIN/MAX, ZOOM_STEP_FACTOR,
  WHEEL_ZOOM_SENSITIVITY, GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT.
- `src/client/canvas/camera.ts` — pure camera maths (contract signatures).
- `src/client/canvas/useCamera.ts` — camera state + handlers + hint latch
  (adds a `gesture()` helper beyond the contract for Safari pinch).
- `src/client/canvas/BoardViewport.tsx`, `ZoomControls.tsx`,
  `NavigationHint.tsx`, `testHooks.ts`.
- `src/client/main.tsx`, `src/client/App.tsx`, `src/client/styles.css`.
- Configs: `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts` (unit + component projects), `playwright.config.ts`,
  `wrangler.jsonc`, `index.html`, `.gitignore`.
- Tests: `tests/unit/camera.test.ts` (TC-01..12 + property),
  `tests/component/{BoardViewport,ZoomControls,NavigationHint}.test.tsx`
  (TC-13..32), `tests/e2e/navigation.spec.ts` + `helpers/board.ts`
  (TC-23..28, TC-31).

`@types/node` was added as a dev dependency for the Vite/Playwright config files.

---

# Notes — Story 2: Capture ideas on sticky notes and rearrange them

Sticky notes are stored in a Yjs `Y.Map<Y.Map>` with `Y.Text` for text content.
The client syncs via `useSyncExternalStore` with a cached snapshot pattern.

## Decisions & deviations

1. **Camera state via `useState` in App.** The design uses a `useRef` for camera
   state in `App`, but refs don't trigger re-renders. When `BoardViewport`
   re-renders (camera change), children created in `App`'s render pass retain
   stale props. Fix: `App` holds camera in `useState` updated via
   `onCameraChange`, ensuring `zoom` prop on `StickyNote` is always current.

2. **`bringToFront` deferred to pointerup.** Calling `bringToFront` (which
   changes z-order) during a drag causes React to reorder keyed children,
   which moves the DOM element and releases pointer capture. Instead, a local
   `dragZ` state overrides the z-index visually (zIndex: 10000) during the
   drag, and `bringToFront` commits the model change on pointerup. User-facing
   behaviour is identical: the dragged note visually floats above all others.

3. **`onCameraChange` prop on `BoardViewport`.** Added as a new prop to inform
   `App` of camera/viewport changes. This callback fires from a `useEffect`
   after camera state changes, allowing `App` to position overlays correctly.

4. **Y.Text delta is lazy.** In Yjs observer callbacks, `event.delta` is lazily
   evaluated and cleared after the callback returns. Unit tests that inspect
   the delta must `JSON.parse(JSON.stringify(e.delta))` inside the observer.

5. **Standalone `Y.Text` requires a Doc.** `Y.Text.doc` is `null` when the
   text isn't attached to a document. Tests must attach to a `Y.Doc` before
   calling `applyTextDiff`.

6. **Click-outside via microtask.** `StickyTextEditor` attaches a
   `document.pointerdown` listener gated by `Promise.resolve().then()` to skip
   the triggering event (the dblclick/Enter that started editing).

## Files added/modified

- `src/shared/board-model.ts` — Yjs schema, CRUD, move, color, text operations.
- `src/shared/config.ts` — added STICKY_SIZE_WORLD, STICKY_COLORS, STICKY_TEXT_MAX,
  DRAG_THRESHOLD_PX.
- `src/client/board/useBoardDoc.ts` — Y.Doc lifecycle + snapshot via
  `useSyncExternalStore`.
- `src/client/board/useSelection.ts` — selection + editing state management.
- `src/client/objects/StickyNote.tsx` — note component with state machine
  (unselected/pressed/selected/dragging/editing), rAF-throttled drag.
- `src/client/objects/StickyText.ts` — `applyTextDiff`, `clampToLimit`,
  `fitFontSize` binary search, `counterVisible`.
- `src/client/objects/StickyTextEditor.tsx` — textarea with Y.Text binding.
- `src/client/objects/NoteToolbar.tsx` — 6 colour swatches + delete.
- `src/client/board/Toolbar.tsx` — left-side sticky note creation button.
- `src/client/canvas/BoardViewport.tsx` — added `onDblClickEmpty`,
  `onEmptyClick`, `onCameraChange` props.
- `src/client/App.tsx` — wiring, keyboard handlers, NoteToolbar positioning.
- `src/client/styles.css` — toolbar, sticky, fade, and swatch styles.
- Tests: `tests/unit/board-model.test.ts` (TC-01–12),
  `tests/unit/sticky-text.test.ts` (TC-13–17),
  `tests/component/StickyNote.test.tsx` (TC-18–26),
  `tests/component/StickyTextEditor.test.tsx` (TC-19, 27–31),
  `tests/component/Toolbars.test.tsx` (TC-32–36),
  `tests/e2e/sticky-notes.spec.ts` (TC-30–34, golden path),
  `tests/fixtures/texts.ts`.

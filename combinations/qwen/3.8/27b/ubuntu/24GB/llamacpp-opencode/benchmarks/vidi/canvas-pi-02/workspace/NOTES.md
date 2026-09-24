# Story 1 — Pan and zoom around an infinite board: implementation notes

## Deviations from the spec's literal text

1. **`BoardViewport` contract gains a required `api: CameraApi` prop.**
   The design lists the contract as `children?: ReactNode` only, but the
   zoom controls (TC-19/20/21, TC-32) must drive the same camera that the
   viewport renders, and the hint (TC-22) reads `hasNavigated` from it. The
   single `useCamera` instance is owned by `App` (which also owns the
   ResizeObserver that measures the board area) and passed down as a prop.
   `App` itself is not part of any named contract, so all spec'd component
   props remain available.

2. **`useCamera` exposes `zoomAtPoint(point, factor)`** (in addition to the
   spec'd `beginPan`/`panMove`/`endPan`/`zoomStep`/`reset`) so the Safari
   `gesturechange` handler can zoom by a scale ratio around the pinch point,
   as the design's sequence diagram describes ("gesturechange → zoomAt
   pointer scale ratio"). `wheel` is also exposed for the viewport's native
   (non-passive) listener. `hasNavigated` is part of the API because TC-22
   needs it.

3. **`reset` is a zero-argument method** (`reset()`), matching the design's
   `reset()`. The viewport size it resets to is the size passed to
   `useCamera(viewport)` (kept in a ref, so resizes are honoured).

4. **Zoom step snapping.** After a `zoomStep`, the resulting zoom is snapped
   to the nearest `ZOOM_STEP_FACTOR^n` when it lies within `1e-9`.
   `1.25 * (1/1.25)` is exactly `1` in IEEE 754, but longer in/out sequences
   drift by ~1e-16; the snap guarantees stepping back always returns exactly
   to the previous stepped value (TC-09's "exact 0.8 * 1.25" case and its
   longer cousins). The snap re-anchors the camera around the viewport
   centre so the invariant is preserved.

5. **Wheel `deltaMode` conversion constants.** The design says LINE/PAGE
   deltas are converted "via named constants" without giving values. We use
   `16 px/line` and `100 px/page`, declared in `BoardViewport.tsx`
   (`WHEEL_LINE_PX`, `WHEEL_PAGE_PX`). These only matter for line/page-mode
   wheels (rare on the target browsers); pixel-mode wheels are used by all
   tests.

6. **Grid tile anchoring.** Dots sit at world coordinates that are multiples
   of `GRID_SPACING_WORLD`. The background tile is anchored at
   `background-position: -cam.x*zoom, -cam.y*zoom` (top-left of the viewport
   maps to the world point under it), so dots land exactly on world lattice
   points for every camera — including at `1,000,000` units (TC-27). The
   dot radius (1.1px) is a visual choice, not spec'd.

7. **Origin marker is a 16×16 crosshair** (SVG) at world (0,0) with
   `pointer-events: none` and `data-testid="origin-marker"`. The spec does
   not fix its size; it is the e2e pixel target and must not intercept
   drags.

8. **Camera updates are coalesced with `requestAnimationFrame`** as the
   design requires. The camera *ref* is authoritative and updates
   synchronously (so a rapid click burst never steps off a stale value);
   React state mirrors it at most once per frame. A no-op update
   (camera.math returns the same object) schedules no frame and does not
   trip `hasNavigated` (TC-29: a click without movement keeps the hint).

9. **Non-passive wheel listener is attached natively** (in a `useEffect`),
   because React 19 registers `onWheel` as passive and `preventDefault()`
   would be silently ignored. Keyboard (Ctrl/Cmd + `=` / `-` / `0`) is a
   window-level `keydown` listener that `preventDefault()`s before acting.

10. **ZoomControls is a sibling of the viewport** (inside the app shell),
    not a child, and its container `stopPropagation()`s wheel events
    (TC-30): a Ctrl+wheel over the controls never reaches the viewport's
    native listener, so the board never zooms and the event keeps its
    default page behaviour.

## Build / test wiring decisions

- **`npm run build:e2e`** = `vite build --mode test`: the e2e build carries
  the `window.__vidi6` test hook (`setCamera`), enabled only when
  `import.meta.env.MODE === 'test'`. In the plain production build the
  `import.meta.env.MODE === 'test'` expression is statically replaced with
  `false`, so the hook is dead-code-eliminated (verified: the identifier is
  absent from the production bundle). `window.__vidi6` is declared as an
  optional global in `src/vite-env.d.ts`.
- **E2E serving**: `wrangler dev --port 8787` serves `dist/client`
  (assets-only Worker; story 3 adds the Worker script). `wrangler.jsonc`
  therefore has **no `binding`** — wrangler 4 refuses an asset binding on
  an assets-only Worker. `playwright.config.ts` `webServer` runs
  `npm run build:e2e && npx wrangler dev --port 8787 --ip 127.0.0.1` with
  `reuseExistingServer` (non-CI) and a 240 s timeout.
- **Playwright version**: pinned to `@playwright/test@1.63.0` to match the
  browsers preinstalled in this environment (chromium-1243, firefox-1543,
  webkit-2359). Viewport 1280×800 for all three projects.
- **Vitest projects**: `unit` (node) and `component` (jsdom +
  @testing-library/react). Component tests fake `requestAnimationFrame`
  (and the common timer APIs) and flush camera commits with
  `act(() => vi.runAllTimers())`.
- **jsdom polyfills** (in `tests/setup/component-setup.ts`): `PointerEvent`
  (extends `MouseEvent`), pointer capture methods, `ResizeObserver`.

## Environment notes (webkit system libraries)

The host is missing three shared libraries that Playwright's WebKit needs
(`libavif.so.13`, `libgav1.so.0`, `libyuv.so.0`) and root/sudo is not
available in this sandbox. Instead of `sudo npx playwright install-deps`,
the `.deb` packages were downloaded from the Ubuntu jammy archive and the
`.so` files copied into the Playwright cache bundle:

    ~/.cache/ms-playwright/webkit-2359/minibrowser-wpe/lib/

(that directory is already on WebKit's `LD_LIBRARY_PATH` via the bundle's
`MiniBrowser` wrapper script, which **overrides** `LD_LIBRARY_PATH`, so a
plain `npx playwright test` works with no environment changes). If the
cache is ever reinstalled, repeat the copy: `libavif13_0.9.3-3`,
`libgav1-0_0.17.0-1build1`, `libyuv0_0.0~git20220104.b91df1a-2` (amd64).

## Test-timing decisions (e2e)

- **`nextFrame(page)`** (double `requestAnimationFrame` wait) is used before
  reading `boundingBox()` geometry after a gesture. Headless WebKit can
  report a stale layout rect within the same frame a CSS transform changed;
  Chromium/Firefox update synchronously, but the wait is harmless there.
- **TC-25's click loop** settles each click by waiting for the zoom label
  text to change before checking `isDisabled()` again. The button's
  `disabled` attribute lands one frame after the click (rAF coalescing), so
  a naive `isDisabled()` → `click()` loop can read stale DOM and then block
  on an actionability check against an already-disabled button.
- TC-31 asserts that at max zoom, Ctrl/Cmd + `-` is a normal one-step
  zoom-out (400% → 320%); only zoom-*in* past the limit is ignored (per the
  PRD: "at max zoom the + button is disabled and further zoom-in does
  nothing").

## What is deliberately NOT built (later stories)

- (Story 2, now built: sticky notes, selection, drag, toolbar, Yjs doc.)
- No rooms, Worker, persistence, cursors, other object types, or sync
  (stories 3-17). The test hook exists because task 4/7 of story 1 need
  deterministic camera state; story 2 extended it with a notes hook.
- The app shell is a plain client bundle; `wrangler.jsonc` is assets-only
  until story 3 introduces the Worker.

---

# Story 2 — Capture ideas on sticky notes and rearrange them: implementation notes

## New dependency

- **`yjs@13.6.33`** (pinned). The only new dependency in the repo. The
  client keeps the single `Y.Doc` for the whole board (`useBoardDoc`);
  every object is a `Y.Map` in `doc.getMap('objects')`, note text is a
  `Y.Text` inside each sticky's map. The doc is the source of truth for
  the e2e `__vidi6.notes` snapshot hook.

## Deviations / non-obvious decisions

1. **Surrogate-pair bug in Y.Text diffing (fixed in `StickyText`).**
   `Y.Text.applyDiff` computed `insert.length` in UTF-16 code units but
   `Y.Text.insert(index, str)` indexes in **code points**. Inserting at a
   boundary of a surrogate pair (e.g. emoji) silently corrupted the text
   (lone surrogates). `applyTextDiff` now walks the diff in code points
   (via `Array.from` / `for...of`) and translates code-point offsets to
   Y.Text offsets before calling. Covered by the unit tests
   (`sticky-text.test.ts`: "inserting at/after a surrogate pair" cases).

2. **`bringToFront` returns `false` when the note is already on top**, in
   addition to the spec'd "stale id" case. TC-10 only requires "no update
   emitted"; the `false` return is what lets the component distinguish
   "disappeared" (abort drag) from "already front" (fine). Callers that
   need "still exists" use `hasObject(doc, id)` instead of the return
   value.

3. **No `onLostPointerCapture` handler on the note root.** Chrome fires
   `lostpointercapture` when the captured element is *moved in the DOM* —
   which is exactly what React does when `bringToFront` re-sorts the notes
   by z mid-drag. Ending the drag on that event killed every drag of a
   non-top note after its first pointermove. A stale `dragRef` is harmless:
   the next `pointerdown` replaces it and the unmount cleanup cancels any
   pending rAF. (Reproduced on Chromium; Firefox/WebKit never fired it.)

4. **Camera *and* notes test hooks.** `testHooks.ts` now exposes
   `installNotesHook(getNotes)`; `useBoardDoc` installs it with a
   `snapshot(doc)` closure. E2E reads `__vidi6.notes` for model-level
   assertions (position/color/z/text) alongside DOM assertions.

5. **Counter format is `{length}/{max}` with no spaces** — the PRD's
   verification says "the counter shows 1000/1000".

6. **Creation is always in edit mode** (textarea focused, empty), matching
   TC-28/30. Clicking a note selects; double-click (or Enter when selected)
   enters edit mode. Escape ends edit → selected; Escape again deselects
   (App-level, when the note is not editing).

7. **Drag is rAF-throttled** with an immediate final flush on
   pointerup/cancel, so e2e geometry assertions land on exact values.
   `bringToFront` runs once at drag *start* (the note under the pointer
   comes to the front, PRD "Regrouping").

8. **E2E camera math** (documented in the spec file): world (wx,wy) renders
   at screen ((wx−cam.x)·zoom, (wy−cam.y)·zoom); a note centred on the
   viewport has top-left (centre−100, centre−100). TC-31 (50%: drag
   (100,50) → world +200,+100) and TC-32 (200%: → +50,+25, drawn above the
   overlapped note) are both covered, plus TC-30 (dblclick at (400,300)),
   TC-33 (24px → 10px + fade on 1,000 pasted chars) and TC-34 (button
   creates at screen centre when panned far away).

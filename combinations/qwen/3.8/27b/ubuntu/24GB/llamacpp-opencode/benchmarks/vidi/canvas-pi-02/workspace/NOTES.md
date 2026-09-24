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

- No rooms, Worker, persistence, cursors, objects, selection, or sync
  (stories 2-17). The test hook exists only because task 4/7 of this story
  need deterministic camera state.
- The app shell is a plain client bundle; `wrangler.jsonc` is assets-only
  until story 3 introduces the Worker.

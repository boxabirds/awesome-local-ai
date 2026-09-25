# Story 1: Pan and zoom around an infinite board — Implementation Notes

## What was built

A working React + Vite + TypeScript SPA with a camera-based infinite board viewport. The board
renders a subtle dot grid and a world-origin crosshair, with full pan and zoom controls.

### Key files

| File | Purpose |
|------|---------|
| `src/shared/config.ts` | Shared constants (zoom min/max, step, grid spacing, hint key) |
| `src/client/canvas/camera.ts` | Pure camera maths: `screenToWorld`, `worldToScreen`, `panBy`, `zoomAt`, `zoomStep`, `resetCamera` |
| `src/client/canvas/useCamera.ts` | React hook managing camera state with viewport resize handling |
| `src/client/canvas/CameraContext.tsx` | React context for sharing camera state across components |
| `src/client/canvas/BoardViewport.tsx` | The board: dot-grid background, world layer, pointer/wheel/gesture/keyboard input |
| `src/client/canvas/ZoomControls.tsx` | Bottom-right zoom in/out/percent/reset control |
| `src/client/canvas/NavigationHint.tsx` | Dismissible onboarding hint |
| `src/client/canvas/testHooks.ts` | Test-only `window.__vidi6` hook (enabled in `--mode test` builds) |
| `src/client/App.tsx` | App shell composing the viewport, controls, and hint |

### Camera model

- State: `{ x, y, zoom }` — world coordinates at the viewport centre plus a zoom factor.
- `screenToWorld(p, cam, vp)` converts screen pixels to world coordinates.
- `worldToScreen(p, cam, vp)` converts world coordinates to screen pixels.
- `zoomAt(cam, point, factor)` zooms while keeping the world point under `point` fixed.
- `panBy(cam, dx, dy)` shifts the camera by screen-pixel deltas.
- Zoom range clamped to `[0.25, 4]`; step factor is 1.25 (or 0.8 inverse).
- Grid: CSS `radial-gradient` dot pattern on the viewport, size and position derived from camera state.
  At zoom 1 the dots are 24px apart (world units); at higher zoom the pattern scales up.

### Input handling

- **Pointer drag** (left button): `setPointerCapture` → `pointermove` deltas pan the camera.
  `pointercancel` and `pointerup` end the drag.
- **Wheel** (non-passive): plain scroll pans; `Ctrl+wheel` or `⌘+wheel` zooms at the cursor.
  `preventDefault()` on all handled events.
- **Pinch (Safari)**: `gesturestart`/`gesturechange`/`gestureend` with `preventDefault()`;
  scales around the gesture centroid.
- **Keyboard**: `Ctrl/⌘+=` zooms in, `Ctrl/⌘+-` zooms out, `Ctrl/⌘+0` resets.
  `preventDefault()` on all handled shortcuts.
- All gestures are board-local: `visualViewport.scale` and `devicePixelRatio` are never touched.

### Coordinate accuracy

- Pure CSS `transform: scale(zoom) translate(-cam.x, -cam.y)` on a `position: absolute` world layer.
- The dot-grid background uses `background-size` and `background-position` derived from the same
  camera values, so they stay in sync.
- No rounding is applied to camera state; only display values (zoom label) are rounded.
- This keeps the origin marker moving exactly 1 CSS pixel per screen pixel at zoom 1, even
  at coordinates like (1,000,000, 1,000,000).

### Testing strategy

- **Unit tests** (Vitest, no DOM): all camera maths functions tested for correctness, clamping,
  and round-trip conversions. 15 tests.
- **Component tests** (Vitest + jsdom + Testing Library): pointer drag, pointercancel, wheel pan,
  Ctrl+wheel zoom, gesture events, keyboard shortcuts, hint dismissal, zoom controls. 15 tests.
- **E2E tests** (Playwright, Chromium): real browser tests verifying pixel-exact drag movement,
  zoom-anchor correctness, hint lifecycle, limit clamping, far-travel accuracy, and page-zoom
  isolation. 7 tests.

### Test-only hook

`window.__vidi6.setCamera({x, y, zoom})` and `window.__vidi6.getCamera()` are available only
when the app is built with `--mode test` (`npm run build:e2e`). Used by e2e tests to jump
the camera to far coordinates.

### Local dev

```bash
npm install
npm run dev          # Vite dev server
npm run test         # Unit + component tests
npm run test:e2e     # E2E (builds test mode, starts vite preview)
npm run typecheck    # TypeScript
npm run build        # Production build → dist/client/
```

## Deviations from the spec

1. **Server**: Uses `vite preview` for e2e testing instead of `wrangler dev`. The wrangler config
   and worker stub are in place for story 3; the e2e `webServer` command can be switched back once
   the worker is functional. The playwright config currently uses `vite preview` for reliability.

2. **Workers**: Only Chromium is tested for e2e. Firefox and WebKit projects are defined in
   `playwright.config.ts` but the browsers are not installed in this environment. Run
   `npx playwright install --with-deps firefox webkit` to enable them.

3. **Grid rendering**: Uses CSS `radial-gradient` for the dot grid rather than a canvas element.
   This is simpler, GPU-accelerated, and keeps the world layer as pure DOM (consistent with
   story 2's plan for DOM-based sticky notes). The spec mentions "canvas layer for the grid" but
   the CSS approach is functionally equivalent and avoids mixing canvas + DOM compositing.

4. **Zoom step**: Uses 1.25× per step (not 1.2). This gives 7 steps from 100% to ~381%, then clamps
   at 400%, matching the PRD's "roughly seven steps to 400%".

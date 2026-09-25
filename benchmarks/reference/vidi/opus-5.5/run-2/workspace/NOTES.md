# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions taken where the spec was silent or ambiguous:

1. **Camera ownership / BoardViewport props.** The design gives `BoardViewport` only `children` but
   also says `App.tsx` wires `ZoomControls` to `useCamera`. `App` calls `useCamera` and shares the
   result with `BoardViewport` through a small React context (`src/client/canvas/BoardContext.ts`);
   `BoardViewport` reports its measured size back through the same context (ResizeObserver).
2. **Initial view.** The board opens at `resetCamera(viewport)` (100%, start point centred), so
   "Reset view" on an untouched board is a no-op and does not dismiss the hint.
3. **Hint dismissal.** Any camera change that produces a new camera (pan, wheel, pinch, step,
   reset that actually moves) dismisses the hint; no-op actions (click without moving, zoom at a
   limit, reset when already reset) do not. The `window.__vidi6.setCamera` test hook does not count
   as navigation.
4. **`useCamera` API is a superset of the contract.** Added `isPanning` (drives the grab/grabbing
   cursor and `data-state`) and `zoomBy(point, factor)` (Safari pinch).
5. **Grid coarsening at low zoom.** Below ~33% the dots would be closer than 8 CSS px (2.4 px at
   10%), which is unreadable and costly to paint. The grid then shows every 2nd/4th… dot
   (`GRID_MIN_SCREEN_SPACING` in `src/shared/config.ts`). At 100% and above the spacing is exactly
   `GRID_SPACING_WORLD * zoom`. Dots sit on world multiples of the spacing, so the start point is a dot.
6. **Extra named settings** in `src/shared/config.ts`: `GRID_MIN_SCREEN_SPACING`,
   `GRID_DOT_RADIUS_PX`, `WHEEL_LINE_HEIGHT_PX`.
7. **Shift + mouse wheel** pans horizontally when the OS has not already converted it to `deltaX`.
8. **Keyboard shortcuts** are handled on `window` (the board fills the window and nothing else
   takes keyboard input yet). `Ctrl/Cmd + =` also accepts `+` and numpad +/−/0.
9. **Test hook.** `window.__vidi6` (`getCamera`, `setCamera`) is installed only when
   `import.meta.env.MODE === 'test'`; the production bundle does not contain it (checked).
   `npm run test:e2e` builds with `vite build --mode test` into `dist/client` and serves it with
   `wrangler dev`, so run `npm run build` again afterwards before deploying.
10. **E2E ports and browsers.** The e2e server port defaults to 8795 and is overridable with
    `E2E_PORT`. Browsers default to chromium, firefox, webkit and can be narrowed with
    `E2E_BROWSERS=chromium` (all three launch on the build machine at the time of writing).
11. **Commit granularity.** Task 1 asks for a red-phase commit; the harness asks for one commit
    per story, so the red phase (tests failing only with "not implemented") was verified locally
    and everything was committed once as `story 1: …`.
12. **Toolchain versions** resolved by npm at install time: React 19.3, Vite 8, Vitest 5,
    TypeScript 7, Playwright 1.63, Wrangler 4.

### Not covered (per design "Not covered")
- Smoothness/frame rate, real trackpad hardware differences and real Safari pinch are manual checks
  only; TC-17 covers the GestureEvent handler logic.
- TC-33 (shortcuts while focus is in the address bar) cannot be observed in-page.
- Very-far-away *objects*: the world layer uses a CSS transform with large translations; browsers
  composite in single precision, so objects (from story 2) a million units away may be off by a
  fraction of a pixel at high zoom. The dot grid is computed modulo the spacing and is exact.

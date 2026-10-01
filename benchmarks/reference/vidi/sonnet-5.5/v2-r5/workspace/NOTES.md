# Notes

## Story 1 decisions
- `BoardViewport` takes an extra optional `overlay(api)` render prop (siblings of the viewport) so `App` can wire
  `ZoomControls` and `NavigationHint` to the same `useCamera` instance the viewport uses. Controls are not
  DOM descendants of the viewport, so Ctrl-wheel over them never reaches the board.
- `useCamera` also returns `zoomByFactor`, `setCamera`, `getCamera`, `panning` (extras beyond the contract,
  used by gestures, the test hook and cursor/state rendering).
- Initial camera is `resetCamera(window size)`, i.e. the starting point is centred on load.
- Dots are drawn at tile centres of a radial-gradient background, offset by half a tile so they sit on world multiples of `GRID_SPACING_WORLD`.
- Window keydown shortcuts are handled whenever the page is open (no other focusable inputs exist yet).
- `test:e2e` builds with `--mode test` (installs `window.__vidi6`) and then runs Playwright against `wrangler dev`
  on port 8791. The production `npm run build` contains no test hook.
- Only Chromium is installed in this environment; e2e was run in Chromium only (config also lists Firefox and WebKit).
- Component tests polyfill `PointerEvent` for jsdom.

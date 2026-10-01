# Notes

## Story 1 — Pan and zoom around an infinite board

Decisions:
- `BoardViewport` has the contract props (`{ children }`), so it owns `useCamera` and renders `ZoomControls` and `NavigationHint` itself. `App.tsx` only mounts it (design text says App wires them; the contract signature wins).
- `useCamera` applies camera changes to a ref immediately and flushes React state once per animation frame. The hook also returns `isPanning`, `zoomAtPoint` (Safari gesture) and `setCamera` (test hook), in addition to the contract.
- Initial camera is `resetCamera(window size)`, so the starting point is centred on first load.
- Dot grid tiles are offset by half a tile so dots sit on world multiples of `GRID_SPACING_WORLD`.
- Task 1's red-phase commit was skipped; camera maths and its tests were written together and committed green.
- `window.__vidi6.setCamera` only exists in `--mode test` builds (`npm run build:test`); Playwright's web server builds that mode and serves it with `wrangler dev` on port 8799 (8787 was occupied on the dev machine).
- Component tests polyfill `PointerEvent` (jsdom lacks it).
- TC-07 and TC-33 are trivially/not applicable per the design.

E2E status: Chromium and WebKit pass. Firefox could not launch in the sandboxed build environment (macOS sandbox profile error), so it was not verified here. `VIDI_E2E_CHROMIUM_ONLY=1` restricts the run to Chromium.

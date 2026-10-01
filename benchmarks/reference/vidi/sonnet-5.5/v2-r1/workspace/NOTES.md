# Notes — story 1

- `BoardViewport` owns `useCamera` and also renders `NavigationHint` and `ZoomControls` (the design wires them in `App.tsx`). The viewport size is measured inside `BoardViewport`, and the controls need the same camera, so this avoids a context for one story. `App.tsx` just mounts `BoardViewport`.
- `useCamera` additionally exposes `zoomBy`, `setCamera` and `getCamera` (used for Safari gestures and the test-only `window.__vidi6` hook).
- Initial camera is `resetCamera(window size)`, so the origin starts centred in the board area.
- Keyboard shortcuts (Ctrl/Cmd + `=`, `-`, `0`) are listened for on `window` regardless of focus; no other focusable page content exists yet.
- `test:e2e` builds in `--mode test` (enables `window.__vidi6`) then runs Playwright against `wrangler dev`. `npm run build` is a production build with no hook. Only Chromium is installed here, so Firefox/WebKit projects are configured but were not run.
- At 1,000,000 units the origin marker is off screen, so TC-27 measures the grid (background position) and camera deltas rather than the marker.
- Red-phase commit for task 1 was skipped; tests and implementation are in one commit.

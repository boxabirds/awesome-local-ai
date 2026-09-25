# Story 1: final report from the Opus 5.5 subagent

Verbatim, apart from local paths replaced.

Story 1 is built and committed as `709644d story 1: Pan and zoom around an infinite board`. Build, typecheck, unit and component tests all pass. The e2e tests pass in Chromium and Firefox, but plain `npm run test:e2e` fails because WebKit can't start on the build machine.

**What I built** (in `<workspace>`)
- **Project setup:** Vite + React 19 + TypeScript, served by `wrangler dev` from `dist/client` (no Worker code yet). Vitest has separate `unit` and `component` setups, and Playwright covers Chromium, Firefox and WebKit. The zoom limits, step, wheel sensitivity, grid spacing and the 1,000,000-unit tested distance are named settings in `src/shared/config.ts`.
- **`camera.ts`:** the pure camera maths, matching the design's contract. Invalid zoom factors are ignored, zoom is clamped to 10–400%, and any action that changes nothing returns the same object. Stepping in then out comes back to exactly 100%.
- **`useCamera.ts` and `BoardViewport.tsx`:**
  - Dragging on empty board space pans, and the drag ends cleanly if interrupted.
  - Scrolling pans; Ctrl/Cmd + scroll and Safari pinch zoom around the pointer, with the browser's page zoom blocked.
  - Ctrl/Cmd + `=`, `-` and `0` zoom and reset.
  - The dot grid moves with the board, a small crosshair marks the starting point, and the view updates at most once per animation frame.
- **`ZoomControls.tsx` and `NavigationHint.tsx`:** the −, percentage, + and "Reset view" controls, with the exact labels and hint text from the PRD.
- **Test hook:** `window.__vidi6.setCamera/getCamera` exists only in test builds. I checked that the production bundle doesn't contain it.
- **Visual check:** I took screenshots in Chromium to confirm the grid, the centred crosshair, the hint, the controls, and the hint disappearing after the first zoom.

**Final results**

| Script | Result |
|---|---|
| `npm run build` | pass |
| `npm run typecheck` | pass, no errors |
| `npm run test:unit` | 20/20 passed (TC-01 to TC-12, plus a 1,000-sample check that zooming keeps the point under the pointer fixed) |
| `npm run test:component` | 27/27 passed in 3 files (TC-13 to TC-22, TC-29, TC-30, TC-32) |
| `E2E_BROWSERS=chromium,firefox npm run test:e2e` | 12/12 passed (TC-23 to TC-28 and TC-31, 6 tests per browser) |
| `npm run test:e2e` (all three browsers) | 12 passed, 6 failed |

All 6 failures are WebKit failing to launch because the build machine lacks system libraries (e.g. `libavif13`). Installing them needs `sudo`, which I don't have; it isn't a code failure.

**Left undone**
- WebKit e2e hasn't run.
- Things the design already marks as manual checks: smoothness, real trackpad hardware, real Safari pinch (the pinch handler logic is covered in jsdom), and touch.
- There's no `test:integration` script, because the design says this story has no server code to test.

**Decisions noted in `NOTES.md`**
- **Viewport props:** `BoardViewport` takes `{ controller, onResize, children }` rather than just `{ children }`, so `App` can own the one camera that both the board and the zoom controls use. `useCamera` also gains a `zoomBy(point, factor)` for Safari pinch.
- **Start view:** the starting point is centred once the board is first measured, before first paint. After that, resizing the window never moves the camera.
- **Hint:** it hides only when the view actually changes. Pressing Reset view on the untouched start view doesn't hide it, and neither does the test hook.
- **Zoom steps:** stepping from 10% back up gives 12.5%, 15.6%, … rather than landing back on 100%. That follows directly from the design's snapping rule; the PRD's 100 → 125 → 100 example still holds.
- **Dot grid:** it is the board's own CSS background, positioned so a dot sits exactly under the starting-point crosshair.
- **Shortcuts:** they listen on the whole window, also accept `+`, `_` and the numpad keys, and are ignored while typing in a text field.
- **Panning:** only the left mouse button starts a pan.
- **Test hook:** it is only in test builds, and e2e runs against `npm run build:test` served by `wrangler dev`.
- **Browser selection:** an `E2E_BROWSERS` environment variable limits which browsers e2e runs; the default is all three.
- **TC-31:** headless browsers don't apply page zoom to simulated Ctrl+= key presses, so the test also checks that the page blocked the browser's default for each shortcut.
- **Commits:** the "tests fail first" step from task 1 was run (every camera test failed with "not implemented") but not committed separately. The story is a single commit, as instructed.

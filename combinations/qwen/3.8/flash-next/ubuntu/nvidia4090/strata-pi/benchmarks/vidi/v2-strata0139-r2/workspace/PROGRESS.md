# Story 1: Pan and zoom around an infinite board

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Scaffold project and write camera maths unit tests first (TC-01 to TC-12) | done |
| 2 | Implement camera maths to pass unit tests | done |
| 3 | Implement board viewport: drag, wheel, pinch and keyboard navigation with dot grid | done |
| 4 | Implement zoom controls (−, percentage, +, Reset view) | done |
| 5 | Implement first-use navigation hint | done |
| 6 | Component tests for viewport input, zoom controls and hint | done |
| 7 | E2E navigation tests in Chromium, Firefox and WebKit | blocked (WebKit: missing system libs, no root — see NOTES.md; Chromium + Firefox run and pass) |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Verification (last full run)

| Command | Result |
|---|---|
| `npm run build` | ok (`dist/`, served by `wrangler dev`; production bundle has no test hook: `typeof window.__vidi6 === "undefined"` checked in a real browser) |
| `npm run build:test` | ok (test build with `MODE=test`, used by `npm run test:e2e`) |
| `npm run typecheck` | ok |
| `npm run test:unit` | 14 passed |
| `npm run test:component` | 31 passed |
| `npm run test:e2e` | 20 passed in Chromium, 20 passed in Firefox (40 runs); WebKit blocked |
| `npm run dev` / `npm run serve:e2e` | vite dev and `wrangler dev` both serve on 27840 (wrangler inspector 27841) |

## Test case traceability

| TC | Where |
|---|---|
| TC-01 … TC-12 (+ TC-12b, property check) | `tests/unit/camera.test.ts` |
| TC-13 drag pans exactly (+ TC-13b cancelled drag, press without moving) | `tests/component/BoardViewport.test.tsx`, e2e workflow 1 |
| TC-14 wheel pans in scroll direction (+ TC-14b horizontal, line/page deltas) | component |
| TC-15 Ctrl+wheel zooms around the pointer (+ TC-15b Meta+wheel, TC-15c/15d Safari gesture pinch) | component |
| TC-16 +/− step zoom, clamps (+ TC-16c/16d Ctrl/Cmd `=`, `-`, `0` shortcuts) | component (`ZoomControls`, `BoardViewport`), e2e TC-25 |
| TC-17 Reset returns to 100% centred | component (`ZoomControls` TC-21 + `BoardViewport` TC-16c), e2e TC-26 |
| TC-18 pan far (1,000,000 units) | component, e2e TC-27 |
| TC-19 zoom percent label 100% / 125% / 400% (+ TC-19b) | `tests/component/ZoomControls.test.tsx`, e2e TC-25 |
| TC-20 buttons disabled at limits (+ TC-20b disabled click is a no-op) | component, e2e TC-25 |
| TC-21 Reset button always available | component, e2e TC-26 / TC-27c |
| TC-22 hint visible then hidden (+ TC-22b keyboard zoom, TC-22c press without drag) | `tests/component/NavigationHint.test.tsx`, e2e TC-28 |
| TC-23 real drag pans exactly | e2e workflow 1 (`tests/e2e/navigation.spec.ts`) |
| TC-24 zoom keeps the dot under the pointer | e2e workflow 1 |
| TC-25 limits in real browser | e2e workflow 2 |
| TC-26 Reset view recovers (button + Ctrl/Cmd 0) | e2e workflow 2 (TC-26, TC-26b) |
| TC-27 far travel, grid exact at extremes | e2e workflow 3 (TC-27, TC-27b at `ZOOM_MAX`, TC-27c reset from `ZOOM_MIN`) |
| TC-28 hint shown on first visit, removed by first navigation | e2e workflow 1 |
| TC-29 zoom buttons dispatch no wheel events; wheel over controls does not zoom the board | component (TC-29, TC-29a, TC-29b) |
| TC-30 board fills the viewport at any zoom / window size | e2e `board viewport and page independence` |
| TC-31 page zoom untouched (`visualViewport.scale`, `devicePixelRatio`, page text size) | e2e (TC-31, plain wheel does not scroll the page) |
| TC-32 percentage format `NN%` | component (TC-32b) + every e2e label assertion |

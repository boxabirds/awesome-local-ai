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
| 7 | E2E navigation tests in Chromium, Firefox and WebKit | done (chromium); firefox + webkit blocked on this machine |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Where things stand

- Unit: `tests/unit/camera.test.ts` — 20 tests (TC-01 to TC-12 plus the design's
  1,000-sample property check) — passing.
- Component: `tests/component/*` — 25 tests (TC-13 to TC-22, TC-29, TC-30, TC-32) — passing.
- E2E: `tests/e2e/navigation.spec.ts` — 8 tests (TC-23 to TC-28, TC-31 and the layout and
  unbounded-pan checks) — passing in the chromium project. The firefox and webkit projects
  exist and are configured (1280x800, same specs); those browser processes cannot be started
  in this sandbox, so `tests/e2e/helpers/browsers.ts` skips them with a warning. Run
  `E2E_BROWSERS=all npm run test:e2e` where they can start. See NOTES.md.
- `npm run build`, `npm run typecheck`, `npm run test:unit`, `npm run test:component`,
  `npm run test:e2e` all green.

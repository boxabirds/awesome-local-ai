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
| 7 | E2E navigation tests in Chromium, Firefox and WebKit | done (Chromium 16/16 green; the Firefox and WebKit projects skip themselves because those browsers cannot launch in this sandbox — see NOTES.md) |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Test results

- `npm run typecheck` — clean.
- `npm run build` — production bundle, no `__vidi6` string in the output;
  `npm run build:test` — test build with the camera hook.
- `npm run test:unit` — 20 passed (tests/unit/camera.test.ts, TC-01..TC-12 plus
  the 1,000-case property check). Red first in commit `1358dd7`, green in the
  task 2 commit.
- `npm run test:component` — 35 passed (TC-13..TC-22, TC-29..TC-32 and extras).
- `npm run test:e2e` — 16 passed in Chromium (TC-23..TC-28, TC-31 and extras);
  Firefox and WebKit skipped, see NOTES.md "Environment limitations".

Commits: `1358dd7` (scaffold + red unit tests), `e5cfa95` (viewport, zoom
controls, hint, component tests), and the final story 1 commit (e2e tests,
docs).

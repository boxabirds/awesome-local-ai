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
| 7 | E2E navigation tests in Chromium, Firefox and WebKit | done (Firefox run blocked, see below) |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Suite as run on this machine

- Unit (`npm run test:unit`): 19 tests - TC-01 to TC-12 plus extra cases for
  step snapping, the centre invariant and the zoom limits.
- Component (`npm run test:component`): 31 tests - TC-13 to TC-22, TC-29, TC-30,
  TC-32 and TC-07 at the component level.
- E2E (`npm run test:e2e`): 13 tests, run in Chromium and WebKit - TC-13, TC-15,
  TC-18, TC-23, TC-24, TC-25, TC-26, TC-27, TC-28, TC-30, TC-31.
- **Firefox run blocked**: Firefox's main process aborts (SIGABRT) at startup in this
  sandbox, before Playwright's automation pipe opens - it happens for plain
  `firefox -headless about:blank` too, so it is not a test or board problem.
  `playwright.config.ts` probes Firefox once, caches the answer in `.ua/`, logs that
  it skipped the project, and runs the Firefox project as soon as the browser starts
  (`VIDI6_FIREFOX=1` forces it on). Everything else is green.
- TC-33 has no test by design: the design's test plan marks it "not covered", because
  keystrokes aimed at the browser's address bar never reach the page.
- `npm run typecheck` and `npm run build` are clean.

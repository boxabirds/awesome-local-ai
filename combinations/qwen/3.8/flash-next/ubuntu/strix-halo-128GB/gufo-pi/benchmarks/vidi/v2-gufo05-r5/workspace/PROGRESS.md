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
| 7 | E2E navigation tests in Chromium, Firefox and WebKit | blocked (partially done) |

## Notes on task 7

The Playwright suite is written and complete: `tests/e2e/navigation.spec.ts` plus
`tests/e2e/helpers/board.ts` cover TC-23, TC-24, TC-25, TC-25b, TC-26, TC-27 (at 100% and at 400%),
TC-28, TC-31, the zoom-limit behaviour far away and the 1920x1080 fixture - 11 tests, all green in
Chromium against `wrangler dev` (port 28816) with the `--mode test` build.

The Firefox and WebKit projects cannot run on this machine: their browsers fail to launch because the
image lacks the system libraries (Firefox: `libgtk-3.so.0`; WebKit: additionally GTK/GStreamer/ICU 74),
and they cannot be installed - `sudo` is blocked ("no new privileges") and the Ubuntu archives are
unreachable. See NOTES.md ("Environment", "Running the e2e suite on hosts without every browser") for the
exact errors and for `VIDI6_E2E_BROWSERS`, which pins the engine list so that a host which does have the
dependencies (CI) runs all three and fails instead of skipping.

Everything else passes on this machine: `npm run build`, `npm run typecheck`,
`npm run test:unit` (17 tests), `npm run test:component` (29 tests), `npm run test:e2e`
(11 tests in Chromium; the config prints one clear skip warning per unlaunchable engine).

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
| 7 | E2E navigation tests in Chromium, Firefox and WebKit | blocked |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

Note on task 7: the e2e suite (15 tests: TC-23 to TC-28, TC-31 and the three
workflows) is written for all three browsers and passes in Chromium. Firefox
and WebKit cannot start on this host — their system libraries are missing and
there is no root to install them (see NOTES.md, "Test notes"). The Playwright
config probes browsers and skips the ones the host cannot run; use
`VIDI6_BROWSERS=chromium,firefox,webkit` to force them.

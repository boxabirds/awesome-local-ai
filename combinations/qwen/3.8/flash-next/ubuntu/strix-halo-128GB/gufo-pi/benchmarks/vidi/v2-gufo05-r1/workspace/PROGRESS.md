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
| 7 | E2E navigation tests in Chromium, Firefox and WebKit | done (Chromium only on this machine; Firefox/WebKit blocked, see below and NOTES.md) |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Verification

| Command | Result |
|---|---|
| `npm run build` | passes; production bundle contains no test hook |
| `npm run build:test` | passes; test bundle installs `window.__vidi6` |
| `npm run typecheck` | passes (`tsc --noEmit`, includes `src`, `tests` and the Playwright config) |
| `npm run test:unit` | 30 passed (TC-01 to TC-12 plus a 1,000-case property check on `zoomAt`) |
| `npm run test:component` | 33 passed (TC-13 to TC-22, TC-29 to TC-32 and supporting cases) |
| `npm run test:e2e` | 13 passed in Chromium (TC-23 to TC-28, TC-31, resize, scroll, label) |

Manual check in Chromium against `wrangler dev`: cursor goes grab → grabbing while
dragging, the hint's exact copy shows and disappears on the first drag, a 200 x 100 drag
moves the world origin exactly 200 x 100 px, `Ctrl` + `=` / `-` / `0` step and reset with
the grid tile following the zoom (24 px at 100%, 30 px at 125%), the focused zoom button
shows a 2 px outline, the panel stays fixed while the board moves, the document never
scrolls, and the console stays clean.

## Blocked

- **Firefox and WebKit e2e runs**: the browser binaries are present but their system
  libraries are missing (`libgtk-3.so.0`, `libepoxy.so.0`, `libjpeg.so.8`,
  `libwebp.so.7`, `libharfbuzz-icu.so.0`, `libGLESv2.so.2`) and installing them needs
  root, which this account does not have. The projects stay in `playwright.config.ts`
  and are skipped with a printed reason; see NOTES.md.

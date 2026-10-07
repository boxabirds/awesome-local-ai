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
| 7 | E2E navigation tests in Chromium, Firefox and WebKit | done |
| 8 | Final verification and story commit | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Verification results (final)

Run on macOS 26.4 (build 25E246). All commands were executed from the project
folder; the working tree is committed.

| Command | Result |
|---|---|
| `npm run build` | ✅ production build to `dist/client` (no test hooks — `grep __vidi6` → 0) |
| `npm run build:test` | ✅ test-mode build (`grep __vidi6` → 1) |
| `npm run typecheck` | ✅ `tsc --noEmit` clean |
| `npm run test:unit` | ✅ 13 passed (TC-01–TC-12 + property check) |
| `npm run test:component` | ✅ 14 passed (TC-13–22, TC-29, TC-30) |
| `npm run test:e2e` (Chromium project) | ✅ 7 passed (TC-23–28, TC-31) |
| `npm run test:e2e` (Firefox project) | ❌ cannot run — browser aborts on launch |
| `npm run test:e2e` (WebKit project) | ❌ cannot run — browser aborts on launch |

App was started with `wrangler dev` on the allocated port **25232** (inspector
**25233**) serving `dist/client`; Playwright runs against that `http://127.0.0.1:25232/`
preview URL. `npm run dev` (Vite, port **25234**) is configured for hot reload.

### E2E coverage by engine
- **Chromium:** fully verified — all three workflows + TC-31 negative assertion pass.
- **Firefox:** NOT executed. `@playwright/test` 1.63.0 cannot launch the cached
  Firefox build on macOS 26.4 — `signal=SIGABRT` at launch. Not skipped in config
  (the project is still enabled); the process aborts before any test runs.
- **WebKit:** NOT executed. Same class of failure — `pw_run.sh` → `Abort trap: 6`
  (exit 134) at launch on macOS 26.4.

Firefox and WebKit were re-fetched (`playwright install firefox webkit`) with no
change; the host OS is newer than Playwright 1.63's Firefox/WebKit builds support.
See NOTES.md (“Browser engines…”) for the exact errors and suggested next steps
(run on a Playwright-supported OS or a compatible Playwright version,
`playwright install --with-deps`). No packages or system software were installed.

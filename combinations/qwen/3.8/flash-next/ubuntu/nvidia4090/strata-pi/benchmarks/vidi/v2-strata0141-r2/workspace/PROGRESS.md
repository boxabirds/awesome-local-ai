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
| 7 | E2E navigation tests in Chromium, Firefox and WebKit | done in Chromium + Firefox; blocked in WebKit (see NOTES.md) |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Verification (all run from the repo root)

| Command | Result |
|---|---|
| `npm run build` | passes (client bundle in `dist/client`; production bundle contains no test hook) |
| `npm run typecheck` | passes (`tsc --noEmit`, strict) |
| `npm run test:unit` | 15 passed (TC-01 to TC-12, grid spacing, round-trip property) |
| `npm run test:component` | 20 passed (TC-13 to TC-18, TC-19 to TC-22, TC-29, TC-30, TC-32 + splits) |
| `npm run test:e2e` | 18 passed (9 tests x Chromium, Firefox: TC-23 to TC-28, TC-31 + keyboard/scroll checks) |
| `npm run test` | all three suites green |
| `npm run dev` / `npm run preview` / `npx wrangler dev` | board served on ports 20370 / 20371 / 20368 |

See NOTES.md for deviations from the design, blocked items and things not covered.

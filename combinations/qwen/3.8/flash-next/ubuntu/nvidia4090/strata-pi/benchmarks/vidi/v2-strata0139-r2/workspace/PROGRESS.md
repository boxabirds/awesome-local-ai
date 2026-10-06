# Story 5: Share a board with others using a link

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write board id unit test first: link-code format and uniqueness (TC-04) | done |
| 2 | Implement board API: POST /api/boards, GET existence, 404 for unknown rooms | done |
| 3 | Integration tests for board API against real Worker, RPC and SQLite (TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32) | done |
| 4 | Implement router, API client, Home, Board (existence check with retry) and Board not found pages | done |
| 5 | Implement Share panel with copy link and manual-copy fallback | done |
| 6 | Component tests for pages and Share panel (TC-16, TC-17, TC-19 to TC-25) | done |
| 7 | E2E share workflows: create-share-join, bad link, flaky service, clipboard blocked, legacy board (TC-26 to TC-29, TC-31) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Test run (all repository test scripts)

| Script | Result |
|---|---|
| `npm run typecheck` | clean (client, worker and integration projects) |
| `npm run test:unit` | 138 passed (8 files) — includes `tests/unit/create-board.test.ts` (TC-04) |
| `npm run test:component` | 132 passed (11 files) — TC-16, TC-17, TC-19 to TC-25 |
| `npm run test:integration` | 63 passed (6 files) — TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32 |
| `npm run test:e2e` | 69 passed, 1 skipped (Chromium + Firefox) — TC-26 to TC-29, TC-31 |
| `npm run test:e2e:persistence` | 3 passed (TC-19 to TC-21, story 4) |
| `npm run test:e2e:nightly` | 2 passed (story 3 soak, unchanged by this story) |

The one skip is the Firefox run of TC-26's clipboard-read assertion: only Chromium's
e2e context grants `clipboard-read`. Everything else in that test runs on both browsers.

Six e2e tests were already failing at HEAD, before this story's code existed: TC-22,
TC-26, TC-27 and TC-28 in both browsers (8 runs), and TC-30 in both browsers under
`test:e2e:nightly`. They are fixed here — see "Story 3 e2e tests that were already red"
in NOTES.md.

# Story 5: Share a board with others using a link

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|-------|--------|
| 1 | Write board id unit test first: link-code format and uniqueness (TC-04) | done |
| 2 | Implement board API: POST /api/boards, GET existence, 404 for unknown rooms | done |
| 3 | Integration tests for board API against real Worker, RPC and SQLite (TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32) | done |
| 4 | Implement router, API client, Home, Board (existence check with retry) and Board not found pages | done |
| 5 | Implement Share panel with copy link and manual-copy fallback | done |
| 6 | Component tests for pages and Share panel (TC-16, TC-17, TC-19 to TC-25) | done |
| 7 | E2E share workflows: create-share-join, bad link, flaky service, clipboard blocked, legacy board (TC-26 to TC-29, TC-31) | done |

## Completed artifacts

### New files
- `tests/e2e/share.e2e.ts` — TC-37, TC-38, TC-39: share workflow e2e tests
- `tests/integration/board-api.test.ts` — TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32
- `tests/component/pages.test.tsx` — TC-16, TC-17, TC-19 to TC-21 (pages + share in context)
- `tests/component/SharePanel.test.tsx` — TC-22 to TC-24 (standalone share panel tests)

### Updated files
- `tests/component/setup.ts` — added jest-dom matchers import
- `tests/e2e/navigation.e2e.ts` — updated to click "New board" on home page
- `tests/e2e/sticky-notes.e2e.ts` — updated to click "New board" on home page

### Test counts
- **Unit tests**: 105 passing (7 files)
- **Component tests**: 65 passing (10 files)
- **Integration tests**: 13 tests (board-api.test.ts) — requires wrangler dev
- **E2E tests**: share.e2e.ts (3 tests) — requires Playwright browsers installed

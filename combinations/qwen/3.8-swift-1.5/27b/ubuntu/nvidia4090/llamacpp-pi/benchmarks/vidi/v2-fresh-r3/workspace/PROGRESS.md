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

## Verification (all green)
- `npm run test:unit` — 81 passed
- `npm run test:component` — 45 passed
- `npm run test:integration` — 32 (workerd pool) + 19 (server) passed
- `npm run test:e2e` — 25 passed
- `npm run build` — ok
- `npm run typecheck` — clean

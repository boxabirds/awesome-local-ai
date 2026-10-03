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

## Verified

- `npm run build`, `npm run typecheck` — clean.
- `npm run test:unit` — 118 passed. `npm run test:component` — 102 passed.
- `npm run test:integration` — 56 passed, eleven consecutive clean runs (see NOTES.md for the
  two harness races that had to be fixed to get there: a log line arriving after a test file
  closed, and a convergence check taken at a single instant).
- `npm run test:e2e` — 37 passed on chromium; firefox and webkit projects are skipped by the
  config because this host lacks their system libraries and has no root. Nothing in story 5's
  design depends on them.

Two changes outside story 5's own files were needed, both in tests: the capacity test's
convergence wait (`tests/integration/board-room.test.ts`) and a short `afterAll` pause in the
two integration files that talk to real rooms (`worker.test.ts`, `board-room.test.ts`).
Rationale is in NOTES.md, under "Where the harness, not the product, was wrong".

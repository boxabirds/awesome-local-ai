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

## Where each task's tests are

- **Task 1** — `tests/unit/create-board.test.ts` (TC-04): id length and character
  set, 10,000 unique ids, generation through `crypto.getRandomValues`, and 10,000
  ids taken over two time windows showing no order or time derivation (mean
  Hamming distance over 100k pairs at least 100 of the 132 significant bits).
- **Tasks 2 and 3** — `tests/integration/board-api.test.ts` (TC-05 to TC-10,
  TC-12, TC-14, TC-15, TC-32) against real Worker, RPC and SQLite. Story 4's
  suites were adapted, not deleted: a board is opened through the API now, so a
  test that needs a *named* id calls the room's own `initialize` RPC
  (`initializeBoard` in `tests/integration/ws-client.ts`), and story 4's "did not
  read the board again" test now separates a read *of the board* from the question
  "is there a board at this address", which the store labels
  `/* board: exists? */`. The 400 that story 3 answered a malformed room id with
  became the 404 story 5 asks for (that suite's TC-04, in `worker.test.ts`).
- **Task 4** — the pages and the router: `src/client/router.ts` (the only file
  that reads or writes the address), `src/client/api.ts`,
  `src/client/sync/existence.ts` (the asking, with its doubling wait),
  `src/client/pages/{HomePage,BoardPage,NewBoardButton,NotFoundPage}.tsx`.
  Asserted by `tests/component/pages.test.tsx`: two pages and no URL reading in
  `src/client/pages/` (TC-16, TC-20), six not-addresses rendering the not-found
  page without a request (TC-19), two boards never sharing notes (TC-17), the
  retry waiting doubling and capped (TC-21). `renderBoard` in
  `tests/component/helpers/board.tsx` mounts `BoardSession` — the board without
  the asking — so story 1 and 2's viewport tests stay about the viewport.
  The browser suites of stories 1 to 4 were adapted in the same commit, because a
  board has to exist now: `tests/e2e/helpers/share.ts` adds `openFreshBoard`
  (home page, **New board**) and `createBoard` (`POST /api/boards` for specs that
  need the address before their first page opens).
- **Task 5** — `src/client/share/SharePanel.tsx` (`boardLink` and the panel: a
  readonly field holding the absolute link, **Copy link** → "Link copied" for
  `LINK_COPIED_MS`, the note "Anyone with this link can view and edit this
  board.", and the manual-copy message when the clipboard refuses). It sits in
  `BoardPage`'s header beside the link home. The words the board page uses while
  it is asking are the design's: "Opening board…" and "Couldn't reach vidi6.
  Retrying…" (`src/client/sync/existence.ts` also stops asking once the answer is
  definite — a board is never deleted, so asking twice about the same link would
  be two answers to one question).
- **Task 5 (partly, already)** — `index.html` carries `<meta name="referrer"
  content="no-referrer">`, asserted against the built document the Worker serves,
  at `/` and at `/b/<id>` (TC-32, `board-api.test.ts`).
- **Task 6** — `tests/component/SharePanel.test.tsx` (TC-22 to TC-25): the link is
  the board's own, the button says "Link copied" and reverts, a clipboard that
  refuses leaves the field selected and the manual message up, and the panel
  closes on Escape, on an outside click and on its own trigger with focus back on
  the trigger. `pages.test.tsx` holds the rest (TC-16, TC-17, TC-19 to TC-21).
- **Task 7** — `tests/e2e/share.spec.ts`, against `wrangler dev`:
  TC-26 creates a board through the UI, writes a note, copies the link (read back
  from the real clipboard where Chromium allows it), and a second visitor opens
  that link, edits the note and is answered by the first screen; TC-27 stands at a
  well-formed link that was never made (not-found, and no board made by the
  visit), then goes to a real board by the button; TC-28 blocks
  `/api/boards/*` and gets "Couldn't reach vidi6. Retrying…" — not "Board not
  found" — and opens on its own when the route is let through again, without a
  reload; TC-29 installs a clipboard that rejects and asserts the field is focused
  with the whole link selected; TC-31 opens a board that was made before links
  existed and finds its notes. The `wrangler dev` these specs run against is
  started with `--var TEST_HOOKS:1` (in `playwright.browsers.ts` and
  `tests/e2e/helpers/wrangler-process.ts`); production config never sets it.
- **Test hooks** — `/api/boards/:id/seed-legacy` (`src/worker/test-hooks.ts`) is
  compiled in but answers 404 unless `TEST_HOOKS=1`, which only the browser
  suites' `wrangler dev` sets; it writes real Yjs updates and no `created_at`, so
  a seeded board is legacy by storage facts and not by a flag (TC-31). The
  integration pool deliberately runs production config, where the hook refuses,
  so its legacy board is written through `BoardStore` and the log is read back
  into a document to prove the rows are usable (TC-08).
- **Not automated: story 5's TC-30** (a Durable Object reset while a board is
  idle — not to be confused with the `@nightly` soak that story 3 also calls TC-30,
  which runs and passes under `npm run test:e2e:nightly`). Nothing
  in `wrangler dev` resets an object on demand, and the nightly suite
  (`tests/e2e/nightly-stability.spec.ts`) already covers the observable promise —
  a board nobody is on is still there, and still the same board, when somebody
  comes back. Blocked rather than skipped silently: the platform behaviour itself
  is not reproducible on this machine.

# Story 5: final report from the Opus 5.5 subagent

Verbatim, apart from local paths replaced.

Story 5 is built, all test suites pass, and it's committed as `90faa01` with the message "story 5: Share a board with others using a link".

## What I built
- **Server:**
  - `POST /api/boards` creates a board with a 128-bit random id. It is limited to 10 per minute per visitor (keyed on `CF-Connecting-IP`) and tries up to 3 ids if one is already taken. It answers 201, 429 or 500.
  - `GET /api/boards/:id` answers 200, or 404 for both unknown and malformed ids.
  - Connecting to an unknown board now gets 404. Checking or connecting to an unknown link writes nothing to storage, so it creates no board.
  - Boards saved before this story still open. `created_at` is only written when a board is created.
  - Files: `src/worker/create-board.ts`, `board-room.ts` (new `initialize()` and `exists()`), `board-store.ts` and `index.ts`. `wrangler.jsonc` gets the `BOARD_CREATE_LIMITER` binding, and the six named settings are in `src/shared/config.ts`.
- **Client:**
  - A small router in `router.ts` and typed API calls in `api.ts`.
  - Home page with **Create a board** (shows "Creating…" while working, plus the failure and rate-limit messages).
  - Board page shows "Opening board…" while checking, then "Couldn't reach vidi6. Retrying…" with backoff if the service is down.
  - Board not found page with **Create a new board** and a link home.
  - Share panel with the exact PRD text, "Link copied" for 2 s, and the manual-copy fallback. It closes on Escape or an outside click, and focus goes back to Share.
  - `index.html` now has `no-referrer`, so board links aren't sent to other sites.
  - The story 1–4 board UI moved from `App.tsx` into `src/client/board/Board.tsx`. The old redirect from `/` to a random board is removed.
- **Tests:** all the design's cases are written — unit TC-01–04, integration TC-05–15 and TC-32, component TC-16–25, e2e TC-26–31 in `tests/e2e/share.spec.ts`. I also broke the code on purpose twice to check the tests catch it: removing the room's existence check fails TC-09, and removing the link selection in the fallback fails TC-23 and TC-24.

## Final results (build machine)
| Script | Result |
|---|---|
| `npm run build` | pass |
| `npm run typecheck` | pass (0 errors) |
| `npm run test:unit` | 112 passed / 0 failed |
| `npm run test:component` | 102 passed / 0 failed |
| `npm run test:integration` | 61 passed / 0 failed |
| `npm run test:e2e` (`E2E_BROWSERS=chromium,firefox`, `E2E_PORT=8877`) | 58 passed / 0 failed / 1 skipped (TC-26 in Firefox, which can't grant clipboard permissions) |

## Left undone
- **WebKit:** tasks.md also wants TC-27 and TC-29 run in WebKit. It still can't launch on the build machine, so they ran in Chromium and Firefox only.
- **Flaky Firefox test:** in one of two full e2e runs, story 3's 5-person live-editing test in Firefox missed its 1-second update budget. I put this down to load on the single shared local server, not this story. The next full run passed.
- **Red phase:** the new unit tests were not seen failing before the implementation; the two deliberate breaks above were the substitute check.

## Decisions noted in NOTES.md
- **Board component move:** earlier tests now render `<Board boardId=…>` instead of `<App/>`; no assertions changed.
- **Existence rule:** a board exists if it has `created_at` or any saved data. `initialize()` answers "exists" for boards saved before this story and writes nothing to them, so a new id can never land on an old board.
- **Test seams:** `createBoard` takes an optional third argument so tests can inject an id generator, a failing initialise or a limiter; production passes nothing. Its env type is structural so unit tests type-check without Worker types.
- **Extra HTTP details:** a missing visitor IP is keyed as `unknown`; the check route also accepts `HEAD`; 405 responses include an `Allow` header.
- **Real rate limiter:** the local runtime supports it, so integration and e2e tests use the real binding. Each test sends its own random visitor IP, so parallel tests don't share a budget.
- **New test-only routes:** `/__test/boards/:id/initialize` creates a board without the rate limit, and `/__test/boards/:id/seed-legacy` stores a board as it was saved before this story (used by TC-31).
- **Changed earlier tests:** the malformed-id test now expects 404 instead of 400, as the design says. Two other earlier tests create their board first, and the test helpers that open boards now create them.
- **`wrangler dev` stale connection:** one persistence test failed every time with `500 Network connection lost`. The dev proxy retries GETs but not POSTs when an idle connection goes stale. The test helper retries the idempotent `initialize` call up to 3 times. Production has no such proxy, but under `wrangler dev` a real Create a board click could hit this once.
- **Clipboard:** a missing API, a thrown error or a rejection all lead to manual copy. The tick is hidden from screen readers, so the button reads exactly "Link copied". Closing the panel resets the copied state.
- **Home link text:** "Go to the home page" (the PRD didn't give wording).
- **TC-04 statistics:** a chi-square over four-character prefixes is meaningless with 10,000 ids. Instead, each of the first 4 characters is checked for even spread (p > 0.001), and shared prefixes are bounded (at most 11 pairs, none shared by more than 3 ids).
- **TC-22 "https link":** the test environment's address is `http://localhost`, so the component test checks the link against the page's own address and checks `boardLink` with https separately. The real-browser TC-26 checks the pasted link opens the same board.

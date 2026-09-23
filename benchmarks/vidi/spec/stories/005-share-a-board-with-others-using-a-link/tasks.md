# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Write board creation unit tests first: retries, rate-limit config parity, id distribution (TC-01 to TC-04) | proposed | test:unit | share.board_api |
| 2 | Implement board API: POST /api/boards with rate limit and collision retry, GET existence, 404 for unknown rooms | proposed | implementation | share.board_api |
| 3 | Integration tests for board API against real Worker, RPC and SQLite (TC-05 to TC-15, TC-32) | proposed | test:integration | share.board_api |
| 4 | Implement router, API client, Home, Board (existence check with retry) and Board not found pages | proposed | implementation | share.pages |
| 5 | Implement Share panel with copy link and manual-copy fallback | proposed | implementation | share.share_panel |
| 6 | Component tests for pages and Share panel (TC-16 to TC-25) | proposed | test:ui-component | share.pages, share.share_panel |
| 7 | E2E share workflows: create-share-join, bad link, flaky service, clipboard blocked, rate limit, legacy board (TC-26 to TC-31) | proposed | test:e2e | share.board_api, share.pages, share.share_panel |

## Details

### 1. Write board creation unit tests first: retries, rate-limit config parity, id distribution (TC-01 to TC-04)

## Goal
Test-first unit coverage of share.board_api's pure logic: `createWithRetries`, rate-limit settings parity and link-code strength.

## Setup
- `config.ts`: BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS, CREATE_ID_MAX_ATTEMPTS, CREATE_BUDGET_MS, LINK_COPIED_MS, BOARD_CHECK_RETRY_BASE_MS.
- Stub `createWithRetries(generate, tryInitialize, maxAttempts)` and `Limiter` type in `create-board.ts`.

## Cases
- TC-01 generator yields taken, taken, free → returns third id after 3 `tryInitialize` calls (collision retry, share.unique).
- TC-02 generator yields taken CREATE_ID_MAX_ATTEMPTS times → `{ok:false}` after exactly that many attempts (boundary, error path → 500).
- TC-03 parse `wrangler.jsonc` `ratelimits` for BOARD_CREATE_LIMITER → limit equals BOARD_CREATE_LIMIT and period equals BOARD_CREATE_PERIOD_SECONDS (settings must not drift).
- TC-04 10,000 `newBoardId()` → all unique, all 22 chars from 16 random bytes (128 bits, share.unguessable); first-4-character prefix bucket counts pass a chi-square uniformity check (p > 0.001).

## Done when
Suite compiles; TC-01/02 fail with "not implemented"; committed.

### 2. Implement board API: POST /api/boards with rate limit and collision retry, GET existence, 404 for unknown rooms

## Goal
Implement share.board_api per contract and HTTP table.

## Approach
- `wrangler.jsonc`: `ratelimits` binding BOARD_CREATE_LIMITER (limit/period = named settings); compatibility date supporting Durable Object RPC.
- `create-board.ts`: `createWithRetries`; `createBoard(env, visitorKey)` → limiter `limit({key})` false → `rate_limited`; else retry loop over `newBoardId()` calling stub `initialize()`; exhausted or throw → `create_failed`.
- `index.ts`: `POST /api/boards` → key `CF-Connecting-IP` → 201 `{id}` / 429 / 500; other methods 405. `GET /api/boards/:id` → `isValidBoardId` false → 404 without touching namespace; else stub `exists()` → 200/404. `/api/rooms/:id`: malformed → 404 (was 400).
- `BoardRoom` RPC: `initialize()` → `store.migrate()`, set `created_at` if absent → `created`, else `exists`; `exists()` → `store.existsReadOnly()`. `fetch` returns 404 before accepting when not existing.
- `BoardStore`: `existsReadOnly()` checks `sqlite_master` first; true if `created_at` or any `updates`/`snapshot_chunks` rows (legacy boards). `load()` treats missing tables as empty without creating them; `migrate()` runs from `initialize()` and lazily before first `append()` — probing unknown links writes nothing.
- Ids stay 128-bit `newBoardId()`, never derived from time/counters.
- `index.html`: `<meta name="referrer" content="no-referrer">`.
- Remove story 3's `/` → random-id redirect.

## Done when
Tasks 5.1 and 5.3 pass.

### 3. Integration tests for board API against real Worker, RPC and SQLite (TC-05 to TC-15, TC-32)

## Goal
Verify share.board_api's HTTP contract, existence rule and no-write guarantee with the real Worker, Durable Object RPC and SQLite.

## Cases
- TC-05 POST → 201 id matching BOARD_ID_PATTERN; GET 200; `created_at` set.
- TC-06 GET fresh never-created id → 404; `sqlite_master` has no tables (no storage written, negative).
- TC-07 GET `abc` and a 23-char id → 404, RPC never called (negative).
- TC-08 legacy: seed `updates` row without `created_at` → GET 200.
- TC-09 WebSocket upgrade to unknown id → 404, no socket, no tables (negative).
- TC-10 upgrade after POST → 101 and story 3 sync works.
- TC-11 injected generator returns existing id then fresh → 201 fresh id; existing board's `created_at` unchanged (collision).
- TC-12 `initialize` throws → 500 `create_failed` (error path).
- TC-13 BOARD_CREATE_LIMIT + 1 POSTs same `CF-Connecting-IP` → first BOARD_CREATE_LIMIT 201, next 429; different IP still 201 (boundary). Use the real ratelimit binding if the local runtime supports it, else a fake implementing `Limiter` — document which in the file.
- TC-14 PUT /api/boards → 405.
- TC-15 `initialize()` twice → `created` then `exists`; `created_at` unchanged.
- TC-32 served index.html contains `<meta name="referrer" content="no-referrer">`.

## Done when
All pass in `npm run test:integration`.

### 4. Implement router, API client, Home, Board (existence check with retry) and Board not found pages

## Goal
Implement share.pages per contract and the Home/Board page state diagrams.

## Approach
- `router.ts`: `useRoute()` from `location.pathname` (`/` home, `/b/:id` board, else not_found), `navigate()` via `history.pushState` + popstate. No router library.
- `api.ts`: `createBoardRequest()` → created / rate_limited (429) / failed (5xx or network); `checkBoard(id)` → exists (200) / not_found (404) / unreachable (network or 5xx).
- `HomePage`: title, "A shared board for thinking together", Create a board button; Idle → Creating ("Creating…", disabled) → navigate on created; failed → "Couldn't create a board. Please try again."; rate_limited → "You're creating boards too quickly. Wait a minute and try again."; button re-enabled.
- `BoardPage({id})`: `isValidBoardId` false → NotFoundPage with no request; else "Opening board…" → `checkBoard`; exists → mount stories 1–4 board + `connectBoard`; not_found → NotFoundPage; unreachable → "Couldn't reach vidi6. Retrying…" with backoff from BOARD_CHECK_RETRY_BASE_MS capped at RECONNECT_MAX_BACKOFF_MS; timers cleared on unmount.
- `NotFoundPage`: "Board not found", guidance text, Create a new board (reuses create action), link home.

## Done when
Tasks 5.6 and 5.7 pass.

### 5. Implement Share panel with copy link and manual-copy fallback

## Goal
Implement share.share_panel per contract and its state diagram (Closed, Open, Copied, ManualCopy).

## Approach
- `boardLink(origin, id)` = `${origin}/b/${id}`.
- Share button top-right on BoardPage; panel `role=dialog aria-label="Share board"` with readonly input (click selects all), Copy link button, note "Anyone with this link can view and edit this board."
- Copy: `navigator.clipboard?.writeText(link)`; resolved → button "Link copied" with tick for LINK_COPIED_MS; missing API or rejected → select input, focus it, show "Press Ctrl+C (Cmd+C on Mac) to copy".
- Close on Escape and outside pointerdown; focus returns to Share button.
- Opening the copied link lands on BoardPage directly (no sign-in step).

## Done when
Tasks 5.6 and 5.7 pass.

### 6. Component tests for pages and Share panel (TC-16 to TC-25)

## Goal
jsdom tests of share.pages state machines (with mocked `api.ts`) and share.share_panel (stubbed clipboard, fake timers).

## share.pages
- TC-16 click Create → "Creating…" disabled → navigate to `/b/<id>`.
- TC-17 api failed (500 and network, 2 runs) → exact failure message, button enabled, still on `/` (negative: no navigation).
- TC-18 rate_limited → exact rate-limit message, button enabled.
- TC-19 `/b/bad` → NotFoundPage; `checkBoard` never called (negative).
- TC-20 not_found → "Opening board…" then NotFoundPage with Create a new board button.
- TC-21 unreachable twice then exists → "Couldn't reach vidi6. Retrying…" → board; retry after BOARD_CHECK_RETRY_BASE_MS then 2×; 3 calls total (boundary).

## share.share_panel
- TC-22 writeText resolves with full `https://…/b/<id>` link; "Link copied" visible at LINK_COPIED_MS − 1, reverted at LINK_COPIED_MS (boundary).
- TC-23 writeText rejects → input fully selected, manual-copy message (error path).
- TC-24 `navigator.clipboard` undefined → same as TC-23.
- TC-25 Escape closes; outside click closes; focus returns to Share button.

## Done when
All pass in `npm run test:component`.

### 7. E2E share workflows: create-share-join, bad link, flaky service, clipboard blocked, rate limit, legacy board (TC-26 to TC-31)

## Goal
End-to-end proof that the board API (share.board_api), pages (share.pages) and Share panel (share.share_panel) work together in real browsers against `wrangler dev`.

## Workflows
- TC-26 "Create, share, join" (chromium with clipboard permissions): Maya clicks Create a board → board visible within CREATE_BUDGET_MS (POST 201 + BoardPage exists path); adds a note; Share → Copy link → "Link copied"; Sam's new context opens the clipboard text → same board, sees note, edits it; Maya sees Sam's edit.
- TC-27 "Bad link recovery": open `/b/<newBoardId()>` never created → GET 404 → Board not found; click Create a new board → fresh empty board.
- TC-28 "Flaky service on open": `page.route('**/api/boards/*', abort)` → "Couldn't reach vidi6. Retrying…"; unroute → board opens without reload.
- TC-29 "Clipboard blocked": init script makes `writeText` reject → manual-copy message; selected text equals full link.
- TC-30 "Abuse guard": BOARD_CREATE_LIMIT + 1 creations → last shows rate-limit message (429 path).
- TC-31 "Pre-existing board": seed a legacy board (updates rows, no created_at) via TEST_HOOKS-only route in `test-hooks.ts`; open its link → board with seeded notes, not Board not found.

## Done when
All pass in chromium; TC-27 and TC-29 also in firefox and webkit.


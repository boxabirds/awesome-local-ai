# Story 3 — Live collaboration (see other people's edits appear live)

Implementation of `sync.worker_entry`, `sync.room`, and `sync.client`: a BoardRoom
Durable Object per board relaying Yjs sync + awareness over WebSockets, and the
browser `WebsocketProvider` connection with a derived status badge.

## Test totals (all passing)

- **unit** — board id (`TC-01/02`), protocol decode (`TC-03`), connectBoard
  backoff/url wiring — `tests/unit` (run in `npm test`)
- **component** — connection status badge state machine `TC-19/20/21` — `tests/component`
- **integration** (workerd, `@cloudflare/vitest-pool-workers`) — `TC-04..06, 13, 17`
  (worker routing) and `TC-07..12, 14..16, 18, 31` (BoardRoom relay/merge/error) — `tests/integration`
- **e2e (per commit)** — `TC-22..28` plus supplemental drop/recovery & multitab — `tests/e2e`
- **e2e (nightly)** — `TC-29` idle stability, `TC-30` capacity soak — `tests/e2e/nightly`

## Design decisions honoured

- **`MAX_CONCURRENT_EDITORS` is soft and never enforced** (design `live.over_capacity`,
  worker entry comment). There is no connection-limit check and **no `4403` close**; the
  only server-initiated close is `CLOSE_UNSUPPORTED_DATA` (`1003`) on a malformed frame.
  The "6th participant must not be refused" property is integration **TC-13**
  (`MAX_CONCURRENT_EDITORS + 1` sockets all get 101 and the last writer's note reaches all).
- **Awareness is relayed verbatim to every socket including the sender.** This keeps idle
  `y-websocket` clients receiving traffic so their no-message timeout never fires; proven
  by nightly **TC-29** (45 s idle, badge never shows Reconnecting).
- **`disableBc: true`** in `connectBoard` so same-browser tabs cannot sync around the
  server — the room is the single relay (multitab supplemental test).
- **Status badge** (`connecting / reconnecting / confirmed / connected`): `connected`
  renders nothing; a reconnect flashes `Connected` for `CONNECTED_CONFIRMATION_MS` then
  hides. First-ever sync goes straight to `connected` (no initial flash).
- **Selection/editing stay local** — never in the Y.Doc; a selection on one board does not
  appear on another (e2e **TC-28**).

## Test-harness notes

- **Integration: `singleWorker: true` + `isolatedStorage: false`.** The deeply-nested
  workspace path exceeds macOS's 255-byte filename limit when vitest-pool-workers builds a
  per-test Durable Object SQLite directory name; sharing one worker/isolated storage avoids
  it. Tests therefore run serially within the integration project.
- **`statusText` is not preserved** through workerd's internal `SELF.fetch`; integration
  assertions check numeric status codes only.
- **`listDurableObjectIds()` resolves to an Array (thenable), not an async iterable.**
- WebSocket integration/e2e tests use `response.webSocket.accept()` on a real `SELF.fetch`
  upgrade, and the real `y-protocols` framing — no protocol mocks. The only stub is the
  transport-level `WebSocketPolyfill`.
- **`origin === client` guard** in the integration `RoomClient` mirrors y-websocket's
  `origin !== this` so a client's own update is not fed back to it (echo suppression, TC-08).

## TC-23: why we assert convergence, not "every typed character survives"

`StickyTextEditor` (story 2) seeds its textarea on mount and, on every `input`, writes its
whole local value to `Y.Text` via `applyTextDiff`. It does **not** `observe` remote `Y.Text`
changes mid-edit. So when two browsers type into the same note simultaneously, each side's
commit can clobber the other's not-yet-landed characters — the Y.Doc still converges to one
identical value (Yjs guarantees convergence) but the merged text does not necessarily retain
*every* typed character contiguously.

- e2e **TC-23** therefore asserts the contract that is actually observable through this
  editor: both pages converge to the **same** note text within the latency budget, and that
  text has moved past the seed (the live merge propagated).
- Correct **character-level** concurrent-merge behaviour (both edits' characters preserved)
  is verified deterministically at the **document** layer by integration **TC-09** (text
  insert merge) and **TC-12** (200 seeded random ops × 5 clients → identical snapshots).

A future story that swaps in an observe-based text binding (y-textarea/prosemirror) could
tighten TC-23 to assert every typed character; that editor change is out of scope for
story 3.

## Test-only connection hooks (test build only)

`window.__vidi6` exposes, only when `import.meta.env.MODE === 'test'`:
- `simulateDrop()` → `provider.disconnect()` (the badge goes `reconnecting` and **stays**
  down because `disconnect()` clears `shouldConnect`, so `setupWS`'s `shouldConnect &&
  ws === null` guard makes any scheduled reconnect a no-op).
- `restoreConnection()` → `provider.connect()` — a real reconnect + resync (badge flashes
  `connected`).
- `connectionState` — the badge's mapped state, read by nightly TC-29.
- `setCamera()` — pre-existing (story 2) far-travel hook.

`provider.ws.close()` is **not** used to simulate a drop: under `wrangler dev` the socket
can sit in `CLOSING` without firing `onclose`, so `disconnect()`/`connect()` (which drive
`closeWebsocketConnection` synchronously) are used instead.

## Nightly results (recorded per tasks.md)

Run: `npm run test:e2e:nightly` (chromium, one machine, model + browsers + wrangler dev at once).

- **TC-29 idle stability — PASS** (45.6 s). With two connected contexts idle for 45 s, the
  ConnectionStatus badge never rendered a `reconnecting` state and the mapped
  `connectionState` stayed `connected` throughout — the room's awareness relay keeps the
  sockets alive and `maxBackoffTime`/`disableBc` are correct.
- **TC-30 capacity soak — PASS** (48.4 s). 5 contexts (`MAX_CONCURRENT_EDITORS`), continuous
  UI edits; **603 rounds / 2412 latency samples**; **p50 = 6 ms, p95 = 23 ms, max = 48 ms**
  against `LIVE_UPDATE_LATENCY_BUDGET_MS = 1000 ms`. Every per-change latency within budget,
  every badge stayed hidden (`connected`), and all five final board snapshots were identical.

---

# Story 5 — Share a board with others using a link

Implementation of `share.board_api`, `share.room`, `share.link_only_entry`,
`share.client_routes`, `share.panel` and `share.abuse_guard`: `POST /api/boards` (create,
with the creation rate limit in front of it), `GET /api/boards/:id` (existence, read-only),
a 404 in front of every link that leads nowhere, a client router that decides the page
from the URL, and a Share panel that puts the link on the clipboard.

## Test totals (all passing)

- **unit** (136) — `createBoard` retry ladder with a injected generator (`TC-01..04`),
  the character set a board id comes from, and every link shape routed to which page.
- **component** (62) — the real App rendered at a URL: creating / failed / limited /
  bad-link / unreachable-then-open (`TC-16..21`), and the Share panel's copy, fallback,
  focus and link contents (`TC-22..25`).
- **integration** (58, workerd) — `TC-05..15`, `TC-32` plus the rate limit's boundary
  (10 accepted, the 11th refused inside one period) and a period that resets.
- **e2e** — `npm run test:e2e` 69 passed (chromium + firefox + webkit), `test:e2e:persistence`
  4 passed, `test:e2e:share` 10 passed (6 chromium, plus `TC-27`/`TC-29` in firefox and
  webkit), `test:e2e:nightly` 2 passed (unchanged).

## Creating a board in a test: which path, and why

`POST /api/boards` is the only production way to create a board, and it is metered at
`BOARD_CREATE_LIMIT_PER_MINUTE = 10` **per Durable Object instance**, i.e. per `wrangler dev`
process. So:

- Component tests never touch a limiter: they intercept `fetch`.
- Integration tests get a limiter of their own per test (`env.BOARD_CREATE_LIMITER = stub`),
  because the design's TC-05..TC-11 are about the endpoint, not the guard.
- E2E creates through the existing test-only hook — `POST /__test/boards/:id/initialize`,
  which calls the same `BoardRoom.initialize()` the endpoint calls, minus the limiter. The
  suites create far more than ten boards a minute between them, and a limiter that only
  exists to be measured by TC-30 must not be spent by other tests.
- **TC-30 runs against its own `wrangler dev` process** (started by the test, on its own
  `--persist-to` directory), so ten creations are ten creations and the eleventh is the
  eleventh. Same reason story 4's persistence suite owns its process.
- TC-31's legacy board uses the second hook action, `seed-legacy`: content rows without
  `created_at`, which is exactly the state a board created before this story was in.

## Two gaps the tests found in the product

1. **"Create a new board" on the Board-not-found page only went home.** The PRD asks the
   page for a way to *create* a board, and the acceptance says the board opens. The home
   page's create action was extracted into `src/client/pages/useCreateBoard.ts` and both
   pages call it — one create path in the product, not two that can drift.
2. **The Share panel did not give focus back.** Spec: after closing, focus goes back to the
   Share button. The panel is now `role="dialog"` `aria-label="Share board"` and returns
   focus on Escape *and* on outside click; the button is wrapped in a persistent element so
   it is still mounted to receive focus.

## Clipboard in Firefox and WebKit

`context.grantPermissions(['clipboard-read', 'clipboard-write'])` throws on Firefox
("Unknown permission") and WebKit — those engines have no such permission to hand out.
`grantClipboardPermissions` swallows exactly that error and nothing else. Chromium remains
the engine that reads a link back out of the real clipboard (TC-26); firefox/webkit run
TC-27 and TC-29, and TC-29 deliberately makes `writeText` reject, which needs no permission.

## A socket no longer creates a board (affects stories 1-4's tests)

`BoardRoom.fetch` now answers 404 for a board that does not exist, before accepting the
WebSocket. Consequence for existing suites: the Node-side `RawClient` collaborators that
seed boards must create the board first. `tests/e2e/helpers/board.ts` gained
`ensureBoard(boardId, origin?)` (a worker-side `fetch` to the test hook, so `page.route()`
interception cannot see setup traffic), and the nightly webServer passes
`--var VIDI_TEST_HOOKS:1` like the other configs. Future stories: a board is something you
create, not something you connect to.

## Board check backoff shares one ceiling

`BOARD_CHECK_RETRY_BASE_MS` doubles up to `RECONNECT_MAX_BACKOFF_MS` — the spec names that
constant. An earlier cut had a separate `BOARD_CHECK_RETRY_MAX_MS`; the second constant
would only have existed to be configured out of sync with the first.

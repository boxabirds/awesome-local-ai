# Notes: Story 3 — live collaboration

## Deviations from the design

### Integration tests use a real `wrangler dev` server, not `SELF.fetch`

The design has the Worker/Durable Object tests call `SELF.fetch` inside
`@cloudflare/vitest-pool-workers` (workerd). That works for HTTP, but the pool's
loopback service cannot carry a WebSocket conversation: the upgrade succeeds and
exactly one frame gets through in each direction, after which the socket goes
silent (each `SELF.fetch` lives in its own request context, which is gone before
the conversation starts). Everything this story has to test about the room —
sync handshake, broadcast, catch-up — needs a real conversation.

So the test projects are split:

- `integration` (workerd pool, `tests/integration/worker.test.ts`): the real
  Worker `fetch` handler with the real `wrangler.jsonc` bindings, for HTTP
  behaviour — TC-04 (invalid id → 400, Durable Object never touched, asserted
  with a `BOARD_ROOM` proxy that records `idFromName`), TC-05 (no `Upgrade` →
  426), TC-06 (SPA fallback for `/b/:boardId`).
- `live` (Node, `tests/integration/board-room.test.ts`): TC-13, TC-17 and
  TC-07…TC-18, TC-31 against a real `wrangler dev` instance started in-process
  with `unstable_dev` (`tests/integration/helpers/live-server.ts`, port
  `VIDI6_LIVE_PORT ?? 28741`). The Worker, the `BoardRoom`, its `Y.Doc` and the
  assets all run unmocked inside workerd; the test client is a real `Y.Doc`
  speaking real `y-protocols` framing over a real WebSocket. The design's
  "WebSocket obtained from a `SELF.fetch` upgrade response" is the only part
  that changed; nothing about the room is mocked.

Consequences of the split:

- `compatibility_date` in `wrangler.jsonc` is pinned to `2026-08-15` — the
  newest date both the `wrangler` binary and the runtime bundled with
  `@cloudflare/vitest-pool-workers` accept (`2026-09-01` makes the pool refuse to
  start).
- TC-13 and TC-17 are listed under `sync.worker_entry` in the design but need
  open sockets, so they live in `board-room.test.ts` (documented in its header).
- TC-18 ("restart with all sockets closed") cannot call
  `evictDurableObject()` from the Node project. It instead uses a brand-new
  board id, which is a room object whose `Y.Doc` just was created — i.e. exactly
  the state after a runtime restart that discarded the in-memory doc — and is
  verified to be empty with a probe client before the first client reconnects to
  it.
- `npm run test:integration` builds the client (the Worker serves it from assets)
  and runs both projects.

## Decisions

### Binary frames arrive as `Blob` in the Workers runtime

`MessageEvent.data` for a binary WebSocket message inside a Worker is a `Blob`,
not an `ArrayBuffer`. `BoardRoom.fetch` sets `server.binaryType = 'arraybuffer'`
before `accept()`; `decodeMessage` additionally accepts a `Uint8Array` so it
cannot be tripped up by runtime differences.

### `readSyncMessage` does not report broken Yjs updates

`y-protocols` catches errors from `Y.applyUpdate` inside `readSyncStep2` /
`readUpdate` and only reports them to its optional `errorHandler` (after
`console.error`-ing them). The room passes that handler, so a payload that is not
a decodable Yjs update closes the offending socket with 1003 like any other
malformed traffic; without it the room would silently ignore corrupt updates.
The y-protocols log line during TC-15 is therefore expected output.

### Non-hibernating sockets on purpose

`BoardRoom` uses `WebSocketPair` + `accept()` and keeps sockets in a `Set`.
Hibernation would let workerd evict the object while sockets stay open, and the
`Y.Doc` — which has no storage until story 4 — would be lost with it. An open,
accepted socket keeps the object alive, which is the behaviour story 3 needs
("notes are not lost while one person keeps the board open"). Story 4 switches
to `acceptWebSocket` + `setStateCallback` together with persistence; the sync and
awareness handling moves over unchanged.

The room also sends SyncStep1 to each newcomer (not only answering the
client's): that is the mechanism that lets the first client back repopulate a
room that lost its doc, without depending on the client provider's own sync step.

### Awareness is relayed, not interpreted

Awareness frames are forwarded verbatim to every socket *including* the sender,
which keeps idle clients receiving traffic (TC-16 asserts sender and receiver get
byte-identical payloads). `QueryAwareness` (frame type 3) is accepted and ignored
— there is no awareness state to answer with until story 6 — and the test
asserts that no reply is produced.

## Findings worth remembering

- `lib0`'s `writeUint8Array` appends raw bytes; `writeVarUint8Array` is the
  length-prefixed one. `syncProtocol.writeUpdate` does its own length prefix, so
  a sync frame is `varUint(0)` + `varUint(2)` + `varUint(len)` + update.
- The room's broadcast skips the socket an update came from by comparing the
  `origin` that `Y.Doc` reports, so no client ever receives an echo of its own
  change (TC-08).
- `Y.Doc.toJSON()` is not a reliable read of a freshly-synced document: until a
  shared type has been accessed at least once, `toJSON()` reports it as
  `undefined`, so `JSON.stringify(doc.toJSON())` is `{}` for a doc that plainly
  contains data (verified with yjs 13.6.33 on Node). Every
  test compares boards with `snapshot()` from `board-model`, which materialises
  and reads the `objects` `Y.Map` directly.

### The status mapping is exported separately from `connectBoard`

`connectBoard` only exists to build a real `WebsocketProvider`; the interesting
part — provider events → `ConnectionState` — is `observeConnectionStatus`, which
takes the two events the mapping listens to (`status`, `sync`) from any emitter.
That is the fake the design asks for in the badge tests, and it means TC-19 to
TC-21 run without a socket. One detail the design's wording leaves open: a real
provider reports `connected` a moment *before* the board's content has arrived,
so `connecting` ends on `sync(true)`, not on `status: 'connected'` — otherwise
the badge would disappear before the notes are on the screen.

### Component tests need a room, because the app connects on render

`useBoardDoc` attaches a provider as soon as the board renders, so every
component test that renders `App` opens a WebSocket — and jsdom has no server to
open one against. `tests/component/standInRoom.ts` stands in for the room: real
`decodeMessage`, real `y-protocols`, real `Y.Doc`, only the socket transport
replaced. It syncs, relays between sockets, closes unreadable frames, and can cut
its connections so a test can watch the page react to an outage (TC-22 negative).
It is installed in `tests/component/setup.ts` and reset before every test so one
test cannot see another's notes.

`renderBoard()` now navigates to `/b/<new board id>` first: the address decides
which board a page connects to, and at `/` the page redirects instead of
rendering. `tests/e2e/helpers/board.ts` does the same, which also keeps the
story-2 e2e specs off a page-load race with that redirect.

### The badge's test hooks log every state, and count sockets

The design asks for `window.__vidi6.connectionState` so a nightly test can check the
mapped state while a board sits idle. A single value read by polling can miss a state
that arrived and left between two reads, which is exactly the failure worth catching,
so the test build also exposes `connectionStates()` (every state, oldest first —
`useBoardDoc` pushes each one as it happens) plus `connectionAttempts()` and
`disconnectBoard()`. The last two exist for the design's teardown point: a test can
destroy the connection the way leaving the board does and check no further socket is
opened. Note that `WebsocketProvider` dials from inside its own constructor, before any
listener can be attached, so the attempt count starts at one rather than zero.

## Running the nightly tests

`npm run test:e2e:nightly` (`VIDI6_NIGHTLY=1 playwright test --grep @nightly`). Long
cases are tagged `@nightly` and `playwright.config.ts` sets
`grepInvert: /@nightly/` unless `VIDI6_NIGHTLY` is set, so an ordinary
`npm run test:e2e` never waits on them. TC-29 idles for 45 s — longer than the
provider's own 30 s tolerance for a silent connection, which is the point: the room
relays awareness to everyone including the sender, so traffic keeps flowing and the
badge never has anything to say.

## Running the nightly soak without the tests falling over

TC-30 puts five browser contexts on one board, each editing continuously for a minute
(~1,600 changes on a quiet run). Four things about that setup are not obvious and each
one cost a debugging round:

- **"Which note did I just create?" cannot be answered by diffing ids.** Story 2's
  `createNoteByDblClick` compares the note ids before and after the double-click and
  insists exactly one is new — true when one person works, false when five do, because
  somebody else's note lands in the same gap. `createNoteAt` (in
  `tests/e2e/helpers/live.ts`) picks the new note by *where* it is: the one that
  appeared centred under the pointer.
- **A selected note's toolbar covers the note above it.** `.note-toolbar-anchor` is
  `position: fixed` with `translateY(-100%)`, so it floats over whatever is ~36 px above
  the selected note — another note, if rows are packed tightly, and then a click there
  waits out the action timeout. The soak gives each writer a single row with 150 px
  between rows, and limits each drag to 6 px with the note pulled back toward where it
  was created, so notes never drift onto their neighbours (a covered click, and a drag
  that grabs the wrong note).
- **Clicking a toolbar button with a real mouse can hang on a busy board.** Playwright
  retries a click until the element is stable and still attached; the toolbar's row is
  re-rendered as other people's changes stream in, and three of five participants
  eventually sat in that retry loop until the test timed out. `pressNoteToolbarButton`
  dispatches the press on the button itself — the app's own `onClick`, with no
  hit-testing. Everything else in the soak (double-clicks, drags, typing) is a real
  input.
- **Chrome reports a console error for every socket it cannot connect.** Cutting the
  network on purpose (TC-27) therefore fills the error list with
  `ERR_INTERNET_DISCONNECTED`, which is the outage talking rather than the app.
  `expectNoErrors` filters that pattern and nothing else.

`VIDI6_SOAK_MS` shortens the soak (and `VIDI6_SOAK_TRACE=1` prints each participant's
step timings) — both are for working on the test, not for CI. TC-30's own timeout is
150 s, close to what a minute of editing plus the checks needs, so a hang fails loudly
instead of idling for four minutes.

## What the latency actually looks like here

Reported, never asserted (one machine runs the server, five browsers and the test
runner). Nightly runs on this host, against `LIVE_UPDATE_LATENCY_BUDGET_MS = 1000`:

| run | changes | p50 | p95 | max |
|---|---|---|---|---|
| TC-30, 60 s, 5 people | 1,602–1,623 | 135–142 ms | 430–442 ms | 578–615 ms |
| TC-29, first change after 45 s idle | 1 | 2–4 ms | — | — |

Two-person e2e cases (TC-22 to TC-28) land in the 4–30 ms range; the soak's p95 grows
with the number of simultaneous writers, which is what you would expect from a relay
that fans every update out to everyone.

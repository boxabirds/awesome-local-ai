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

---

# Notes: Story 4 — returning to a board

## Deviations from the design

### TC-18 cannot evict a Durable Object that is holding sockets, on this toolchain

The design says: hibernate, `evictDurableObject()` the object, and show that the
sockets are still there afterwards. On this machine (`@cloudflare/vitest-pool-workers`
0.22 and the workerd it bundles) that route does not exist:

- `evictDurableObject()` on an object with an open hibernatable WebSocket never
  returns. Probed both ways: socket created from an upgrade request, and socket
  created by hand from a `WebSocketPair` with a peer held by the test.
- `ctx.abort()` — the other way to force eviction — closes those sockets: their
  `readyState` is 3 by the time the object comes back.
- `evictDurableObject()` on an object that has never been instantiated hangs too,
  and interleaving `room.fetch()` with evict-and-wake hangs even when it is awake.
  `runInDurableObject()` is the reliable wake: it runs the constructor, which is
  where the load happens.

So `tests/integration/room-hibernation.test.ts` proves the two things eviction was a
stand-in for, without it:

- **the room has no audience of its own.** After one accepted socket and one stored
  change, `room.socketCount()` still equals `ctx.getWebSockets().length`. There is no
  private list for hibernation to lose, which is the property the design wanted.
- **a room that comes back finds the connections that are really there** — in the
  `live` project, after `ctx.abort()`: a newcomer is the room's only socket
  (`sockets: 1`), gets the board's 25 notes, and a third client joining the rebuilt
  room receives a change the newcomer makes. That project also shows PING answered
  with PONG and no app code running, which is the runtime's own hibernation doing its
  job.

### There is no `loads` counter in `StorageSummary`

The design's status block lists "reads of this board". TC-25 in the same story says
opening an untouched board must write nothing, and a counter that goes up when you
read contradicts it. It is also unnecessary: the durable evidence that a woken room
did *not* read its board is the `load_failed_at` timestamp, because a read that fails
rewrites it and a read that succeeds deletes it. TC-16 asserts that timestamp
unchanged across three wake-ups, then aged past `LOAD_RETRY_MIN_INTERVAL_MS`, then
gone, with the room's state back to `ready`.

### Room-persistence tests are split across two projects

Anything that needs real sockets is in `live` (`tests/integration/board-room-persistence
.test.ts`), anything that needs the clock is in the workerd pool
(`tests/integration/room-hibernation.test.ts`). That is because Miniflare's clock jumps
by about ten seconds whenever a socketless Durable Object is evicted during a WebSocket
close — production workerd does not do this, and a test in the live project that reads
a timestamp would sometimes see the future. `boardStats()` on a live server therefore
reports `updates` only.

### Tasks 7 and 8 were done in one pass, not test-first

tasks.md asks for the client tests before the client state. The state machine, its
badge and its lock went in together with the tests that pin them. Nothing was learned
late that a different order would have caught earlier, but it is a deviation.

## Decisions

### What a refusal costs

- A board that cannot be read closes the joining socket with **4500**; the client maps
  that one code to `load_failed`. **1011** (the room's storage failed mid-change) and
  **1003** (frames it cannot read) stay `reconnecting`: the board is readable, this
  page's edits are kept, and the promise that the wait is temporary is true.
- The client's `load_failed` is **sticky until content arrives**. Status events from
  the provider's retries are ignored while it is set, because "Connecting…" would be
  a promise about a board that is not on its way. Two facts about `y-websocket` make
  this work and were checked in `node_modules/y-websocket/src/y-websocket.js`: its
  band of "do not retry" codes is 4400–4499, so 4500 retries on its own; and
  `connection-close` is emitted only for a socket that had opened — the room accepts
  before it closes, so the code always reaches the page.
- The room's retry gate is a timestamp in storage, and a *refused* join does not move
  it. A page hammering a broken board must not postpone its own recovery.

### Where the edit lock lives

In the places a write enters the document — double-click on the board, the Delete key,
the note toolbar's colour and delete, `StickyNote`'s drag and its double-click, the
text editor as `readOnly` — plus the toolbar button's `disabled` attribute. Not by
hiding the board or the tools: TC-23 asserts the *document* is byte-for-byte
unchanged after every attempted edit, and recovery is asserted by trying them again in
the same, un-reloaded page.

## Findings worth remembering (`wrangler dev`, workerd)

- `--persist-to <dir>` puts DO SQLite on disk and survives `SIGKILL`; the WAL
  recovery on restart is exactly what TC-19 leans on.
- `wrangler dev --var NAME:value` (colon, not `=`) injects a variable. The e2e server
  passes `TEST_HOOKS:1`; the same command without it answers `/__test/...` with the
  SPA fallback, which `broken-board.spec.ts` asserts rather than assumes.
- Stopping `wrangler dev` means stopping its process group: `spawn(..., { detached:
  true })` and `process.kill(-pid, 'SIGKILL')`. workerd is a child of the wrangler
  process, and killing only the parent leaves the port occupied.
- A `WebSocketPair` created *inside* a Durable Object does not deliver frames to its
  peer half in the vitest pool. You cannot watch a frame arrive at a socket you made
  yourself; you can only count what the runtime holds.
- A note created by double-click opens straight into editing. A component test that
  drags "the note just created" is dragging a textarea; drag one that has been sitting
  there.

## What the timings look like here

| measurement | on this machine |
|---|---|
| TC-21: `PERSIST_TESTED_NOTES` (2000) notes, compacted into chunks, room aborted, until every note is rendered in Chromium | ~900 ms against `BOARD_LOAD_BUDGET_MS = 3000` — reported, not asserted, because one host runs the Worker, the browser and the runner |
| TC-20: from "the second person has seen the note" to "the process is gone" | 11–14 ms, and the note came back |
| TC-24: damaged snapshot → red message, and repair → board back on the page's own retries | ~2 s to the message; the recovery waits out `LOAD_RETRY_MIN_INTERVAL_MS` plus the provider's backoff |

## Ports used by the suites

28736/28737 the shared e2e server (`npm run e2e:serve`), 28741 the live integration
server, 28744/28745 each persistence case's own `wrangler dev`, 28746 the
"deployment without `TEST_HOOKS`" server. The persistence cases run serially
(`test.describe.configure({ mode: 'serial' })`) because they share 28744; they can
still run alongside the browser cases, which never touch that port.

# Notes: Story 5 — sharing a board by link

## Deviations from the design

### Story 3's 400 for a malformed room address becomes 404 (test updated)

`design.md`'s HTTP table asks for this by name ("story 3's 400 becomes 404"), so
`tests/integration/worker.test.ts` TC-04 changed: both assertions, and the test title.
What the case is really guarding is untouched and still asserted — `idFromName` is never
called for a malformed address, so no object is instantiated. The status is the part the
new story has an opinion about: answering `400 Invalid board id` to somebody walking the
namespace tells them which guesses are well formed, and a link code is supposed to be the
thing that cannot be probed (share.unguessable).

### The live integration tests now create the board they join

`tests/integration/helpers/hooks.ts` gained `ensureBoard()`, called once from `join()` in
`board-room.test.ts` and `board-room-persistence.test.ts` (27 tests). Story 5's central
rule — nobody gets onto a board that was never created — breaks the old habit of
inventing an id and connecting to it, and that is the story working as intended.

The alternative was to let the live server accept unknown rooms, which would have meant
the rule is never tested where the real sockets are. So the tests ask for boards, through
the test-only route that calls the *same* `initialize()` `POST /api/boards` calls: the
board that turns up is built the normal way, and only its address comes from the test —
which is the one thing the real API deliberately never offers.

### The e2e helpers create boards instead of inventing addresses

- `helpers/board.ts`'s `openBoard()` goes to `/` and presses **New board**, and returns the
  id it landed on; it does nothing if the page is already on a board, so a helper called
  later in the same test cannot quietly make a second one.
- `helpers/live.ts`'s `liveBoards.open` POSTs `/api/boards` with Playwright's `request`.
- `persistence.spec.ts` TC-19 and TC-20 use `createBoardAt(board.origin)`.
- Anything that *seeds* (`TC-21`, `TC-24`, share `TC-31`) still seeds: those cases are
  about a board that already has content on disk, which is a different thing from a board
  that exists.

### The component harness mounts the board, not the whole app

`boardHarness.renderBoard()` renders `BoardSurface` instead of `<App/>`. Story 5 put a
question to the server between an address and a board, and a component test has no server
— so mounting the app there would spend 71 story 1–4 tests waiting on a request instead of
looking at the board. No assertion in those files changed. The address, the check and the
pages are covered by `pages.test.tsx` (jsdom) and `share.spec.ts` (real server), which is
where those things belong.

### The pages tests stub `fetch`, not `api.ts`

The design's D2 says "mocked api". Stubbing one level lower keeps `api.ts`'s status
mapping inside the test, which is where the interesting mistake lives: a 500 read as a 404
would tell a person their board is gone when all that happened is a bad moment on the
network (share.unreachable). TC-19's "no request was made" is asserted over the recorded
URLs, which says more than "the mock was not called".

### TC-26 is chromium-only, and this host has only chromium

`clipboard-read` is not a grantable permission in the other two browsers, so that case
skips by project name. Separately, firefox and webkit cannot start here at all (missing
system libraries; `playwright.config.ts` probes and reports it), so TC-27 and TC-29's
"also in firefox and webkit" was verified in chromium only. Nothing those two cases touch
is chromium-specific: a 404, a read-only field, and a rejected promise.

### `nextBoardPageState` takes the board id as a fourth argument

The design's signature is (state, event, now). The `ready` state has to carry the id for
the board to mount, and a state machine that read `window.location` to get it would not be
a state machine.

## Decisions

### A board exists when it was created, or when it has content

`storage_meta.created_at` is the fact. Rows in `updates` or `snapshot_chunks` are the
fallback for boards written before this story existed, so nobody is locked out of work they
already have (share.legacy_boards). Empty tables are neither: they are what a probe leaves
behind if you are not careful, and treating them as content would make the first guess
create the thing it was looking for.

### Probing writes nothing, at every layer

- a malformed address is answered without naming a Durable Object at all;
- `exists()` is a read of `sqlite_master` plus at most three `COUNT`s;
- `load()` treats "no tables" as an empty board instead of migrating, `migrate()` runs
  from `initialize()`, and `append()` makes the tables lazily for a board that predates
  them;
- the room returns 404 *before* accepting a WebSocket, so a socket is never half-open on a
  board that does not exist.

This is why story 4's `load()` no longer "just works": making a question harmless meant
threading "this board may not exist" through every place that had assumed it did —
`health()`, `summary()`, `recordLoadSuccess()`, the chunk reader. Each of those guards is
a one-line early return, and together they are the difference between a share link and a
way to fill a database with empty boards.

### `initialize()` is the only thing that stamps a board

One write of `created_at`, and it returns `created` or `exists`; a second call changes
nothing, the timestamp included (TC-15). Creation is therefore not repeatable, and an
accidental double POST cannot reset a board somebody is already working on.

### Creation is one RPC, with no retry loop

128-bit ids do not collide in practice. If one ever did, `initialize()` would answer
`exists` for an id we did not make, and the API says 500 `create_failed` — which is the
honest answer, and strictly better than the alternative of opening a board someone else
made and showing it as yours.

### Everything under `/api/boards` belongs to the boards handler

`/api/boardsfoo` is a 404, not the web page: a path that starts like our API should not be
answered with HTML. `OPTIONS` and every other method are 405 with an `Allow` header. This
is not a CORS service — the client is the only caller and is same-origin — so there is no
preflight to support, and "no, and here is what this address does" is the useful answer.

### The copied confirmation ends by reverting, not by closing

`Copied → Open` after `LINK_COPIED_MS`, as in the design's diagram, with the panel still
open. The person has just copied a link and is about to paste it somewhere; a panel that
vanished, and moved focus back to a button, in the middle of that would be the one
annoying thing this feature could do. Escape and an outside click remain the only ways out.

### The link is `${window.location.origin}/b/${id}`

Same-origin by construction, so `location.origin` is exactly what the address bar shows —
behind any host, port or proxy prefix, with no configuration to get wrong and nothing to
keep in step.

### Stories 6 and 13–17 stay out of this

No presence, no board list, no hooks. The Share panel answers one question — how do I get
somebody else onto this board — and a panel that also offered membership management would
be a different story's UI.

## Findings worth remembering

- In the `vitest-pool-workers` pool, `SELF.fetch` with `Upgrade: websocket` headers returns
  the *right status* — 101 for a board that exists, 404 for one that does not — but
  `response.webSocket` is `null` in both cases. So TC-09 asserts "404 and no tables", and
  "sync works after a POST" (TC-10) is carried by the live project's joins. Story 3's note
  about the pool's loopback still stands.
- `sql.exec` against a Durable Object whose SQLite has never been created throws rather
  than returning no rows. Existence has to ask `sqlite_master` first.
- `Object.assign(navigator, { clipboard })` does nothing: `clipboard` is an accessor on
  `Navigator.prototype`. Both the component test and the e2e init script redefine it there
  with `configurable: true`.
- `{'✓'} {'Link copied'}` has no space in `textContent` — JSX drops whitespace between
  expressions. (This repo has no jest-dom, so assertions are `.textContent` and `toBeNull`
  anyway, which turns out to be a reasonable house style.)
- Playwright's `test.skip(predicate)` only works inside a `describe`; in a test body it is
  `test.skip(testInfo.project.name !== 'chromium', …)`.
- With `page.route('**/api/boards/*', abort)` in TC-28, the page's own backoff is what
  eventually succeeds: the board appears about a second after the unroute, with no reload,
  which is the retry doing its job rather than the test hurrying it.

## What the timings look like here

| measurement | on this machine |
|---|---|
| TC-26: click **New board** → board on screen | 137 ms against `CREATE_BUDGET_MS = 2000` — logged, not asserted |
| TC-28: unreachable → route restored → board on screen | ~1 s, which is the first retry interval |
| `npm run test:integration` (36 pool + 27 live) | ~78 s |
| `npm run test:e2e` (38 cases, chromium only on this host) | ~38 s |

---

# Notes: Story 8 — undo and redo my own changes

## Deviations from the design

### The undo controller is created in `BoardSurface`, not `App.tsx`

`design.md` says "`App.tsx` creates one controller per board doc." Since story 5,
`App.tsx` no longer owns a `Y.Doc` — it resolves the board address and hands the
board id down; the doc is created by `useBoardDoc` inside `BoardSurface`, and
`BoardPage` keys `BoardSurface` by board id. The controller has to be created with,
and destroyed alongside, the doc it watches, so `BoardSurface` is where the design's
intent actually lands: `useMemo(() => createUndo(doc), [doc])` with a cleanup effect
that calls `destroy()`. Keying by board id means opening another board tears this
controller down and a fresh one starts empty — the `undo.session_only` behaviour the
design asked for, unchanged.

### The nightly soak's slot grid moved right (coordinates only)

Story 8 adds two `toolbar__button`s to the left tool rail (`Toolbar.tsx renders
UndoButtons`, per the design). The rail is `position: fixed; left: 16px; top: 50%;
transform: translateY(-50%)`, so it is vertically centred and its x-span is ~16–66 px.
TC-30's soak put its click grid at `x = 60`, one row per person at `y = 60, 210, 360,
510, 660`. With the rail at its old height (one button) its vertical span was ~375–425
and hit none of those rows; with three buttons it spans ~331–469, which covers the
third writer's row at `y = 360`. That writer's double-click then landed on the toolbar
(the rail stops pointer/double-click events) instead of the board, so it never created
a note and TC-30 failed deterministically — not because undo did anything, but because
a legitimate toolbar got taller. The fix is in the soak's `soakSlot`: start the grid at
`x = 120` (clear of the rail, the same origin the non-nightly capacity test already
uses). No assertion changed; the case still exercises five people's create / type /
recolour / delete / drag and their propagation.

## Decisions

### Origin filtering, verified against the real provider origin

`trackedOrigins = new Set([LOCAL_ORIGIN])`. A `Y.UndoManager` on the `objects` map, so
its deep observation already covers each note's nested `Y.Text` — text edits are undo
steps without any per-type code. Remote updates arrive with the `y-websocket` provider
origin and story-4 load updates with their own, so neither ever enters a stack. The
unit suite simulates a peer by applying a diff with a different origin
(`tests/unit/helpers/peer.ts`); the e2e suite proves it through the real provider
(TC-22: undo restores my delete while Raj's new note stays on both screens).

### `Y.UndoManager` API details that bit

- `undo()` / `redo()` return a `StackItem | undefined`, not a boolean. The controller
  returns `applied != null`. An inverse that targets an object a colleague deleted is
  still popped (it just has `performedChange === false` and changes nothing), so
  `undo()` reports the step was consumed and the board is unchanged — the
  `undo.safe` behaviour, and TC-23 asserts it leaves no error and the history usable.
- This yjs version has no `stack-item-limit` option, so the `UNDO_MAX_STEPS` bound is
  a manual `while (undoStack.length > max) undoStack.shift()` on `stack-item-added`.
- The redo stack can never exceed what the undo stack held, so trimming only the undo
  stack bounds the total.

### Boundaries are called where an action starts and stops

`boundary()` is `stopCapturing()`. Placed at: gesture start and pointer-up (`useTransform
Gesture`; the raise and the drag frames become one step, rAF frames inside still merge),
edit start and stop (`StickyTextEditor` mount/unmount), the note-toolbar colour click and
the batch delete (`SelectionBar` / `BoardSurface.deleteSelection`, closed on both sides),
and each arrow-key nudge (`useBoardKeys`). Typing bursts still group by
`UNDO_CAPTURE_TIMEOUT_MS` because there is no boundary between keystrokes.

### Undo/redo shortcuts are handled before the empty-selection guard

In `useBoardKeys`, Ctrl/Cmd+Z and Ctrl+Y are matched after the "is typing / Escape"
checks but before `selectedIds.size === 0`, because undo acts on the history, not the
selection — an empty board still undoes. They check `editable` before acting (a locked
board ignores them, TC-20). While editing, `StickyTextEditor` intercepts Ctrl/Cmd+Z /
Shift+Z / Ctrl+Y itself and routes them through the controller (flushing the textarea
first, then re-syncing it from the `Y.Text`), so it is the shared board's undo, not the
browser's native textarea history (TC-21).

## What the suites look like here

`npm run test:e2e:nightly` runs for the design-specified time; `VIDI6_SOAK_MS` shortens
the soak for local work. TC-30 passes repeatedly after the slot-origin change
(p50 ~115 ms, p95 ~300 ms on this host). Ordinary `npm run test:e2e` (47 cases) and the
full unit (167) / component (114) / integration+live (63) suites all pass.

---

# Notes: Story 9 — free text anywhere on the board

## Deviations from the design

### Text objects record a page id, not a person, until story 6 exists

Design §3.2 stores `createdBy` "from the current session identity". Story 6 (identity)
has not been built yet, and there is no session identity to read — `sessionStorage`
holds nothing, `BoardRoom` carries no user. So `BoardSurface` mints one id per page —
`page_<crypto.randomUUID()>` — and passes it to `createText`. It is a stable author for
the lifetime of a page, which is all the field is used for today (attribution, and
nothing in this story branches on it). When story 6 lands, that one expression is the
only place to change.

### The box write is Pattern A (explicit call in the edit capture), not an observer

Design §4.3 allows three placements and recommends A or C. A Yjs observer (C) was
tried first, and it fails undo in a way the design's own §4.4 says is disqualifying:
`boxSyncObserver` only fires when the *text* changes, so a remote edit restores the
words and leaves the stored box stale — two screens then disagree about where the
same words end. The unit tests in `tests/unit/text-layout.test.ts` keep that failure
as a named case ("an observer-only sync leaves the box stale after a remote edit"),
so the reason the implementation writes from the editor stays on the record.

What runs instead: `TextEditor`'s `onInput` → `useTextBoxSync.remeasureAfterLocalChange`
→ `writeTextBox`, i.e. one explicit write inside the transaction window that the edit
already opened (`useStickyTextEditing`'s origin-tagged debounce, the same place sticky
notes write text). Resize gestures call `writeTextBox` on the frames where they change
a text object's width or size. Remote transactions reach no local callback at all, and
`TextBoxSync.test.tsx` asserts that with an instrumented measurer.

### `createText` takes an optional size

Design §3.2 shows `createText(doc, at, createdBy)`. `createTextAtWorld` needs the
active size preset at the moment of creation, and doing it in one transaction is what
keeps "create + pick a size" a single undo step and the box measured once. The
parameter defaults to `TEXT_DEFAULT_SIZE`, so every existing call reads as designed.

### The toolbar is a branch of `SelectionBar`, and the editor is one component

`TextToolbar` is rendered by `SelectionBar` for a text-only selection, next to the
existing "N objects / Delete" bar, because that is where the selection's actions
already live and the floating position is already computed there. `StickyTextEditor`
is now a thin wrapper over `TextEditor` with `variant="sticky"`; the sticky variant
keeps its own DOM (`.sticky-note__editor` wrapper, fit-to-box font, the 480 ms
fade-out on unmount), so story 7's component and e2e tests pass against the shared
component unchanged.

### `handles` is declared on the registry, and read through `handlesFor`

Design §4.6 says "horizontal handles only for text-only selection". Rather than a
text check in `BoardSurface`, `ObjectTypeSpec` gained `handles?: 'all' | 'horizontal'`
and `registry.tsx` exports `handlesFor(types)`, which returns `'horizontal'` only if
every selected type declares it. `SelectionOverlay` renders `['e','w']` for that, and
`useTransformGesture` turns those drags into width, ignores the y axis, and never
writes height.

## Decisions

### `width`, `height` stay optional and are always present in practice

The design keeps them optional (a pre-story-9 board has no text objects, and an
auto-width measurement is a browser's). Every creation writes them, and every path
that reads them for layout falls back to `TEXT_DEFAULT_SIZE` metrics. Nothing in the
client has to branch on `undefined` except the model's own defaults.

### Plain text does not use `fitFontSize`

The four presets are the font size — S/M/L/XL map to px numbers in `TEXT_SIZES` — and
the content never changes them. `TextEditor`'s `plain` variant therefore bypasses the
sticky fitter entirely; there is no 10 px floor to defend because there is no fitting.

### While typing, the editor is as wide as the object's stored box

Auto width grows the box as the words grow, so the caret never sits in a box narrower
than the line being typed; the fixed variant is exactly the fixed width, which is what
makes the wrap visible while typing (PRD §7). Before the first measurement arrives the
box is 0×0, and the editor falls back to the CSS defaults (`min-width: 60px`) with the
shared character-count estimate for the wrap — the "narrow then jump" look the design
warns about, only in the first frame of a brand-new object.

### Character limit is enforced in `editText` and mirrored in the DOM

`TEXT_MAX_CHARS` (5 000) is applied by `applyEdit` for both object kinds, so every
path — keystroke, paste, undo-restore of an older long value — lands inside the limit,
and `maxLength` on the textarea keeps the browser from offering more. TC-28 pastes
5 250 characters through the DOM and reads 5 000 back out of the document.

## Findings worth remembering

### jsdom has no text metrics, and this is fine but noisy

`CanvasTextMeasurer` asks a `<canvas>` for `measureText`. jsdom's canvas is a stub that
throws "Not implemented", so the measurer catches once, logs a single
`console.warn` per instance, and estimates from an average glyph advance
(`TEXT_ESTIMATED_GLYPH_RATIO`). Layout unit tests never touch it — they pass a fake
measurer, as the design asks — and the component tests that mount a board use the
fallback only to place a plausible box. Chromium measures for real in the e2e suite,
which is where box equality across two screens is actually asserted (TC-26, TC-30).

### `Object.is` in a Yjs observer would have deleted nothing

Worth recording because it cost an hour: a Yjs `Map` returns fresh wrappers for nested
values, so `prevValue === newValue` is false even when the stored text is identical —
an observer that "skips no-op writes" on identity either never writes or always
writes, depending on the branch. `writeTextBox` compares the numbers it is about to
store instead, which is the comparison that matters.

### Removing an empty text object happens on edit end, not on empty

The design's "leaving an empty text object deletes it" is implemented in
`TextObject.endEditing` (with a re-read of the shared `Y.Text`, because a colleague may
have typed into it during the same frame) plus the existing empty-selection delete and
`Delete` in the toolbar. A "delete as soon as it is empty" rule would delete the object
between a backspace and the next keystroke, and take the caret with it.

## What the suites look like here

`npm test` is 406 tests over unit (204 in 17 files), component (139 in 17 files) and
integration/live (worker) projects, all passing. `npm run test:e2e` is 54 cases,
including story 9's seven (`tests/e2e/text.spec.ts`): the golden path, TC-26 to TC-31.
Only chromium runs on this host; firefox and webkit are skipped by the config probe, as
in stories 5 to 8.

---

# Notes: Story 10 — shapes and arrows that follow

## Deviations from the design

### The click-to-create size is one square number, not a pair

PRD §7 and the design's `SHAPE_DEFAULT_SIZE_WORLD` describe the standard shape as one
number, and the design's own component table says a click on a Diamond makes "160×160
centred". Reading it as a 200×120 rectangle first made TC-24 wrong in the test, not in
the app: the standard box is `{SHAPE_DEFAULT_SIZE_WORLD}²` for every kind, and only a
*drag* produces a non-square shape (TC-23's 200×120 is the drag rectangle itself). The
constant is a single `160`, and `defaultShapeBox()` is the only place it becomes a rect.

### Two new files where the design named one, and one it did not

- `src/client/tools/useActiveTool.ts` is a *new* hook rather than an extension of
  `src/client/board/useTool.ts`, because `useTool` is the sticky/text hand-off already
  used by three specs' worth of tests and its state shape (a tool that is a *creation*
  request) differs from a tool that is a mode. `useTool` stays as it is; `BoardSurface`
  now holds the active tool.
- `src/client/board/boardEnv.tsx` is not in the design's file table. Shape and connector
  rendering needs the camera (to convert a client point to board units), the rects of
  every object (to resolve an attached end), the doc, and whether this page may write —
  five things the design's `ObjectProps` does not carry. Threading them through every
  `ObjectTypeSpec` component would have changed story 7 and 9's component signatures; a
  context provided once by `BoardSurface` does not.
- `src/shared/geometry/connector-geometry.ts` exports more than the design's four names
  (`endpointPosition`, `oppositeReference`, `pointOf`) because the rules "where does this
  end hang" and "what should the other end be measured against" are used by the tool, the
  object and the model, and inlining them twice is how two screens start disagreeing.

### An arrow may not be created with two free ends, but may end up with them

The design forbids an arrow with "no connection at all" without saying where the rule
lives. It is a *creation* rule (`createConnector` returns `null` when both ends are
free), not an invariant: dragging a handle off its object releases that end
(`setConnectorEndpoint` allows it), and deleting the object at an end releases it too
(`detachConnectorsTo`). A test asserts both halves, because a client that refused the
release would make the handle snap back, and one that allowed the creation would let a
stray click make an arrow to nowhere.

### Story 7's "unknown object type" fixtures use a different word now

`tests/unit/board-model-group.test.ts` used `'shape'` as its stand-in for a type the
registry does not know. Story 10 makes that type known, so the fixtures say `'widget'`.
The assertion — an unrecognised type is skipped, not rendered and not crashed on — is
unchanged.

### The delete race (TC-27) is interleaved by real events, not by delayed frames

The design's route is "route delay to force overlap". Playwright cannot hold a Durable
Object's outbound frames without a proxy, and standing one up would test the proxy. The
case instead uses the real interleaving: Dana's hand goes down on the arrow's point and
is mid-drag when Sam deletes the shape, then Dana lets go over the place it was — so the
release genuinely races the delete, and which one wins is left to chance. What is
asserted is the safety property the design is after: the arrow is still drawn, with no
`NaN` in any coordinate (the helper throws on one), both ends finite, and the two
screens converge on one identical arrow.

## Decisions

### A connector drag needs two targets, and the first bug was having one

`ConnectorTool`'s drag state is `{ from, fromId, to, toId }`: `fromId` is fixed at
pointer-down and never changes, `toId` follows the pointer. The first version had a
single `targetId` for "the object the hand went down on" and "the object the hand is
over now", and pointer-move cleared it — so an arrow drawn from shape to shape landed
with a free end, because by the time the hand lifted nothing was remembered about where
it started. `Connector.test.tsx`'s "an arrow drawn between two shapes hangs on both" is
the case that found it.

`toId` is left alone when the pointer leaves the window (`clientX/Y` outside
`innerWidth/innerHeight`): that means the pointer went off the board, not that it moved
off the object, and the difference is visible as an end that forgets its shape whenever
the hand wanders.

### Hit-testing gained a context argument, and one door

`ObjectTypeSpec.hitTest(obj, worldPoint, context?)` where context is `{ zoom, rects }`.
A note and a shape are hit by their box; an arrow is hit by distance to its derived
polyline, which needs the boxes of the objects it hangs on and the zoom (the tolerance is
6 screen pixels, so in board units it is `6 / zoom`). `hitTestObject()` is the only
exported way to ask "what is under this point", which keeps the tool overlays and the
board's own select path from drifting apart.

### `ShapeObject` measures against a resolved box

`shapePath(shape, size)` and `shapeLabelBox(shape, size)` take the box explicitly rather
than reading `width`/`height` off the snapshot: those fields are optional on
`ObjectSnapshot` (story 9's rule), and `objectBounds()` is what resolves them. Passing
the resolved rect in means the outline and the label cannot be measured against a
default while the board holds a real size.

### Rendering an arrow: one padded SVG, and `pointer-events` in three places

The connector's box is its two endpoints plus `DRAW_PAD_WORLD` (the head and the handles
stick out). The wrapper and the `<svg>` are `pointer-events: none`, and only two things
catch the pointer: the invisible hit line at `CONNECTOR_HIT_TOLERANCE_PX / zoom`
(`pointer-events: stroke`, so the empty middle of a long arrow's box is left to whatever
is underneath), and, when selected, the two handle dots. The handle drag listens on
`window` rather than the circle, because dragging off the arrow's own box — which is the
normal way to re-attach an end to a far object — would otherwise lose the pointer.

### The tool layer is `position: fixed; inset: 0` at z-index 15, and previews in screen space

Above the board viewport (which paints objects) and below the toolbar (20), so a drag
that crosses the toolbar still belongs to the tool, and the toolbar stays clickable when
the tool is picked by its button. The shape preview is a dashed div in *screen* pixels
converted from the board-space rectangle: 1 CSS pixel wide at every zoom, which is what
makes the preview read as an intention rather than the object.

### The seed hooks use a `'seed'` origin

`seedShape`/`seedConnector` write with a transaction origin that is not `LOCAL_ORIGIN`,
so laying out a board for a test never enters that page's undo history. An e2e case that
presses Ctrl+Z afterwards undoes what the *person* did in that test, which is the thing
under test.

## Findings worth remembering

- **A drawn arrow's end is the arrowhead's tip, not the line's end.** `ConnectorMark`
  stops the line `CONNECTOR_ARROWHEAD_SIZE_WORLD` short so the head can sit on the end.
  Measuring where an arrow points therefore reads the polygon's first corner; reading
  `line.x2` gives a point 10 board units early, which at 100% zoom is exactly the
  tolerance these assertions run at.
- **`window.__vidi6` exists once the board has mounted.** An e2e `beforeEach` that clicks
  "New board" and immediately calls `setCamera` reads a page that is still navigating and
  gets "test build" errors that mean nothing of the kind. `openBoard()` waits for the
  viewport and the origin marker first, and every spec should reach for it.
- **A keydown dispatched on `window` has `window` as its target.** The real browser sends
  the key to the focused element, so the "a shortcut typed into a field is a letter" case
  has to dispatch on the field itself; firing at `window` tests the wrong thing and passes.
- **jsdom gives no `getBoundingClientRect` for SVG**, so the component tests assert an
  arrow's geometry through the document and the derived points, and where it is *drawn* is
  asserted in the browser (TC-25, TC-26). The helper converts an SVG element's local
  coordinates to screen pixels through `viewBox.baseVal` and the element's own box, which
  keeps the assertion true at 400% zoom.
- **`foreignObject` inside an SVG works in all three target browsers** for the label
  editor, but a `textarea` in it inherits no font from the shape: the label's font comes
  from `.shape-object__label`, and the editor reuses the sticky/text `TextEditor` with
  `variant="plain"`.

## What the suites look like here

Unit 266 (20 files), component 166 (20 files), integration+live 63 (6 files), e2e 63
cases including story 10's nine (`tests/e2e/shapes.spec.ts`,
`tests/e2e/connectors.spec.ts`). Only chromium runs on this host, as in stories 5 to 9.
Two-person arrow cases land in the 3–20 ms delivery range against the 1000 ms budget,
logged rather than asserted.

# Story 4 — notes on the implementation

Anything that differs from `design.md` / `tasks.md`, or that a later reader needs in order to
follow a choice, lives here.

## Storage

**`BoardStore` types its own narrow storage interface (`BoardStorage`).**
`design.md` writes `constructor(private storage: DurableObjectStorage)`. `DurableObjectStorage`
is a Workers global, and the pure helpers in this file (`chunkBytes`, `joinChunks`,
`shouldCompact`, `readSnapshot`) are covered by *unit* tests, which run under the client
tsconfig project (DOM types, no Workers types). So the store declares the handful of methods it
actually calls and the real `DurableObjectStorage` satisfies it structurally. `state.storage` is
passed in unchanged, which is what keeps the store unit-testable against a small fake.

**The fault seam is a field on the store (`failNext`), not a wrapper object around it.**
`design.md` says tests should "wrap `store.append` to throw once". One of the required faults has
to happen *inside* the compaction transaction — after the snapshot rows are written and before
the log rows are deleted — which a wrapper around the method cannot reach, because the delete
happens inside `storage.transactionSync`. `failNext: 'append' | 'load' | 'compaction' |
'compaction-after-delete'` is a one-shot field the store consults at those four points. Tests set
`room.store.failNext = 'append'` and get exactly the "wrap append once" behaviour; the fourth
value exists to make the rollback claim in `design.md` ("storage rolls the transaction back, the
snapshot stays, the log rows stay") an actual test rather than a sentence.

**Quarantining damaged bytes reaches into Yjs internals once.**
When `applyUpdateV2` is handed bytes that cannot be integrated, Yjs parks them (and every update
that follows) in `store.pendingStructs`, so the *next* row would silently be dropped as well.
After quarantining a row the store clears that parking lot (`abandonUnreadableBytes`) and, on the
second pass over the log, applies what applies. Without this, one damaged row would stop the
whole board from loading, which is the outcome the design rule was written to prevent. It is
Yjs-internal, commented as such, and guarded so a future Yjs that changes the shape leaves the
board readable and logs the fact.

**Row-by-row loading, not one bulk read.** `store.load` reads the snapshot, then walks the update
log one row at a time, because a bad row has to be quarantined *individually* — that is the whole
technique. (The perf item in `tasks.md` asked whether loading a 1 MiB board is a stack of 200
separate reads; it is one SELECT per row at present, and 2000 notes load in ~15 ms, so it is not
a problem worth an optimisation this early. See the perf section below.)

## The room

**Hibernated sockets have to be closed back.** With `ctx.acceptWebSocket`, workerd does not echo
a client-initiated close back to that client, so a socket that calls `close()` never sees its own
`close` event (tested: `1000`, `1001`, with and without a reason — nothing arrives). Real browsers
report the close locally and are unaffected, but two story-3 integration tests wait for the client
to observe its own close, and "the tab learns the connection is gone" is behaviour worth having
regardless of who closed it. `webSocketClose` therefore answers the close. That keeps every
story-3 test passing unchanged, which was the check that this was the right fix rather than a
symptom.

**`store` is public on `BoardRoom`.** Not for production callers: the tests have to be able to
say "make the next write fail" and "how many times has this room tried to read", and doing it
through the public WebSocket interface would mean simulating storage failure with network
traffic, which proves nothing.

**`compactionPending()` on the store.** The room would otherwise have to know the store's
thresholds to move itself through `compacting` in the lifecycle; the store already knows. This is
the only public method `design.md`'s list of four did not include.

**A change that arrives while the room is not `ready` is dropped, not queued.** `design.md`
chooses to drop it ("nobody is told it arrived, and the client keeps its own copy until it
reconnects"). The room logs a `board-change-dropped` line so a person chasing a lost change can
find it; there is no queue, because a queue in memory is exactly the promise this story refuses
to make.

## Tests

**Persistence tests read storage with a second `BoardStore`, not the room's.**
`boardInStorage()` in `tests/integration/room-persistence.test.ts` builds a store over
`state.storage` that has never met the room and loads the board into a fresh document. Half of
story 4's claims are of the form "what a client saw is in the database", and reading the database
through the object that wrote it - which holds a document in memory - would let a room that never
wrote anything still look correct.

**TC-26 injects the SQL read error through `failNext = 'load'` rather than by breaking the
schema.** The `tasks.md` wording is "make the SELECT in load throw". The obvious way - drop a
table - cannot work, because `migrate()` runs `CREATE TABLE IF NOT EXISTS` first and the load then
succeeds against the empty recreated table, which is a different (and worse) bug being tested. So
the test drives the room into `storage-failed` with a failed write, arms the load fault, and lets
the reconnecting client's reload hit it - the load really does throw where it reads, and the
close code the client gets is 4500.

**TC-16 waits the real interval.** `LOAD_RETRY_MIN_INTERVAL_MS` is 5000 ms, so that test takes
about six seconds. Freezing or shortening the clock inside workerd to save five seconds would
mean the boundary being tested is a test-only constant. It asserts both halves: a reconnect
immediately after the failure is refused with no additional `store.loadAttempts`, and a reconnect
after the interval loads and syncs.

**TC-13's reopening client writes nothing of its own** (`init: false`). A client that runs
`initDoc` adds its own `schemaVersion` write under its own client ID, so the reopened document
would legitimately differ from the one that was stored, and the byte-for-byte comparison
(`sameBoardState`) would be comparing the wrong things.

**Socket counts come from `state.getWebSockets()`, not from a new method on the room.**
`runInDurableObject`'s second callback argument is the `DurableObjectState`, which owns the list.
TC-18 needs to know that a room woken from hibernation is holding both tabs that were connected
before it was evicted; asking the runtime rather than the room is both the stronger assertion and
one fewer production method that exists only for tests.

**TC-09 is two tests.** The `tasks.md` version says "corrupt one update row in the middle of a
250-note board (row 7 of 250), assert the board loads 249 notes". A Yjs update carries one
author's slice of history; when a row from the middle of *that author's* clock is unreadable, the
items after the hole stay in that author's gap — Yjs will not integrate them, and no amount of
store logic should pretend otherwise, because accepting an out-of-order item would produce a board
that is not any real board. So the tests are: a damaged *last* row costs exactly one change and
the loaded board is byte-identical to the original document (`TC-09`), and a damaged row in the
middle of a two-author board gives a board byte-identical to "the log without that row", with the
other author completely intact and the damaged author's post-hole changes absent, quarantined and
logged (`TC-09b`). "249 of 250 notes" would be true only of a single-author board, which is the
first test.

**TC-04b builds a board big enough to need chunks rather than shrinking the chunk size.**
The `tasks.md` item is "a 1 MiB snapshot must be written and read in 512 KiB chunks". Tempting as
it is to test the chunker at 256-byte chunks, that would leave the production constant untested
where it matters, so `longTextBoard()` (fixture) authors 1200 notes with a kilobyte of text each
and the test folds that board for real: more than one `snapshot_chunks` row, no row larger than
`SNAPSHOT_CHUNK_BYTES`, the stored rows concatenated equal to the encoded update byte for byte, the
folded log gone, and the reloaded document equal to the original - including the last kilobyte of
the last note's text, which is where an off-by-one in reassembly would show up. The whole file
still runs in about a second.

**TC-09's and TC-10's "no empty board" assertion is stronger than an id count.** Both compare the
loaded document against the original with `sameBoardState` (`Y.encodeStateVector` equality plus
`Y.encodeStateAsUpdate` byte equality), so "it loaded something" cannot pass by accident.

**Fixture docs get unique client IDs.** `tests/fixtures/boards.ts` hands every `Y.Doc` its own
`crypto.randomUUID()`-style client ID from a counter. Two docs sharing a client ID look like one
author with contradictory history to Yjs, and notes vanish silently — which looked exactly like a
store bug while it was a fixture bug.

**Performance evidence** (`tasks.md` perf items, all measured in the integration project on this
machine): 250-note board built and stored in ~14 ms; 2000-note board built in ~240 ms, its 2001
update rows written as it is built, loaded back in ~14 ms; `store.load` of that board applies
2001 updates in one pass with a single per-row SELECT. Folding happens on a threshold crossing and not
before (TC-06), and a 2000-note board folds to one snapshot with the log emptied (TC-08).

## E2E across a real restart

**The restart tests are a project inside `playwright.config.ts`, not a second config.**
`tasks.md` asks for "its own Playwright project without the shared webServer". Playwright allows
exactly one top-level `webServer`, so a separate config would need its own runner invocation and
would drop these tests out of `npm run test:e2e`. They are therefore a project beside the browser
projects, with `testDir: './tests/e2e-restart'` (which is what keeps them out of the browser
projects), `fullyParallel: false` and `workers: 1`. The shared server still starts, because
Playwright starts it for any project in the config; these tests never connect to it, never kill it,
and never touch its storage directory.

**Each restart test owns its server and its storage.** `tests/e2e/helpers/wrangler-process.ts`
starts `wrangler dev --persist-to <OS temp dir>` on a port pair chosen from the worker index
(28820/28821 up to 28830/28831, so the shared 28816/28817 are never touched), waits for readiness by
polling the HTTP root, and reports the server's own log tail when something goes wrong. "Killed"
means `SIGKILL` to the whole process group (`detached: true`, then `process.kill(-pid)`), because
`wrangler dev` runs workerd as a child and the claim under test is that the machine lost all of it.
`dispose()` stops the process, waits for the port to go quiet, and only then removes the directory,
so no server is left pointing at a path that has been deleted.

**TC-21's seeding is a Yjs client in the test process, not a browser.**
`tests/e2e/helpers/seed-board.ts` is an ordinary participant: a real `Y.Doc`, the real board model,
real y-websocket framing over Node's global `WebSocket`. Two thousand notes clicked through the
interface would take longer than the load being measured, and a board written straight into storage
would not show that a room can be written into through the socket it serves. One note is one
transaction and one frame, so the room sees the traffic a busy person's board generates - at this
size it crosses the compaction threshold four times, and the board the browser then opens is a
folded snapshot plus a tail, which is the load path that matters.

**TC-21 restarts twice, on purpose.** The first restart is followed by a WebSocket read with no
browser in it, which confirms the board is in storage and measures the load on its own; the server is
then killed again so the browser measures a cold load rather than the room that read has just woken.

**Measured on this machine (the run these tests were committed from):** 2000 notes seeded in
~2.9 s; first load after the restart over a WebSocket, no rendering, ~140 ms; navigation to 2000
note elements rendered ~8.6 s, which is over `BOARD_LOAD_BUDGET_MS` (3000 ms) and is printed as
`over`, not failed, as `tasks.md` requires. The difference between 140 ms and 8.6 s is the app bundle
and 2000 DOM nodes, not reading the board: the functional assertion - every note back, byte-equal to
what was seeded - passes well inside `E2E_EVENTUAL_TIMEOUT_MS`. Recording the split, because "the
budget is reported, not asserted" is only honest if the number and where it goes are both stated.

**TC-19's board is built under a pulled-back camera** (`zoom: 0.42`, set before the restart and again
after). At zoom 1 a 1280×800 screen holds fifteen 200-unit notes, and the test wants twenty-six of
them, one deleted, plus a spot that is certain to be empty both before and after the restart. The
camera belongs to the tab, not to the board, so nothing about what is saved depends on it.

## The client, when the board cannot be read

**`load_failed` is sticky and only a successful sync clears it.** Other close codes leave the flag
alone: the retry after a load failure frequently ends as a plain dropped socket, and the fact that
matters to the person is still "we do not have your board". `canEdit` therefore returns false for
exactly one state, and `evaluate()` clears the flag in its live branch only - first sync that works
publishes `connected`, with no reload.

**The `connection-close` handler publishes instead of asking.** y-websocket emits `connection-close`
*before* it stops counting that socket as live, so calling `evaluate()` from the handler found a
connection that still looked fine, cleared the flag again, and the badge stayed `connecting` forever
(the real browser caught this; the component test, which drives one close at a time, could not). For
`CLOSE_BOARD_LOAD_FAILED` the handler now sets the flag and publishes directly. The room has made a
decision, and a decision is not something you re-read off the transport.

**A retry in progress does not downgrade the message.** While the flag is set, the not-live branch of
`evaluate()` publishes `load_failed` rather than `connecting` or `reconnecting`: the badge text says
"Retrying…", and retrying is exactly what is happening, so a tab waiting on the room's five-second
interval keeps saying so instead of flickering back to "Connecting…".

**The close code is what makes the retry honest.** y-websocket treats 4400-4499 as "do not come back"
and reconnects for anything else, which is why the load-failure code is 4500: inside that band the
room's promise that it will read the board again would be a promise about a socket nobody ever
reopens.

**Editing is switched off in four places, and the reason is stated.** `canEdit(connection)` reaches
the viewport (no double-click to create), the note (no drag, no double-click into the text), the note
toolbar (swatches and delete `disabled`) and the board toolbar (create `disabled`, with its own
tooltip - a control that stops working without a reason reads as a bug). `App` gates its keyboard
handler and `createAtScreenPoint` on the same value, so the rule is one fact in one place rather than
five opinions.

**Component tests of the badge** (`tests/component/BoardLoadFailure.test.tsx`): the badge is found by
its `.connection-status` class, not by `role="status"`, because `NavigationHint` shares that role and
`getByRole` then finds two elements; the red is checked from the stylesheet on disk (`readFileSync`,
because vitest stubs `?raw` CSS imports to an empty string) by asking whether the red channel dominates
and differs from `reconnecting`'s; and each close code needs a connection of its own - `FakeSocket`
closes once and ignores the second call, so reusing a socket silently skips a case.

## Test-only storage hooks

**`src/worker/test-hooks.ts` is the design's hook, with one wording difference.** `tasks.md` and
`design.md` say the corruption endpoint is "compiled only when `env.TEST_HOOKS === '1'`". A Worker's
environment is runtime configuration, and there is no compile-time switch that a `wrangler dev` for
e2e and a production deploy would differ on, so it is *routed* only when: with the variable unset the
paths are not `/api/...`, fall through to the assets and are answered by them. What the story asks to
be verified is the observable half of that, and `tests/e2e-restart/storage-hooks-off.spec.ts` checks it
against a server started from the shipped `wrangler.jsonc` with no variables at all: the two POSTs
answer 405/404 with no hook-shaped body, a GET to the same path gets the SPA, and a board on that
server works normally. `wrangler.jsonc` never mentions `TEST_HOOKS`; the e2e dev server and the
restart tests' servers pass `--var TEST_HOOKS:1` on the command line.

**The hook damages the snapshot, not a log row.** A damaged log row costs that one change and the
board still opens - that is TC-09, and it is the recovery behaviour this story is proud of. The only
stored thing whose damage refuses the whole board is the snapshot, which is what
`board-store.ts`'s `snapshot-unreadable` result exists for.

**Corrupting makes the room read its board again**, rather than setting `#state = 'load-failed'`. The
lifecycle has no `ready → load-failed` edge by design (nothing in the real lifecycle moves a serving
room straight into load failure; it wakes into one), and `#load()` is the path a room that wakes to
unreadable storage takes - so the hook calls it, and the room arrives at `load-failed` the same way,
with its document gone and every connection answered with `CLOSE_BOARD_LOAD_FAILED`. The first version
poked the state directly, `nextRoomState` correctly ignored an event that does not apply to `ready`,
and the room went on accepting connections with no document behind them: precisely the dishonest board
this story exists to prevent, produced by the test meant to check it. `#load()` now also drops the
document it replaces, so a failed read leaves nothing held in memory.

**The original bytes are kept in the room's memory**, not in a table. Enough for the one test that
uses them, and it means a deployment that had the hook switched on by accident could not lose a
board's snapshot permanently through it.

**25 notes do not fold a log.** `COMPACTION_UPDATE_COUNT` is 500 rows and `tasks.md`'s board is 25
notes, so TC-24 adds 520 small moves with `nudgeBoard` (`tests/e2e/helpers/seed-board.ts`) before
corrupting. The board is still 25 notes; what grew is its history, which is what a board lived in for
a month looks like anyway.

**TC-24 lives in the shared e2e project; its other half in the restart project.** Recovery needs no
process restart - the room re-reads when its retry interval has passed and a client connects - so the
browser half runs on the suite's shared server, and only the "server without the hooks" check starts a
`WranglerProcess` of its own (`{ testHooks: false }`). Its tab is opened by a local `openTab` that
waits only for the app to be on screen, because the shared `waitForBoard` waits for `connected`, which
is the one thing a board nobody can read does not become. Recovery is allowed three rounds of
`LOAD_RETRY_MIN_INTERVAL_MS + RECONNECT_MAX_BACKOFF_MS`, since both clocks restart after every failed
attempt.

**Rejected: reaching into Durable Object storage from the test process.** Local `wrangler dev` does
expose each object's SQLite (the Explorer's `/cdn-cgi/local/explorer/api/.../query` endpoint addresses
an object by the name it was created from, which for us is the board id), and a first draft of TC-24
used it. It was dropped because it ties the suite to internal table names and to how local storage
happens to be laid out, because restoring a snapshot through it hit `SQLITE_TOOBIG` on the hex literal,
and because "our own gated route refuses to serve a board" is the behaviour under test while "wrangler
lets us write to a database" is not.

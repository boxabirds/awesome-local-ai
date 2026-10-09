# Story 3: See other people's edits appear live on the same board

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write board id and protocol decode unit tests first (TC-01 to TC-03) | done |
| 2 | Implement Worker entry: /api/rooms/:boardId routing to BoardRoom, static assets fallback | done |
| 3 | Implement BoardRoom Durable Object: Yjs sync relay, awareness relay, malformed-message handling | done |
| 4 | Implement client connection: y-websocket provider, /b/:boardId route, connection status badge | done |
| 5 | Integration tests for Worker routing in workerd (TC-04 to TC-06, TC-13, TC-17) | done |
| 6 | Integration tests for BoardRoom merging, broadcast and error handling (TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31) | done |
| 7 | Component tests for connection status badge (TC-19 to TC-21) | done |
| 8 | E2E live collaboration with multiple browser contexts (TC-22 to TC-28) | done |
| 9 | Nightly e2e: idle connection stability and capacity soak with latency report (TC-29, TC-30) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Story 3 notes

Everything the design asked for is in, in the file names and with the named settings it
named, with three places where what the library does differed from what the design
assumed. Each of them is a decision about who is responsible for keeping a connection
alive, who is responsible for what a textarea holds, and how long a disconnected client
takes to know it is disconnected.

**One client per board, one room per board.** `src/worker/index.ts` routes
`/api/rooms/:boardId` to the `BoardRoom` Durable Object (id `board:<boardId>`, derived by
`boardIdToRoomId`), everything else falls through to the assets binding. `App.tsx` mounts
one `connectBoard` per board, hands its `Y.Doc` to `useBoardDoc`, and renders
`ConnectionStatus`; the client never constructs a `WebSocket` itself, and never talks to
`wrecs.kifta.com`.

**Who keeps the connection alive.** `y-websocket` gives up on a connection it has heard
nothing from for 30 seconds, and neither side renews awareness by itself on its own: the
design's "clients renew awareness periodically" is true of the library's own reference
server, which sends periodic awareness, not of the client. So `BoardRoom` sends a
`QueryAwareness` message to every socket every 10 seconds (`KEEPALIVE_INTERVAL_MS`);
every client answers with its awareness state, which is relayed to the others. That is
the ping, and it is also what makes awareness data flow — both are what TC-29 (an idle
board staying connected for 45 seconds) tests. The timer starts when the room takes its
first socket and stops when it drops its last, through one `drop()` path, so an empty
room can be evicted.

**Workerd's WebSocket rules**, since the room is written against them and they cost a day
each: after `accept()` set `server.binaryType = 'arraybuffer'` (a `Blob` arrives
otherwise), send every frame as its own `ArrayBuffer` (a `Uint8Array` view over a larger
buffer arrives empty), and copy a message per recipient (`socket.send` takes ownership of
the buffer, so the second socket in a broadcast gets nothing). `errorHandler` on
`Y.applyUpdateV2` is set to rethrow, because `readSyncMessage` swallows the failure of
applying an update and the room needs to know in order to close the sender (TC-15).

**Who owns the textarea (TC-23 found a real bug here).** `StickyTextEditor` used to write
`applyTextDiff(ytext, textarea.value)`: the difference between the shared text and what
the textarea showed. When two people are in one note that difference includes the other
person's word, which the editor had not seen — so it was deleted. TC-23 caught it (one
character in fifty was lost). It now writes `applyLocalEdit(ytext, previous, next)`, the
change between what the textarea held a moment ago and what it holds now, applied at that
same place in the shared text; characters that only the shared text has are left alone,
and a deletion looks for the characters it means rather than trusting an offset. Remote
changes are mirrored *into* the textarea (caret stepped over them via `remoteShift`, never
into an in-progress IME composition), so what this person sees, what they type into and
what the document holds stay the same text. `applyTextDiff` is still there and still right
for the cases where a value is meant to *become* the note (a clamp to the limit). Unit
tests cover the model level (two documents and a network that is not instant), component
tests cover the textarea and the caret, and TC-23 covers it through two browsers.

**How long a dropout takes to notice (TC-27).** Nothing in the client polls the network,
so `y-websocket`'s own 30 second silence timeout is what notices an outage and puts up
'Reconnecting…'. That is the library's promise, so the test's wait for the badge is
`OUTAGE_DETECTION_TIMEOUT_MS = CATCH_UP_TEST_OUTAGE_MS + E2E_EVENTUAL_TIMEOUT_MS` and the
outage itself still lasts the specified `CATCH_UP_TEST_OUTAGE_MS`. Catch-up after going
back online is measured against `RECOVERY_TIMEOUT_MS` (the provider's own backoff cap
plus the functional budget) and reported against the outage length, never against the
1000 ms live budget.

**E2E across isolated contexts.** One `BrowserContext` per person (separate localStorage,
separate WebSockets), every change through the real UI — double-click to create, drag to
move, keys to type — and never a call into `window.__vidi6` to change the board. Each
change is applied once and then waited for on every other context in turn, one latency
sample per receiver, printed with `[latency]`, and summarised with the median and 95th
percentile; budgets are reported, never asserted (`live_update_latency_budget_ms` is
enforced where it can be: TC-09/TC-10/TC-11 in the room). TC-26 sizes itself from
`MAX_CONCURRENT_EDITORS` rather than hard-coding 5. Badges that must not appear are
caught with an in-page `MutationObserver` (`watchForBadge`/`badgeSightings`), which sees
a badge that appears and disappears between two polls, and `expectNoErrors` fails a test
on any `pageerror`/console error. No test sleeps to stand in for an outcome; the only
sleeps are the specified idle/outage/soak durations themselves, each bounded and followed
by an assertion.

**Nightly.** `tests/e2e/live-collaboration.nightly.spec.ts` (TC-29 idle, TC-30 soak with
`MAX_CONCURRENT_EDITORS` people for `SOAK_MS`), `playwright.nightly.config.ts` (spreads
the base config so server/viewport/reporters stay identical; one worker, no retries) and
`npm run test:e2e:nightly`; the base config ignores `*.nightly.spec.ts` so day runs are
unaffected.

**Three things the soak taught** about what the harness has to expect of a shared board.
A note can be deleted by somebody else between this round deciding to change it and
changing it: the round is skipped and counted, not failed. Notes have to stay clickable,
which means a move is kept inside a box (`SAFE`) — and that box is in *screen*
coordinates, because a note's stored position is a *world* position and the camera starts
centred, so world and screen are 640x400 apart: the first version of this clamp used the
screen numbers as world numbers and quietly walked half the notes off the right edge of
the board, where their colour-change toolbar sat under the app toolbar and swallowed the
swatch click. Two spots for notes to be created in have to be checked against where notes
*are*, not against which spots the soak remembers, since another person drags notes into
them. And Playwright's `actionTimeout` is 10 seconds, so an action that cannot happen is
reported as the action it is rather than as a test timeout somewhere else.

**Numbers from the last runs**, so the report has a baseline: TC-29 (idle 45s, no badge,
no new sockets) passes; TC-30 was 210 rounds of change across 5 people in 60s — 820
latency samples, p50 147ms, p95 946ms, max 1117ms, 28 samples over the 1000ms live
budget, which is a *reported* number per the design and is high because the soak applies
three and a half changes a second to one board through five clients' real UIs while the
machine also runs the browsers. A full day run is 19 tests; TC-27 catches up 866ms after
going back online from a 30s outage.

**Not done from the design**: nothing in story 3 is missing. Presence avatars, offline
queueing, sign-in, dashboard, comments and export (stories 6, 13-17) are untouched.
`MAX_CONCURRENT_EDITORS` is used by the soak's sizing and reported by nothing else; it is
not enforced by the room, which the design does not ask for.

## Commands

| Command | Suite |
|---|---|
| `npm run test:unit` | `tests/unit` (79 tests) |
| `npm run test:component` | `tests/component` (74 tests) |
| `npm run test:integration` | `tests/integration` in workerd (25 tests) |
| `npm run test:e2e` | day e2e, 3 browser projects (19 tests) |
| `npm run test:e2e:nightly` | TC-29 and TC-30 (2 tests, ~2 min) |
| `npm run build`, `npm run typecheck` | production build; both tsconfigs |

`compatibility_date` is `2026-08-22`: the workerd bundled with
`@cloudflare/vitest-pool-workers@0.23` refuses to boot a newer one, so the Worker cannot
be tested against a date past that. `tsconfig.json` (client and DOM tests) and
`tsconfig.worker.json` (Worker and integration tests) are separate because
`@cloudflare/workers-types` and the DOM lib declare `Request`, `Response`, `WebSocket`
and `crypto` differently and cannot share one program.

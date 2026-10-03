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

## Notes

- **Everything the story asks for is in and green**: `npm test` = 99 unit + 117 component +
  25 integration + 68 e2e passed (firefox/webkit skip themselves on this machine, see NOTES.md
  "Browsers"). The nightly pair runs with `VIDI6_NIGHTLY=1 npm run test:e2e:nightly` (TC-29, TC-30).
- Integration tests are numbered exactly as the design's coverage tables: `tests/integration/worker.test.ts`
  has TC-04 to TC-06 plus TC-13 (a room full of people, and the one over capacity) and TC-17 (boards
  stay separate); `tests/integration/board-room.test.ts` has TC-07 to TC-12, TC-14 to TC-16, TC-18 and
  TC-31. 25 of 25 pass with `npm run test:integration`, and they pass repeatedly (run 4x, no flakes).
- `tests/integration/random-ops.ts` is the seeded operation generator TC-12 uses (40% typing real
  words, 30% moves, 10% creates, 10% recolours, 10% deletes, all through the real board-model
  functions); it prints its seeds, so a failure replays with `runSeededOps(doc, 200, seed)`. The same
  generator drives the browser soak: `nextRandomOp`/`applyRandomOp` are exported, and
  `tests/e2e/helpers/random-ui-ops.ts` performs those same operations with mouse and keyboard.
- The integration clients are real `Y.Doc`s speaking `y-protocols` over the runtime's own WebSockets
  (`tests/integration/ws-client.ts`) rather than `WebsocketProvider`, because the assertions are about
  which bytes arrive on which socket. Harness findings are in NOTES.md ("Story 3").
- **The badge state machine lives in `src/client/sync/connectBoard.ts`** and is tested with a fake
  `BoardLink` (`tests/component/fake-link.ts`) under vitest fake timers, so TC-20's
  `CONNECTED_CONFIRMATION_MS` window is stepped through without waiting for it. The e2e tests assert
  the same machine from outside through `window.__vidi6.connectionState` and the badge's text.
- **E2E latency is measured, never asserted** (the design says so). Latest chromium run: TC-22 each
  change 0-3 ms; TC-23 merge 2 ms; TC-24 convergence 1 ms; TC-25 delete 2 ms; TC-26 ten rounds of
  five-person edits 2-108 ms; TC-27 reconnect-and-catch-up 2.4 s; nightly TC-30 p50 2 ms, p95 33 ms
  over 1 055 changes made by five people in 60 s.
- **The nightly soak shortens with `VIDI6_NIGHTLY_SOAK_MS`** so the test itself can be checked in
  ten seconds; the nightly run leaves it at the 60 s the tasks name. `VIDI6_NIGHTLY_SEED` picks the
  seed, so a soak can be played back. Both durations are local to `tests/e2e/nightly.spec.ts` and
  deliberately not added to `src/shared/config.ts`: the design's list of named settings is
  authoritative and does not include them.
- `/` still mints its own board id with `newBoardId()` on the client, which is what this story
  specifies ("temporary; replaced in story 5"). There is no `/api/board` endpoint in story 3 - the
  story's routes are `/api/rooms/:boardId` and the static assets fallback.

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
| 7 | Component tests for connection status badge (TC-19 to TC-21) | todo |
| 8 | E2E live collaboration with multiple browser contexts (TC-22 to TC-28) | todo |
| 9 | Nightly e2e: idle connection stability and capacity soak with latency report (TC-29, TC-30) | todo |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## What is verified at each step
- Task 2: `wrangler dev` on 28400 serves the client at `/` and `/b/<id>` (SPA
  fallback), answers `/api/rooms/<bad!id>` with 400 and `/api/rooms/<id>` without
  `Upgrade` with 426. `npm run typecheck` (two projects) is clean.
- Task 3: the relay was checked against four throwaway workerd tests before
  committing (SyncStep1 at join, one update frame to the other client and none
  back to the sender, awareness echoed verbatim, 1003 on a bad frame, two boards
  staying apart). Those five checks become TC-07..TC-12 in task 6, written
  properly in `tests/integration/board-room.test.ts`.
- Task 4: `typecheck` (two projects) clean; 75 unit + 50 component tests still
  pass; `npm run build` 328 kB bundle. Verified by hand against `wrangler dev`
  with two real Chromium pages on one `/b/<id>`: A's note (text "hello from A")
  appeared on B; B's drag moved the note on A; B's delete emptied both; a
  re-joined tab merged with the live one. Badge showed `Connecting…` on the tab
  that had just joined and was gone once synced; `window.__vidi6.connectionState`
  reaches `connected` and stays there in the `build:test` bundle.

- Task 5: `tests/integration/worker.test.ts` — 8 tests, real workerd with the
  real `dist/client` behind `ASSETS`: bad id gets 400 and no room object exists
  afterwards (`listDurableObjectIds` empty), a room path without `Upgrade` gets
  426, `/b/<id>` serves the same `index.html` as `/` and the bundle it references
  exists and mentions `/api/rooms`, six clients on one board all see the sixth
  one's note at the same position, and two boards stay two documents.
- Task 6: `tests/integration/board-room.test.ts` + `tests/integration/random-ops.ts`
  — 19 tests: create/move/recolour/type/delete each arrive as exactly one update
  and never echo to their sender; concurrent typing keeps every character
  (`red green blue`, same on both screens); concurrent `x=100`/`x=300` settles on
  one value on both; delete-vs-typed-text leaves the note gone on both with the
  text nowhere; 5 clients x 200 seeded edits end with byte-identical snapshots
  (seed and per-client op mix printed under `--reporter=verbose`); a late joiner
  gets all 40 notes; five kinds of unusable traffic (text frame, truncated sync
  frame, unknown frame type, unknown sync type, bytes that are not a Yjs update)
  each close their sender with 1003 while the room keeps relaying for everybody
  else and a newcomer still gets the old notes; awareness is relayed verbatim to
  everybody including the sender, and a query for awareness is ignored; after
  `abortAllDurableObjects()` the first client back refills the room and a
  newcomer sees everything; a socket that died mid-broadcast costs nobody else
  the change (TC-31). `npm run test:integration` = 27 tests in ~15 s.

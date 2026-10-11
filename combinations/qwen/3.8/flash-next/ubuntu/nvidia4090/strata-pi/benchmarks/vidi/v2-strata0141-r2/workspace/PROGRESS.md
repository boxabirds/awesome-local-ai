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

Notes:
- Task 1 committed red: `tests/unit/board-id.test.ts` (TC-01, TC-02) and
  `tests/unit/protocol.test.ts` (TC-03) compile and fail with "not implemented".
- Deps added: `y-websocket`, `y-protocols`, `lib0` (runtime) and
  `@cloudflare/vitest-plugin` (dev). The design names
  `@cloudflare/vitest-pool-workers`, which is deprecated and peer-pinned to
  vitest 4; `@cloudflare/vitest-plugin@1.x` is its successor and supports the
  vitest 5 already in this repo. See NOTES.md.

- Tasks 5 and 6 were run before task 4: they test the Worker and the room, and
  the client only had to be able to reach them.
- Integration runs are a separate Vitest project (`vitest.integration.config.ts`,
  `npm run test:integration`) because they need the Workers runtime and
  `wrangler.jsonc`; `tsconfig.worker.json` type-checks `src/worker` and
  `tests/integration` with `@cloudflare/workers-types`.
- Integration TC-04 asserts "no object instance created" as "no WebSocket was
  handed out": the room's own `fetch` always answers 101, so a 400 with no
  upgrade proves the namespace was never called (there is no "does this Durable
  Object exist" API to spy on).
- TC-18 simulates a deploy with `evictDurableObject(stub, { webSockets: 'close' })`
  after the sockets close, then proves the room really lost its document (a probe
  client sees an empty board) before the first reconnecting client repopulates it.
- The room reads sync messages itself instead of `syncProtocol.readSyncMessage`,
  because that helper logs a rejected Yjs update and carries on; this contract
  closes the socket that sent it (TC-15).
- `App` only attaches a provider when it is not handed a document, so the story 2
  component tests keep rendering a local board with no network.

- Live e2e (`tests/e2e/live-collaboration.spec.ts`) runs TC-22 to TC-26 and TC-28 in
  chromium and firefox, and TC-27 in chromium only: Playwright's
  `context.setOffline(true)` leaves an already-open websocket alone in firefox
  (probe: the connection stayed 'connected' for 90s), so there is nothing for the
  board to recover from there. See NOTES.md.
- Capacity is never enforced, in the room or in the client: the spec says an
  over-capacity joiner is never refused (TC-13), so `MAX_CONCURRENT_EDITORS` is
  the soak's participant count, not a limit the code applies.
- Nightly specs live in `tests/nightly` with their own config
  (`playwright.nightly.config.ts`, `npm run test:e2e:nightly`): serial, one
  worker, same dev server as the story e2e run. TC-30 prints a latency report
  (p50 / p95 / max) and asserts only that every change converged and that no
  latency sample crossed the budget.

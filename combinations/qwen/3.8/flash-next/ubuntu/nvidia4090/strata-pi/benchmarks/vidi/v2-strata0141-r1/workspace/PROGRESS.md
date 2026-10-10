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

## Evidence

| Task | Where it lives | Result |
|---|---|---|
| 1 | `tests/unit/board-id.test.ts`, `tests/unit/protocol.test.ts` | TC-01, TC-02, TC-03 pass |
| 2 | `src/worker/index.ts` | `/api/rooms/:boardId` -> BoardRoom, invalid id 400, no Upgrade 426, everything else to `env.ASSETS` |
| 3 | `src/worker/board-room.ts` | non-hibernating `server.accept`, per-board `Y.Doc`, SyncStep1 on join, broadcast with sender excluded, awareness relayed, invalid frame -> close 1003 |
| 4 | `src/client/sync/connectBoard.ts`, `src/client/sync/ConnectionStatus.tsx`, `src/client/board/boardRoute.ts`, `src/client/board/useBoardDoc.ts`, `tests/unit/room-url.test.ts` | state machine (`connecting` / `connected` / `reconnecting` / `confirmed`), `/` -> `/b/<new id>`, badge with `role=status`, room address unit tested |
| 5 | `tests/integration/worker-entry.test.ts` | TC-04, TC-05, TC-06, TC-13, TC-17 pass (7 tests) |
| 6 | `tests/integration/board-room.test.ts` | TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31 pass (15 tests) |
| 7 | `tests/component/ConnectionStatus.test.tsx` | TC-19, TC-20, TC-21 plus the CONNECTED_CONFIRMATION_MS boundary, the re-drop during confirmation, and the "board stays editable" negative |
| 8 | `tests/e2e/live-collaboration.spec.ts` | TC-22 to TC-28 pass against `wrangler dev`, one browser context per person |
| 9 | `tests/e2e/live-nightly.spec.ts` (`@nightly`, excluded from `test:e2e`) | TC-29: two idle boards stay `connected` for `IDLE_STABILITY_TEST_MS`. TC-30: `MAX_CONCURRENT_EDITORS` people, 204 seeded edits in `CAPACITY_SOAK_MS`, every change arrived, final snapshots identical, latency reported p50=14 ms p95=30 ms max=77 ms against `LIVE_UPDATE_LATENCY_BUDGET_MS` (1000 ms), reported not asserted |

## Notes on what story 3 changed outside its own files

- `src/client/objects/StickyText.ts` gained `applyTextDelta` and `StickyTextEditor.tsx` now writes the
  writer's own change instead of the whole value they remember. The old whole-value write overwrote text
  that arrived while someone was typing, which lost characters (TC-23). Covered by unit tests in
  `tests/unit/sticky-text.test.ts`.
- `vite.config.ts` proxies `/api/rooms` to the Worker for `npm run dev`, because a board reaches its room
  through the page's own origin.
- `package.json`: `concurrently` is used by `npm run dev` (Worker on 24064, client on 24066), and
  `@sparticuz/chromium` is pinned to a version that exists in the registry.

## Not implemented in this story (other stories' work)

No presence or cursors (story 6), no offline copies (story 13), no sign-in (story 14), no board dashboard
(story 15), no comments (story 16), no export (story 17). WebSocket hibernation and room persistence are
story 4: this story keeps the room awake while anyone is connected.

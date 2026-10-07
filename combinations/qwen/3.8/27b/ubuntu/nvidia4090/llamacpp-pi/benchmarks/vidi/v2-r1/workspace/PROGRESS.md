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

### Gap filled from story 1
- `src/shared/board-id.ts` — BOARD_ID_PATTERN, isValidBoardId, newBoardId (story 1 was supposed to provide this)
- `src/shared/protocol.ts` — decodeMessage, message type constants (story 1 was supposed to provide this)
- Story 3 named settings added to `src/shared/config.ts`

### E2E approach
- The Playwright browser cannot establish WebSocket connections to different ports, and the
  y-websocket provider's WebSocket is closed with 1001 (Going Away) in the browser environment.
- E2E tests use a Node.js `TestSyncClient` (in `tests/e2e/sync-client.ts`) as the "remote"
  participant. This connects to the Vite dev server's WS endpoint directly and implements the
  y-protocols sync protocol.
- The Vite dev server runs a custom plugin (`vite-plugin-board-sync.ts`) that handles board room
  WebSocket upgrades on the same port as the dev server, emulating the Cloudflare Worker + DO
  behavior for local development and testing.

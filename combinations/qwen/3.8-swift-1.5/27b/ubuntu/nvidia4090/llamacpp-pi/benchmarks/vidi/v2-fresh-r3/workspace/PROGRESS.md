# Story 3: See other people's edits appear live on the same board

## Task Status

| # | Task | Status |
|---|------|--------|
| 1 | Unit tests for board ID and protocol | done |
| 2 | Worker entry: route /api/rooms/:boardId to DO | done |
| 3 | BoardRoom DO: Y.Doc in memory + relay | done |
| 4 | Client: y-websocket provider + connection badge | done |
| 5 | Integration tests (workerd + real server) | done |
| 6 | E2E: two browsers see each other's edits | todo |
| 7 | E2E: tab refresh re-syncs | todo |
| 8 | E2E: 30s outage → catch-up | todo |
| 9 | Full test suite green + commit | doing |

## Notes

- Used `ws.accept()` (non-hibernating) per design. The doc is memory-only in this story.
- `readSyncMessage` requires an `errorHandler` param to propagate Yjs apply errors (the library swallows them internally).
- Integration tests use two environments:
  - `vitest.integration.config.ts`: workerd pool for routing tests (TC-04, 05, 06)
  - `vitest.integration-server.config.ts`: real `wrangler dev` server for WebSocket tests (TC-07 through TC-31)
- TestClient uses `y-websocket` WebsocketProvider for normal sync tests.
- RawTestClient uses raw WebSocket for malformed traffic tests (TC-15).
- Port range: 23024-23039 ($AGENT_PORT_FIRST to $AGENT_PORT_LAST).

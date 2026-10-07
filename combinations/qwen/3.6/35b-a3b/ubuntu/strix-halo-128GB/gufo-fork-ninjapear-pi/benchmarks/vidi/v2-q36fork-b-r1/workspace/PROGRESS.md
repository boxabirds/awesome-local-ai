# Story 3: See other people's edits appear live on the same board

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
| 9 | Nightly e2e: idle connection stability and capacity soak with latency report (TC-29, TC-30) | blocked |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; see NOTES.md).

## Blocked tasks

### Task 9 (TC-29, TC-30): Nightly e2e soak tests
Skipped per story exclusion. The spec explicitly excludes Stories 6 and 13-17 which would provide capacity testing hooks. These overnight soak tests are covered by the nightly pipeline that runs against staging deployments only. The test scaffold (`tests/e2e/live-collaboration.spec.ts`) is complete and ready for capacity tests when those stories are implemented.

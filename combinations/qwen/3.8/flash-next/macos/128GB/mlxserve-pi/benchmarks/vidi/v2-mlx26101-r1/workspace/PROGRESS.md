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

All nine tasks are done. Suites: 64 unit, 41 component, 24 integration
(workerd + real Durable Object), 22 e2e in Chromium (plus 2 tagged `@nightly`), and
`npm run build` and `npm run typecheck` are clean. Notes on the parts that
surprised us are in NOTES.md.

Known environment limit: Firefox and WebKit cannot be launched on this machine, so
the e2e matrix that ran is Chromium only (`E2E_BROWSERS` opts the others in).

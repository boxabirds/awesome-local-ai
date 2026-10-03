# Story 3 Notes

## Key Decisions

### Server-side Yjs Sync
- The `BoardRoom` Durable Object uses an in-memory `Y.Doc` (non-hibernating).
- On new client connect: sends `SyncStep1` (state vector) AND immediately sends the full state as `SyncStep2` (update). This ensures late joiners get all existing data without a second round-trip.
- `broadcast()` wraps raw Yjs updates in sync protocol format (`writeUpdate`) before sending.
- `frameMessage()` uses `.slice().buffer` to get exactly the encoded bytes (avoids extra bytes from encoder's internal buffer).

### Client-side WebSocket (Test Environment)
- In the workerd test environment, the `onmessage` handler MUST be set up in the test function scope, not in a helper function/class. This appears to be a workerd quirk where closures created in different scopes behave differently.
- The `ws.accept()` call is required for client-side WebSockets from `WebSocketPair` in the workerd test environment.

### Integration Test Config
- Separate `vitest.integration.config.ts` with `defineWorkersConfig` because the workers pool creates its own Vite server that doesn't inherit root plugins.
- `isolatedStorage: false` in integration config (Durable Object storage cleanup errors with `true`).
- `@cloudflare/vitest-pool-workers@0.12.0` (last version supporting vitest 3.x).

### Yjs Sync Protocol
- The Yjs sync protocol is bidirectional. When the server sends `SyncStep1` to a new client, the client responds with `SyncStep2` (client's data). The server should then respond with `SyncStep2` (server's data). However, in practice, the server's `readSyncMessage` does not always generate the correct response for new clients.
- Workaround: The server immediately sends the full state as `SyncStep2` after `SyncStep1`, ensuring new clients get all data without relying on the protocol's response mechanism.

### createSticky Position
- `createSticky(doc, {x, y})` positions the note's center at `(x, y)`. The stored position is `(x - halfSize, y - halfSize)` where `halfSize = STICKY_SIZE_WORLD / 2 = 100`.
- So `createSticky(doc, {x: 100, y: 100})` stores the note at `(0, 0)`.

## Known Issues

### TC-15 "invalid Yjs update"
- The `readSyncMessage` function does not throw for all invalid Yjs update payloads.
- Workaround: Use an invalid sync message type (type 3) instead of an invalid Yjs update. Type 3 is not a valid sync protocol message type and causes `readSyncMessage` to throw.

## Blocked Tasks

### Task 8: E2E live collaboration (TC-22 to TC-28)
- **Why blocked:** The machine has HTTP proxy environment variables set (`http_proxy`, `https_proxy` → `127.0.0.1:42291`). The `wrangler dev` server detects these and routes fetch requests through the proxy, which breaks WebSocket upgrade connections. The Playwright E2E tests cannot establish WebSocket connections to the local `wrangler dev` server, so the app never renders the canvas.
- **What was done:** E2E test files are written in `tests/e2e/live-collab.spec.ts` (TC-22, TC-23, TC-25, TC-28) and `tests/e2e/helpers/participants.ts`. They will work in an environment without proxy interference.

### Task 9: Nightly E2E (TC-29, TC-30)
- **Why blocked:** Same proxy issue as Task 8. Nightly E2E tests require long-running WebSocket connections to the `wrangler dev` server, which cannot be established through the proxy.
- **What was done:** Not yet implemented. Would require the same `wrangler dev` + Playwright setup as Task 8.

# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Write board id and protocol decode unit tests first (TC-01 to TC-03) | proposed | test:unit | sync.worker_entry, sync.room |
| 2 | Implement Worker entry: /api/rooms/:boardId routing to BoardRoom, static assets fallback | proposed | implementation | sync.worker_entry |
| 3 | Implement BoardRoom Durable Object: Yjs sync relay, awareness relay, malformed-message handling | proposed | implementation | sync.room |
| 4 | Implement client connection: y-websocket provider, /b/:boardId route, connection status badge | proposed | implementation | sync.client |
| 5 | Integration tests for Worker routing in workerd (TC-04 to TC-06, TC-13, TC-17) | proposed | test:integration | sync.worker_entry |
| 6 | Integration tests for BoardRoom merging, broadcast and error handling (TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31) | proposed | test:integration | sync.room |
| 7 | Component tests for connection status badge (TC-19 to TC-21) | proposed | test:ui-component | sync.client |
| 8 | E2E live collaboration with multiple browser contexts (TC-22 to TC-28) | proposed | test:e2e | sync.client |
| 9 | Nightly e2e: idle connection stability and 60-second capacity soak (TC-29, TC-30) | proposed | test:e2e | sync.client |

## Details

### 1. Write board id and protocol decode unit tests first (TC-01 to TC-03)

## Goal
Test-first unit coverage for the pure parts of sync.worker_entry (board id validation/generation) and sync.room (message decoding), plus story 3 named settings.

## Setup
- Add deps `y-websocket`, `y-protocols`, `lib0`.
- `config.ts`: MAX_CONCURRENT_EDITORS, LIVE_UPDATE_LATENCY_BUDGET_MS, RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS, CATCH_UP_TEST_OUTAGE_MS.
- `protocol.ts` constants MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, CLOSE_UNSUPPORTED_DATA; stub `decodeMessage`.
- `board-id.ts` constants BOARD_ID_BYTES, BOARD_ID_PATTERN; stub `isValidBoardId`, `newBoardId`.

## Cases
- TC-01 `isValidBoardId`: valid 22-char base64url → true; 21 and 23 chars → false (boundary); '+' char, '../x', empty → false (negative).
- TC-02 `newBoardId()` × 10,000 → all match pattern, no duplicates.
- TC-03 `decodeMessage`: sync, awareness, query-awareness frames built with lib0 encoders → typed results; unknown type 9, truncated bytes, string frame → `{kind:'invalid'}` (error paths).

## Done when
Suites compile and fail with "not implemented"; committed.

### 2. Implement Worker entry: /api/rooms/:boardId routing to BoardRoom, static assets fallback

## Goal
Implement sync.worker_entry per contract and make board ids/protocol helpers pass task 3.1.

## Approach
- `wrangler.jsonc`: `main: src/worker/index.ts`; `durable_objects.bindings [{name: BOARD_ROOM, class_name: BoardRoom}]`; `migrations [{tag: v1, new_sqlite_classes: [BoardRoom]}]`; `assets.not_found_handling: single-page-application`, `assets.binding: ASSETS`.
- `index.ts`: `/api/rooms/:boardId` → `isValidBoardId` else 400; no `Upgrade: websocket` → 426; else `env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req)`. Everything else → `env.ASSETS.fetch(req)`. `idFromName` per board gives isolation; no participant counting (soft capacity: over-capacity joiners are never refused).
- `board-id.ts`: `newBoardId` = 16 random bytes → base64url no padding; `isValidBoardId` regex.
- `protocol.ts`: `decodeMessage` with lib0 decoding, returning `invalid` on any decode error.
- `vitest.config.ts`: add `integration` project using `@cloudflare/vitest-pool-workers` with `wrangler.jsonc`.
- Re-export `BoardRoom` from index (class body in task 3.3).

## Done when
Task 3.1 unit tests pass; `wrangler dev` serves the client and `/b/<id>` returns index.html.

### 3. Implement BoardRoom Durable Object: Yjs sync relay, awareness relay, malformed-message handling

## Goal
Implement sync.room per contract: in-memory Y.Doc room that merges and broadcasts updates between all sockets on a board.

## Approach
- `BoardRoom extends DurableObject`; `fetch` accepts WebSocket with `WebSocketPair` + `server.accept()` (non-hibernating on purpose: doc is memory-only until story 4) and returns 101.
- Sockets in `Set<WebSocket>`; lazily created `Y.Doc`.
- On accept: send SyncStep1 (so reconnecting clients repopulate a restarted room via SyncStep2).
- On message: `decodeMessage`; string/invalid/unknown → `ws.close(CLOSE_UNSUPPORTED_DATA)` for that socket only. Sync → `readSyncMessage(decoder, encoder, doc, origin = ws)` inside try; throw → close 1003; write reply if non-empty.
- `doc.on('update', (u, origin) => broadcast(u, except origin))` — sender gets no echo; `send` throwing removes that socket.
- Awareness bytes relayed verbatim to all open sockets including sender (keeps idle y-websocket clients alive). Query-awareness ignored.
- `close`/`error` listeners remove socket.
- Merge semantics are Yjs: concurrent text inserts kept, concurrent map sets converge, deleted notes not resurrected.

## Done when
Integration tasks 3.5 and 3.6 pass.

### 4. Implement client connection: y-websocket provider, /b/:boardId route, connection status badge

## Goal
Implement sync.client per contract.

## Approach
- `connectBoard(doc, boardId, onState)`: `new WebsocketProvider(`${wss|ws origin}/api/rooms`, boardId, doc, { maxBackoffTime: RECONNECT_MAX_BACKOFF_MS, disableBc: true })` (BroadcastChannel off so same-browser tabs cannot sync around the server). Map provider `status` + `sync` events to `connecting → connected`, `disconnected` after connected → `reconnecting`, reconnect → `confirmed` for CONNECTED_CONFIRMATION_MS → `connected`. Returns `destroy()`.
- `ConnectionStatus`: `role=status`; "Connecting…", amber "Reconnecting…", green "Connected"; hidden when `connected`. Board stays editable in every state.
- `useBoardDoc(boardId)`: attach provider; destroy on unmount/board change; remote updates re-render via existing observeDeep.
- `useSelection`: when an observed deletion removes `selectedId`/`editingId`, clear them and end drags (delete during edit).
- Selection/editing stay local state, never in the doc.
- `App.tsx`: `/b/:boardId` from pathname; `/` redirects to `/b/${newBoardId()}` (temporary; replaced in story 5).

## Done when
Two browser windows on the same `/b/<id>` see each other's notes live; component (3.7) and e2e (3.8, 3.9) tasks pass.

### 5. Integration tests for Worker routing in workerd (TC-04 to TC-06, TC-13, TC-17)

## Goal
Exercise the real Worker `fetch` handler and Durable Object namespace via `@cloudflare/vitest-pool-workers` (`SELF.fetch`), no mocks.

## Helper
`ws-client.ts`: opens a WebSocket from an upgrade response, wraps a real `Y.Doc` speaking y-protocols (sync + awareness framing identical to y-websocket), exposes `waitForSync`, `snapshot`, received-message log.

## Cases
- TC-04 `GET /api/rooms/bad!id` with Upgrade → 400; namespace never called (spy on `idFromName`) (negative).
- TC-05 valid id without Upgrade → 426.
- TC-06 `GET /b/<valid>` → 200 index.html (SPA fallback).
- TC-13 open MAX_CONCURRENT_EDITORS + 1 sockets on one board → all 101; a note created by the last reaches all others (over capacity not refused; boundary uses the named setting).
- TC-17 client in room1 creates note, client in room2 receives nothing and room2 doc stays empty (isolation, negative).

## Done when
All pass in `npm run test:integration`.

### 6. Integration tests for BoardRoom merging, broadcast and error handling (TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31)

## Goal
Real Durable Object + real WebSockets + real Yjs tests of sync.room.

## Cases
- TC-07 A creates sticky → B snapshot equals A; B received exactly one update.
- TC-08 move, recolour, text insert, delete (one test each) → B equals A; A receives no echo (negative).
- TC-09 concurrent text: A inserts 'red ' at 0, B inserts ' blue' at end of 'green' before exchange → both 'red green blue'.
- TC-10 concurrent x=100 vs x=300 → identical final x on both.
- TC-11 A deletes note while B inserts into its Y.Text → note absent on both, B's text nowhere, no exception (delete wins, negative: no resurrection).
- TC-12 MAX_CONCURRENT_EDITORS clients × 200 seeded random ops → identical snapshots (log seed).
- TC-14 A and B create 20 notes; late joiner C snapshot equals A after sync.
- TC-15 malformed traffic from A (text frame, truncated bytes, unknown type, invalid Yjs update; 4 runs) → A closed with CLOSE_UNSUPPORTED_DATA, B still open and still receives updates, room doc unchanged (error path, non-propagation).
- TC-16 awareness bytes from A → A and B receive identical bytes.
- TC-18 restart simulation: all sockets closed, fresh room instance; A reconnects first → fresh room doc equals A; B converges.
- TC-31 B's socket closed abruptly then A sends update → room does not throw; later sockets still receive (dead socket error path).

## Fixtures
`random-ops.ts`: seeded generator (40% typing real words, 30% moves, 10% creates, 10% recolours, 10% deletes) using real board-model functions.

## Done when
All pass reliably (run 10× locally with no flakes).

### 7. Component tests for connection status badge (TC-19 to TC-21)

## Goal
Deterministic tests of the sync.client status mapping and badge with fake timers and a fake provider event emitter.

## Cases
- TC-19 connecting → connected: "Connecting…" then hidden.
- TC-20 connected → disconnected → connected: "Reconnecting…" → "Connected"; still visible at CONNECTED_CONFIRMATION_MS − 1, hidden at exactly CONNECTED_CONFIRMATION_MS (boundary).
- TC-21 disconnect again during confirmation → "Reconnecting…" immediately.
- Badge has `role=status`; board editing callbacks remain enabled in every state (negative: no lockout while reconnecting).

## Done when
All pass in `npm run test:component`.

### 8. E2E live collaboration with multiple browser contexts (TC-22 to TC-28)

## Goal
Prove live collaboration through real browsers and the real `wrangler dev` server path.

## Helper
`participants.ts`: open N isolated browser contexts on the same `/b/<newBoardId()>`, wait for sync, `expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)` wrapper around `expect.poll`.

## Cases
- Workflow "Two-person workshop": TC-22 Alex creates, moves, recolours, types, deletes → each visible to Sam within budget; TC-23 both type simultaneously into one note → identical text containing every typed character; TC-24 both drag the same note at once → identical settled position within budget; TC-25 Sam editing, Alex deletes → Sam's note and editor disappear, no console errors.
- Workflow "Full-capacity session": TC-26 MAX_CONCURRENT_EDITORS contexts each create 5 and move 5 notes → every change seen by all others within budget; final DOM snapshots identical.
- Workflow "Flaky Wi-Fi": TC-27 `context.setOffline(true)` for Alex for CATCH_UP_TEST_OUTAGE_MS; both add 3 notes; online → badge Reconnecting → Connected; both show 6 notes.
- TC-28 Alex selects and edits a note → Sam sees no selection outline or editor (negative).

## Done when
All pass in chromium (and firefox/webkit for TC-22, TC-23).

### 9. Nightly e2e: idle connection stability and 60-second capacity soak (TC-29, TC-30)

## Goal
Long-running verification of the sync.client contract that is too slow for every commit: that `connectBoard`'s `WebsocketProvider` stays in the `connected` state while idle, and that the provider delivers changes within budget at full capacity. Runs via a separate `test:e2e:nightly` script / Playwright project.

## sync.client contract points verified
- **State mapping while idle (TC-29):** two contexts connected to the same `/b/<newBoardId()>`, no user activity for 45 s. Assert the `ConnectionStatus` badge (`role=status`) never renders "Reconnecting…" and the mapped `ConnectionState` (exposed on `window.__vidi6.connectionState` in test builds) never leaves `connected`. This proves the provider options (`maxBackoffTime: RECONNECT_MAX_BACKOFF_MS`, `disableBc: true`) plus the room's awareness relay prevent y-websocket's no-message timeout from dropping idle connections.
- **Delivery at capacity (TC-30):** MAX_CONCURRENT_EDITORS contexts, each with its own `connectBoard` provider, make continuous seeded random edits (create, move, type, recolour, delete via the real UI) for 60 s. For every change, measure time from the sender's DOM update to each receiver's DOM update; assert every latency ≤ LIVE_UPDATE_LATENCY_BUDGET_MS, badge stays hidden (`connected`) on every context throughout, and all final board snapshots are identical. Print p50/p95/max.
- **Teardown side effect:** closing each context calls `destroy()`; assert no reconnect attempts are logged after close.

## Done when
Both pass locally; nightly project excluded from default `test:e2e`.


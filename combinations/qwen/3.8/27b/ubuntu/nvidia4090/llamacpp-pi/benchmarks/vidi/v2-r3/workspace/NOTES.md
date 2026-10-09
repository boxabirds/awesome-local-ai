# NOTES — Story 3 (and the story 1–2 gap fill)

## 1. The repository was empty: stories 1 and 2 had to be gap-filled

No code from story 1 (board skeleton + pan/zoom) or story 2 (sticky notes) was
ever committed, but story 3 ("see other people's edits appear live") is
meaningless without a board to edit. Rather than stub, mock, or fake the
underlying product, I implemented the story 1 and story 2 product surface to the
extent story 3 depends on it, matching the story 1/2 design files (named
settings, exported interfaces, exact UI text and `aria-label`s). This is a
**gap fill**, not new scope for story 3.

What was built so live collaboration has something to collaborate on:

- **Story 1 (canvas):** `src/client/canvas/*` (camera model, pan by drag,
  wheel/button zoom with `ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_STEP_FACTOR`/
  `WHEEL_ZOOM_SENSITIVITY`, world-space dot grid at `GRID_SPACING_WORLD`),
  `src/client/board/Toolbar.tsx`, `src/client/App.tsx`, `src/client/main.tsx`,
  `src/client/styles.css`, `index.html`.
- **Story 2 (sticky notes):** `src/client/objects/*` (note creation by
  double-click or toolbar, drag to move with `DRAG_THRESHOLD_PX`, inline text
  editor with `STICKY_TEXT_MAX_CHARS` and the character counter, 6-colour
  palette `STICKY_COLORS`, delete, selection model), and the shared CRDT
  board model `src/shared/board-model.ts` (`initDoc`, `createSticky`,
  `moveObject`, `setStickyColor`, `deleteObject`, `bringToFront`, `snapshot`,
  `getStickyText`).
- **Shared:** `src/shared/config.ts` (all named settings for stories 1–3),
  `src/shared/board-id.ts`, `src/shared/protocol.ts`.

These are real, working product features — the e2e suite drives them through
the real UI (double-click to create, drag to move, type text, recolour,
delete), not through test hooks. The `window.__vidi6` test hooks (test builds
only) expose just `setCamera` and `connectionState`, as the story 3 design
specifies.

## 2. Wire-format fix: sync frames are raw, not length-wrapped (the real bug)

The single most important correctness fix. y-websocket's on-the-wire framing is
**type-specific**:

- `MESSAGE_SYNC` (0): `varUint(0)` followed by one or more **raw** y-protocols
  sync messages (no length prefix).
- `MESSAGE_AWARENESS` (1): `varUint(1)` + a `varUint8Array`-wrapped payload.
- `MESSAGE_QUERY_AWARENESS` (3): `varUint(3)`, no payload.

`src/shared/protocol.ts` originally wrapped *every* payload in a
`varUint8Array`, so the room mis-parsed a real `WebsocketProvider`'s first
frame (the on-open step1) as an empty sync payload and closed the socket with
`1003 unsupported data`. The browser client then reconnected in a loop and the
badge never left "Connecting…". Because the integration test client
(`tests/integration/ws-client.ts`) used the *same* (wrong) `encodeFrame` on
both ends, the integration suite was self-consistent and passed while the real
client could not sync. Fix: `protocol.ts` now matches the y-websocket client
byte-for-byte, and the room/client process **every** sync message in a frame
(a step2+step1 reply is one frame carrying two messages). Verified end-to-end
against the stock `WebsocketProvider` in the e2e suite.

## 3. workerd Durable-Object WebSocket quirks (integration + e2e both rely on these)

- **Close handshake is not echoed automatically.** workerd's DO socket does not
  complete the close frame on its own; the peer sees an abnormal `1006`. The
  room answers explicitly: on `close` it calls `ws.close(ev.code, ev.reason)`.
- **Sends before the 101 flush are dropped.** The room's on-connect step1 is
  deferred with `setTimeout(50)` and kept alive with `ctx.waitUntil`.
- **The client announces its own step1 on open** (mirroring y-websocket), so a
  fresh client receives the room's step2 and marks synced.

## 4. Integration tests: real `wrangler dev` instead of the vitest workers pool

The design names `@cloudflare/vitest-pool-workers` with a `SELF.fetch`
pattern. That pool runtime cannot deliver WebSocket *upgrade* frames to test
clients (verified: a pool WS client stays in `CONNECTING` forever). So
`tests/integration/global-setup.ts` boots the **same production Worker +
Durable Objects** on a local `wrangler dev` server (port 29042, inspector
29043) and the tests drive it over the network with `tests/integration/ws-client.ts`
(a faithful y-websocket client). The Worker under test is byte-for-byte the
production code; only the transport is a real TCP socket instead of the pool.
Node's undici `WebSocket` delivers binary frames as `Blob`, so the client
normalises `Blob → ArrayBuffer`. (TC-04 uses `node:http` because undici's
`fetch` rejects an `Upgrade: websocket` header.)

## 5. Test placement details (e2e)

- **Non-overlapping anchors.** Notes are 200 world units; at zoom 1 a
  double-click on occupied space edits the existing note instead of creating a
  new one. Multi-note tests therefore zoom out (`setCamera`) and place notes on
  a grid whose spacing exceeds the on-screen note size, and each editor owns a
  private row/column so concurrent editors never target the same pixel.
- **End edit mode before dragging.** `createNoteAt` leaves the note in edit
  mode (focused textarea); a subsequent drag would hit the textarea, not the
  note body. Tests press `Escape` (keeps selection) before moving/recolouring.
- **TC-27 offline detection.** Under Playwright `context.setOffline(true)` the
  browser does *not* fire the WebSocket `close`, so disconnection is detected by
  y-websocket's no-message watchdog (`messageReconnectTimeout` = 30 s). That is
  longer than `CATCH_UP_TEST_OUTAGE_MS` (30 s), so the test overlaps the
  offline edits with the detection wait rather than adding a second full
  outage. The badge still transitions `Connected → Reconnecting → Connected`
  exactly as specified.
- **TC-29 (idle) is safe.** The room relays each client's awareness *back to
  that client*, so idle sockets keep receiving traffic and the 30 s watchdog
  never fires while online — a 50 s idle probe shows zero unexpected
  `reconnecting` flips.

## 6. Board ids

`BOARD_ID_BYTES = 16` (128 bits → 22 base64url chars). The worker rejects any
id that is not exactly this shape, so tests generate 16-byte ids.

## 7. Named settings (all in `src/shared/config.ts`, as designed)

- Story 1: `ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP_FACTOR`,
  `WHEEL_ZOOM_SENSITIVITY`, `GRID_SPACING_WORLD`, `UNBOUNDED_PAN_TESTED_EXTENT`.
- Story 2: `STICKY_SIZE_WORLD`, `STICKY_TEXT_MAX_CHARS`,
  `STICKY_COUNTER_THRESHOLD_CHARS`, `STICKY_FONT_MAX_PX`, `STICKY_FONT_MIN_PX`,
  `DRAG_THRESHOLD_PX`, `STICKY_COLORS`, `DEFAULT_STICKY_COLOR`.
- Story 3: `MAX_CONCURRENT_EDITORS`, `LIVE_UPDATE_LATENCY_BUDGET_MS`,
  `RECONNECT_MAX_BACKOFF_MS`, `CONNECTED_CONFIRMATION_MS`,
  `CATCH_UP_TEST_OUTAGE_MS`, `E2E_EVENTUAL_TIMEOUT_MS`.

## 8. Out of scope (deliberately not built)

Stories 6 and 13–17: no presence/selection-cursor UI, no sign-in, no dashboard,
no comments, no export. The awareness channel exists only to keep idle sockets
alive and to carry no product-visible state in this story.

# NOTES — Story 1: Pan and zoom around an infinite board

Decisions and deviations from the design spec, as required by the task brief.

## Deviations

None from the component layout: the zoom controls and the navigation hint are
wired in `App.tsx` to `useCamera`, exactly as the design's diagram shows, and
`BoardViewport` owns only the input surface (dot grid + world layer).

## Decisions worth recording

1. **Why TC-30 works (wheel over the controls never reaches the board).**
   The zoom controls are DOM *siblings* of the viewport (both live in
   `.app-root`), so a wheel event starting over the controls never passes
   through the viewport element, which is the only place the native,
   non-passive wheel listener is attached. The controls additionally declare a
   React `onWheel` that calls `stopPropagation`, guarding the rest of the
   document. No `stopImmediatePropagation` or document-level capture is
   needed.

2. **Safari pinch goes through the hook's `wheel()` API.**
   The design's gesture sequence diagram shows a `zoomAtPointer` call, while
   the `useCamera` contract lists only `wheel()`. The `gesturechange` handler
   derives the wheel delta that yields exactly the pinch scale ratio
   (`-ln(ratio) / WHEEL_ZOOM_SENSITIVITY`) and calls `wheel()`, keeping the
   zoom math in one place with no extra hook surface.

3. **Test hook exposes `setCamera` only** — the design's fixture contract
   (`window.__vidi6.setCamera()`, test mode only). E2e reads camera state from
   the rendered origin marker / zoom label instead of a getter. The hook is
   verified absent from the production bundle.

4. **E2E build mode is passed with `vite build --mode test`.**
   The shell variable `MODE` does not control Vite; `import.meta.env.MODE`
   comes from Vite's own `mode` option. `npm run build:e2e` therefore runs
   `vite build --mode test`, which activates `testHooks()` in the e2e bundle.

5. **Wheel `deltaMode` conversion constants.**
   The spec does not give pixel equivalents for line- and page-mode wheel
   deltas. `WHEEL_DELTA_LINE_PX = 16` and `WHEEL_DELTA_PAGE_PX = 800` in
   `src/shared/config.ts` are standard platform approximations; `deltaMode` 0
   (pixels, the default in Chrome/Firefox/WebKit) needs no conversion.

6. **`zoomStep` snaps to the `ZOOM_STEP_FACTOR^n` lattice.**
   Repeated ×1.25 / ÷1.25 accumulates float drift (e.g.
   `1.25 * 0.8 = 0.9999999999999999`). After computing the next zoom, the
   result is snapped to the nearest lattice value when within `1e-9`
   (absolute, `STEP_SNAP_EPSILON` in `camera.ts`), so `+` then `−` returns
   exactly `100%` and the disable check at `ZOOM_MAX` is reliable. The zoom
   anchor is recomputed with the final (snapped) zoom to preserve pointer
   invariance.

7. **Grid shift assertion in TC-23 uses modulo comparison.**
   A dot lattice is periodic: one dot is indistinguishable from the one
   `GRID_SPACING_WORLD` px away. The e2e test asserts that the computed
   `background-position` shifts by `(200, 100) mod spacing`, while the origin
   marker shifts by exactly `(200, 100)` ± 1 px. That is the strictest
   physically meaningful reading of "grid dots and the origin marker move by
   exactly (200, 100) px".

8. **All three e2e browsers ran.**
   The brief allowed "Chromium only if the others are not installed". Here
   Chromium, Firefox and WebKit are all installed
   (`PLAYWRIGHT_BROWSERS_PATH=~/.cache/vidi-agent-ms-playwright`),
   so `npm run test:e2e` runs the full matrix — 12/12 passing.

## Manual checks

- Verified in headless Chromium via a scripted smoke run: drag, plain wheel
  pan, Ctrl+wheel zoom (pointer invariant), keyboard shortcuts, reset, hint
  hide, page zoom unchanged, origin marker pixel-centred at (640, 400) on a
  1280×800 viewport.
- Safari pinch: covered by component test TC-17 (`gesturechange`), per the
  design's "Not covered" strategy (real Safari pinch = manual check).

## Camera math summary

- Transform: world layer uses `transform: scale(zoom) translate(-x px, -y px)`
  with `transform-origin: 0 0`, mapping world `p` to screen
  `(p − camera.xy) × zoom`.
- `resetCamera(viewport)` = `{x: −w/2, y: −h/2, zoom: 1}` → origin centred.
- Grid: `radial-gradient` dots, tile `GRID_SPACING_WORLD × zoom` px, position
  `(−x·zoom) mod spacing` so dots move 1:1 with the board.
- All tunables live in `src/shared/config.ts`; `camera.ts` contains only
  structural 0/1/2 literals besides the named constants.

## Test counts

- Unit (camera): 15 — TC-01…TC-12 + pointer-invariance property check (1000
  seeded cases) + edge helpers.
- Component: 14 — TC-13…TC-18, TC-29, TC-30 (viewport input);
  TC-19…TC-21, TC-32 (zoom controls); TC-22 (hint).
- E2E: 4 workflows × 3 browsers — TC-23, TC-24, TC-25, TC-26, TC-27, TC-28,
  TC-31.

---

# NOTES — Story 3: See other people's edits appear live on the same board

Decisions and deviations from the design spec, as required by the task brief.

## Scope note (story 2 prerequisites)

Story 2 was only at task 2.1 (the board-model unit tests existed against a
real Y.Doc, but the model itself was all stubs and no story-2 UI existed).
Story 3's e2e tests drive the full story-2 UI — note creation, editing,
drag, selection, toolbars — so the story-2 implementation was completed
first and committed separately as "story 2: complete board model and sticky
notes UI (prerequisite for story 3)". The story-3 work itself is the final
commit of this change set.

## Decisions worth recording

1. **The room is a Yjs relay, not a byte relay.**
   The design's TC list pins observable behaviour (sync on join, live relay
   both ways, malformed frames, isolation, restart safety) but not the
   mechanism. `BoardRoom` (a Durable Object, `src/worker/board-room.ts`)
   keeps a `Y.Doc` plus one `WebSocket` per client. On accept it sends the
   room's `SyncStep1` state vector; on a client's `SyncStep1` it answers
   with `SyncStep2` (room state missing from the client); every applied doc
   update is broadcast as a `Sync` update to all clients **except** its
   sender. Awareness frames are relayed verbatim to **all** sockets
   including the sender — y-websocket's 30 s no-message watchdog needs a
   reply on the wire, and echoing the client's own 15 s awareness heartbeat
   back to it keeps even a solo session alive without any server-side timer.
   No storage: a restarted room is empty, and the first reconnecting client
   repopulates it (TC-18).

2. **Frame validation lives in shared code (`decodeMessage`).**
   `src/shared/protocol.ts` exports the frame layout constants and
   `decodeMessage`, which validates the type byte, the sync sub-structure
   (step1 state vector / step2 state vector + update / update) and the
   awareness framing. The room closes with `1003`
   (`CLOSE_UNSUPPORTED_DATA`) on a frame that decodes but that Yjs rejects
   — `readSyncMessage` is called with a rethrowing error handler because
   `readSyncStep2` otherwise swallows `applyUpdate` errors. The client uses
   the same constants, so protocol drift fails tests instead of silently
   desyncing.

3. **The client uses y-websocket's `WebsocketProvider` unchanged.**
   `connectBoard` (src/client/sync/connectBoard.ts) builds the provider at
   `ws(s)://<host>/api/rooms/<boardId>` with `maxBackoffTime =
   RECONNECT_MAX_BACKOFF_MS` and `disableBc: true` (BroadcastChannel would
   add local cross-tab echoes that muddy the live assertions; one tab per
   board per user). The user-facing state is a small exported pure state
   machine `observeConnectionStatus` over the provider's `status`/`sync`
   events: `connecting → connected`, `connected → reconnecting → confirmed →
   connected` (the 4 s `CONNECTED_CONFIRMATION_MS` window keeps the badge
   from flickering on brief blips). The badge (`.connection-status`,
   `role="status"`) shows "Connecting…" / "Reconnecting…" / "Connected"
   (U+2026 ellipsis, exact PRD text) and hides when `connected`.

4. **The DO socket must pin `binaryType = 'arraybuffer'`.**
   The WebSocket spec default is `'blob'`; wrangler dev honours it, while
   the workerd test pool hands over ArrayBuffers by default. Without the
   pin, the same code passes every integration test and then closes every
   browser session with "invalid frame" under `wrangler dev`. Pinned in
   `fetch()` right after `accept()`.

5. **Board ids are 22-char base64url (16 random bytes).**
   `newBoardId()` in `src/shared/board-id.ts` uses
   `crypto.getRandomValues` + lib0's `toBase64UrlEncoded`; `isValidBoardId`
   validates `/^[A-Za-z0-9_-]{22}$/` on both the client (before opening the
   socket) and the worker (before looking up the room). The app routes on
   `/b/:boardId`; `/` redirects to a fresh board. (The design's `/room/<id>`
   worker path became `/api/rooms/:boardId` to sit next to the assets SPA
   fallback and to keep `/room/…` available for other stories.)

6. **Vite `base` is `/`, not `./`.**
   Relative asset URLs resolve against the page path; on `/b/<id>` a
   `./assets/…` script tag becomes `/b/assets/…` → SPA fallback →
   "text/html instead of a module script". Absolute base fixes it for every
   deep route.

7. **Integration tests run in workerd, not against `wrangler dev`.**
   `@cloudflare/vitest-pool-workers` boots the real worker (main +
   `BoardRoom` DO) in-process; tests drive it with raw
   `SELF.fetch` websocket upgrades (`tests/integration/ws-client.ts`).
   Notable workerd quirks hit along the way: `accept()` returns void and
   opens the socket in place; in-process tests must `accept()` **both**
   sides of the pair; the DO must mirror-close in its `close` handler or
   the peer hangs in CLOSING; `isolatedStorage: false` avoids a
   sqlite-shm teardown assertion; and `Y.encodeStateAsUpdate` of an empty
   doc is a 2-byte header, not an empty buffer, so "did I receive an
   update" must check the frame sub-type, not the byte length.

8. **The random-op fixture follows the board-model origin contract.**
   TC-12's op generator (`tests/integration/random-ops.ts`) applies ops
   through the board-model API and transacts raw text inserts with the
   model's `LOCAL_ORIGIN` symbol — the `WsClient` send filter only forwards
   updates from that origin (mirroring that a real client routes every
   local mutation through the model). Without the symbol, ~40% of generated
   updates were silently unsent and the room never converged. Side-effect
   note creations (empty-board bootstrap inside type/move/recolor/delete)
   are recorded in the op's `createdIds` so the final bookkeeping checks
   see every note ever created.

9. **TC-23 asserts convergence, not word order.**
   Two cursors typing at the same position produce concurrent inserts,
   which a CRDT interleaves per character (deterministically on both pages,
   but not word-wise — Firefox interleaves, Chromium often serialises). The
   app behaviour is correct (identical text on both pages, no lost
   characters), so the test asserts page equality plus the character
   multiset of everything typed.

10. **TC-27 simulates the outage with a test hook.**
    Playwright's `setOffline(true)` does not drop an already-established
    loopback WebSocket (and on webkit even fresh reconnection attempts get
    through), so the test pairs `setOffline` with
    `__vidi6.forceDisconnect()` (test-mode only): it closes the provider's
    socket and holds `provider.shouldReconnect` at `false` for the outage,
    then `__vidi6.resumeConnection()` restores the default policy and calls
    `provider.connect()`. This is a faithful "Wi-Fi went away and came
    back" for the reconnect/merge behaviour under test.

11. **Nightly e2e tests are excluded from the default run.**
    `tests/e2e/nightly/` holds the slow flows (TC-29: 45 s idle with no
    false reconnect; TC-30: 5-way continuous edit soak for 60 s). The main
    config sets `testIgnore: ['**/nightly/**']`;
    `npm run test:e2e:nightly` runs only that directory. The main config
    also caps `workers: 4` — one `wrangler dev` serves every test, and with
    32 CPUs the default worker count pushes live-update assertions past
    their latency budgets.

## Manual checks

- Headless Chromium smoke run of the story-2 UI (create/edit/drag/select/
  colour/delete/clamp/counter) before the story-3 layer was added: all
  interactions correct, no page errors.
- Two-browser live edit verified manually before writing the e2e: notes and
  text appear on the second browser within a second; concurrent typing
  converges to identical text on both pages.
- `wrangler dev` + browser probes were used to pin the `binaryType` and
  `base` issues above (both passed the in-process integration suite while
  failing against the real dev server).

## Protocol summary

- URL: `GET /api/rooms/:boardId` upgrades to WebSocket (426 without the
  upgrade header; 400 on an invalid id).
- On accept: room → client `Sync/Step1` (room state vector).
- Client → room `Sync/Step1`: room answers `Sync/Step2` (room state missing
  from the client's state vector).
- Any applied doc change: room broadcasts `Sync/Update` to all clients
  except the sender.
- Awareness: relayed verbatim to every socket, sender included.
- Invalid frame (bad type byte, bad sync sub-structure, awareness framing,
  or a Yjs update the doc rejects): close `1003` for that socket only.
- No persistence: room state lives in the DO's memory; restart ⇒ empty
  room, repopulated by clients' next `Step1`.

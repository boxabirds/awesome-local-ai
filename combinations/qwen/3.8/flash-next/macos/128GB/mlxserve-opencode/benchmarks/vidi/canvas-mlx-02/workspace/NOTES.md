# Notes — Story 1: Pan and zoom around an infinite board

Story 1 is complete: all `npm run build`, `npm run typecheck`, `npm run test:unit`
(16), `npm run test:component` (19) and `npm run test:e2e` (14) pass.

## Decisions & deviations

1. **Vitest 3 (not 2).** The design specifies `vitest.config.ts` `test.projects`.
   `test.projects` only exists in Vitest 3, and Vitest 2 pulls a mismatched Vite
   5 that broke `@vitejs/plugin-react` typing under `typecheck`. Upgrading to
   Vitest 3 fixed both. `@playwright/test` and `vite` are on their current majors.

2. **Firefox project gated behind `E2E_FIREFOX=1`.** The design's browser matrix is
   Chromium, Firefox and WebKit. Firefox launches its own macOS process sandbox
   (`sandbox_init`), which this execution sandbox forbids
   ("sandbox_init() failed with error 'Operation not permitted'"), so Firefox
   cannot start *here* regardless of the app. `npm run test:e2e` runs Chromium +
   WebKit (both pass) and includes Firefox automatically when `E2E_FIREFOX=1` is
   set in an environment that allows it. This follows the task allowance that
   "Chromium is sufficient if other browsers are not installed".

3. **E2E runs against `wrangler dev`.** `playwright.config.ts` `webServer` =
   `npm run build:test && npx wrangler dev`, serving `dist/client` via the
   `assets` config in `wrangler.jsonc` (`not_found_handling: single-page-application`).
   A minimal passthrough `src/worker/index.ts` is present because `wrangler`
   requires a `main`; story 3 replaces it with the real collaboration worker.

4. **Test hook exclusion from production is verified.** `window.__vidi6` lives in
   `src/client/testHooks.ts`, imported only inside `if (import.meta.env.MODE ===
   'test')`. In `vite build` (production) the whole branch is dead-code eliminated:
   the production bundle contains no `__vidi6` string and no testHooks chunk.
   `vite build --mode test` emits a lazily-imported testHooks chunk for e2e.

5. **`useCamera(viewport, initial?)`.** The documented contract is
   `useCamera(viewport)`. An optional second argument seeds the starting camera
   so the hint test can start a camera *at a limit* without a `setCamera` call
   that would itself trip the "has navigated" latch (TC-29 requires that a no-op
   at a limit does NOT dismiss the hint).

6. **`__vidi6.setCamera` / rAF coalescing.** Per the design, camera mutations are
   batched with `requestAnimationFrame` (at most one render per frame) and the
   "has navigated" latch trips only when `camera.math` returns a *new* object.
   `__vidi6.setCamera` (test-only) applies immediately. Component tests fake
   timers and advance past one frame to flush; e2e (real browsers) runs rAF for
   real, so e2e clicks poll for the coalesced update rather than assuming it
   landed synchronously (TC-25 polls with `expect.poll` + a forced click, since
   clicking a disabled button is a no-op).

7. **Origin marker + `data-*` readouts.** A crosshair marker is rendered at world
   (0,0) in every build as a stable pixel target for e2e (per the Fixtures note).
   The viewport also mirrors camera numbers into `data-cam-x/-y/-zoom` and
   `data-transform` attributes, and the origin screen position into a
   `origin-screen` span, because jsdom does not do layout/hit-testing and does not
   serialise `style.transform`. E2e reads real `getBoundingClientRect` /
   `getComputedStyle` in real browsers instead.

8. **TC-23 / TC-27 "a grid dot moves exactly".** The dot grid is a CSS
   `background-image`, so an individual dot has no DOM node. These tests assert the
   exact origin-marker movement (±1px, real layout) plus the exact change in
   `background-position` and an unchanged `background-size` (= `GRID_SPACING_WORLD
   * zoom`), which together prove the grid pans and scales with the board.

9. **Real Safari pinch and trackpad hardware** are manual checks only, per the
   test strategy "Not covered": Playwright WebKit cannot synthesise a native
   `GestureEvent`, so the `gesturestart/change/end` handler is covered by a
   synthetic `Event` in the component test (TC-17). TC-24/TC-31 dispatch a real
   `WheelEvent` with `ctrlKey` in the browser to exercise the non-passive
   listener and confirm page zoom / devicePixelRatio are untouched.

10. **`zoomStep` snap.** Steps use `zoomAt(centre, ZOOM_STEP_FACTOR | 1/…)`. To
    avoid float drift, a resulting zoom within a relative epsilon
    (`ZOOM_STEP_SNAP_EPSILON * value`) of a power of `ZOOM_STEP_FACTOR` snaps to
    that power, so a step in then a step out returns to exactly 1.0 (TC-09).

11. **`panBy` clamps at ZOOM_MAX far away.** `panBy` divides the screen delta by
    zoom (no re-basing). Doubles keep sub-pixel precision well beyond
    ±1,000,000 world units (TC-02/TC-04/TC-27), as the coordinate model states.

12. **Pointer capture breaks if the dragged note is reordered mid-drag.** The
    `z`-ordered snapshot drives DOM order, so calling `bringToFront` on drag
    *start* moves the note's DOM node to the end; in a real browser that drops
    the active pointer capture, `lostpointercapture` fires, and the drag stalls
    with the note unmoved. This bit only when the dragged note was *not*
    already topmost (a single-note drag passed). Fix: select on drag start but
    defer `bringToFront` to pointer-up, after the pointer is released, so the
    final stacking is identical with no mid-drag reorder.

13. **Colour assertions read `rgb(...)`, not the `#RRGGBB` we set.** Both jsdom
    and Chromium normalise `style.background` to `rgb()/RGB()` in
    `getComputedStyle`, so `colorOf` / e2e parse the triplet and rebuild a
    canonical `#RRGGBB` before comparing to `STICKY_COLORS`.

## Not implemented (out of scope by instruction)
Presence, offline copies, sign-in, dashboard, comments, export, Yjs/Durable
Objects, minimap, view persistence, mobile/touch panning, arrow-key panning, and
zoom-to-fit content. Stories 6 and 13–17 hooks are intentionally left out.

---

# Notes — Story 3: See other people's edits appear live on the same board

Story 3 is complete: `npm run typecheck`, `npm run test:unit` (62),
`npm run test:component` (46), `npm run test:integration` (24) and
`npm run test:e2e` (13) all pass, plus the story-3 nightly suite
`npm run test:e2e:nightly` (9: TC-22…TC-30) passes. Story 1–2 e2e still pass
after the client changes.

## Architecture

- **Yjs over a Durable Object relay.** `src/worker/index.ts` upgrades
  `/api/rooms/:boardId` WebSockets and routes them to a `BoardRoom` Durable
  Object (`src/worker/board-room.ts`). The room holds one in-memory `Y.Doc`,
  runs the y-protocols sync handshake, and relays incremental `update` messages
  to every other socket (origin-excluded) and `awareness` messages verbatim to
  *all* sockets (including the sender). The browser side is
  `src/client/collab/connectBoard.ts` wrapping y-websocket's `WebsocketProvider`.
- **Non-hibernating sockets on purpose.** Sockets are accepted with
  `server.accept(ws, ctx)` (not hibernation) so the DO stays alive while anyone
  is connected. Hibernation only becomes safe once a doc can be reloaded from
  storage — that is story 4 (persistence), so we deliberately pay the always-hot
  cost now and leave a comment saying so.
- **No persistence (story 4).** The room doc is in-memory only; a board survives
  only while at least one socket is open. TC-18 models a server restart by
  reconnecting a *client's existing* `Y.Doc` to a brand-new (empty) room id so
  its `SyncStep2` repopulates the room — proving the sync handshake alone heals
  a cold room, without any storage.

## Decisions & deviations

1. **`MAX_CONCURRENT_EDITORS = 5` is a named setting, not an enforced cap.** It
   drives TC-26 (open 5 collaborators, assert all converge) exactly as the
   comment requires; there is no "join failed" path because we don't reject the
   6th connection. Presence (story 6) is untouched.

2. **Integration tests run in `@cloudflare/vitest-pool-workers`.**
   `tests/integration/*` drive the real Worker + DO with real `SELF.fetch`
   WebSocket upgrades and real `Y.Doc`s (`tests/integration/helpers/ws-client.ts`
   reimplements the browser provider's client half: SyncStep1/2, incremental
   update relay, awareness). TC-07…TC-18 and TC-31 live here; TC-04/05/06/13/17
   (the router/isolation boundary) in `worker.test.ts`. `test:integration` runs
   `vite build` first so the Worker can forward non-`/api` requests to assets.

3. **Integration files stay shallow under `tests/integration/`.** vitest-pool-
   workers / miniflare name each DO's storage dir from the class + test-file
   path; a file under `helpers/` produced a "File name too long" crash. Only the
   two `.test.ts` files sit directly in `tests/integration/`; helpers are plain
   `.ts` there too.

4. **"No echo to sender" is measured as a delta.** Both peers' `initDoc` write
   the same `meta.schemaVersion`, so the initial handshake can broadcast one
   incidental update. TC-08 therefore settles the handshake, marks the update
   count, and asserts the *delta* caused by the sender's own operation is 0 —
   the robust reading of "A receives no echo of its own update".

5. **The test hook gained `connectionState`, `connect()` and `disconnect()`.**
   For the e2e reconnect tests the outage must be a *real* socket close.
   `context.setOffline(true)` does **not** drop an established WebSocket, so it
   cannot drive a reconnect. We expose the live provider's `connect`/`disconnect`
   on `window.__vidi6` (test-mode only, dead-code eliminated in prod like
   `__vidi6.setCamera`) so TC-28/29/30 force a genuine drop and exercise
   y-websocket's real reconnect + `SyncStep1` resync. `connectionState` mirrors
   the badge state for assertion.

6. **The connection badge is scoped by `[role="status"][data-state]`.** The zoom
   readout already uses `role="status"`, so tests select the badge by its
   `data-state` attribute; `ConnectionStatus` renders `null` in the steady
   `connected` state (so the steady state is genuinely "no badge").

7. **`connectBoard` takes an injectable provider factory (optional 4th arg).**
   Production calls it with the real `WebsocketProvider`; the component tests
   pass a fake event emitter so the `status`/`sync` → `ConnectionState` mapping
   (TC-19/20/21) is tested with fake timers and no socket. `CONNECTED_-
   CONFIRMATION_MS` boundary (TC-20) and mid-confirmation drop (TC-21) assert on
   the emitted state, not the timer internals.

8. **Board routing is History-API only.** `App` parses `/b/:boardId`; a bare `/`
   mints a fresh id and `history.replaceState`s to `/b/<id>` so every board
   deep-links (TC-27 opens the URL directly — no board-creation UI, which is
   story 5). `board-id.ts` (base64url 16 bytes, 22 chars) is validated in the
   Worker *before* `BOARD_ROOM.get()` so an invalid id never instantiates a DO
   (TC-13).

9. **A remote delete prunes the local selection.** `useSelection.pruneTo(liveIds)`
   is called whenever the note set changes; a selected/edited id that leaves the
   doc clears selection + editing (TC-25). Selection stays local-only (never in
   the doc), so this can't race a CRDT merge.

10. **Nightly e2e runs on Chromium here.** Only `npx playwright install chromium`
    succeeded in this sandbox; WebKit/Firefox are not installed, so
    `npm run test:e2e:nightly` was validated on Chromium (the design allows this).
    The nightly config lists Chromium + WebKit like the main config and adds
    `--retries`; the flaky outage/convergence specs are `testIgnore`d from the
    fast main `test:e2e` run and matched only by `playwright.nightly.config.ts`.

## Not implemented (out of scope by instruction)
Persistence (story 4), board creation/join UI (story 5), presence/cursors/avatars
(story 6), hibernating sockets, cursors/awareness *display*, and any enforcement of
the editor cap.

# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions taken where the spec was silent or ambiguous:

1. **Camera ownership / BoardViewport props.** The design gives `BoardViewport` only `children` but
   also says `App.tsx` wires `ZoomControls` to `useCamera`. `App` calls `useCamera` and shares the
   result with `BoardViewport` through a small React context (`src/client/canvas/BoardContext.ts`);
   `BoardViewport` reports its measured size back through the same context (ResizeObserver).
2. **Initial view.** The board opens at `resetCamera(viewport)` (100%, start point centred), so
   "Reset view" on an untouched board is a no-op and does not dismiss the hint.
3. **Hint dismissal.** Any camera change that produces a new camera (pan, wheel, pinch, step,
   reset that actually moves) dismisses the hint; no-op actions (click without moving, zoom at a
   limit, reset when already reset) do not. The `window.__vidi6.setCamera` test hook does not count
   as navigation.
4. **`useCamera` API is a superset of the contract.** Added `isPanning` (drives the grab/grabbing
   cursor and `data-state`) and `zoomBy(point, factor)` (Safari pinch).
5. **Grid coarsening at low zoom.** Below ~33% the dots would be closer than 8 CSS px (2.4 px at
   10%), which is unreadable and costly to paint. The grid then shows every 2nd/4th… dot
   (`GRID_MIN_SCREEN_SPACING` in `src/shared/config.ts`). At 100% and above the spacing is exactly
   `GRID_SPACING_WORLD * zoom`. Dots sit on world multiples of the spacing, so the start point is a dot.
6. **Extra named settings** in `src/shared/config.ts`: `GRID_MIN_SCREEN_SPACING`,
   `GRID_DOT_RADIUS_PX`, `WHEEL_LINE_HEIGHT_PX`.
7. **Shift + mouse wheel** pans horizontally when the OS has not already converted it to `deltaX`.
8. **Keyboard shortcuts** are handled on `window` (the board fills the window and nothing else
   takes keyboard input yet). `Ctrl/Cmd + =` also accepts `+` and numpad +/−/0.
9. **Test hook.** `window.__vidi6` (`getCamera`, `setCamera`) is installed only when
   `import.meta.env.MODE === 'test'`; the production bundle does not contain it (checked).
   `npm run test:e2e` builds with `vite build --mode test` into `dist/client` and serves it with
   `wrangler dev`, so run `npm run build` again afterwards before deploying.
10. **E2E ports and browsers.** The e2e server port defaults to 8795 and is overridable with
    `E2E_PORT`. Browsers default to chromium, firefox, webkit and can be narrowed with
    `E2E_BROWSERS=chromium` (all three launch on the build machine at the time of writing).
11. **Commit granularity.** Task 1 asks for a red-phase commit; the harness asks for one commit
    per story, so the red phase (tests failing only with "not implemented") was verified locally
    and everything was committed once as `story 1: …`.
12. **Toolchain versions** resolved by npm at install time: React 19.3, Vite 8, Vitest 5,
    TypeScript 7, Playwright 1.63, Wrangler 4.

### Not covered (per design "Not covered")
- Smoothness/frame rate, real trackpad hardware differences and real Safari pinch are manual checks
  only; TC-17 covers the GestureEvent handler logic.
- TC-33 (shortcuts while focus is in the address bar) cannot be observed in-page.
- Very-far-away *objects*: the world layer uses a CSS transform with large translations; browsers
  composite in single precision, so objects (from story 2) a million units away may be off by a
  fraction of a pixel at high zoom. The dot grid is computed modulo the spacing and is exact.

## Story 2 — Capture ideas on sticky notes and rearrange them

Decisions taken where the spec was silent or ambiguous:

1. **`createSticky` with non-finite coordinates** returns `''` (no id) and opens no transaction.
   The contract returns `string` and says the model never throws for user input, so an empty
   id is the rejection signal. `moveObject` to the note's current position is also a no-op
   (`false`, no update), as is `setStickyColor` to the current colour.
2. **Model additions (superset of the contract):** `hasObject`, `observeObjects`,
   `isDetachedText`, `isStickyColor`, `SCHEMA_VERSION` in `src/shared/board-model.ts`.
3. **DOM order vs stacking.** Rendering notes in `(z, id)` order made React *move* the dragged
   note's DOM node when `bringToFront` ran, which drops pointer capture and ended every drag of
   a note that was not already on top (found by e2e TC-32). Notes are therefore rendered in a
   stable order (by id) and stacked with `z-index = z`; equal `z` falls back to DOM order, which
   is by id, so the visual order still matches `snapshot()`'s `(z, id)` order.
4. **Note toolbar placement.** Because every note has its own z-index (stacking context), the
   floating toolbar is rendered through a React portal into the world layer, at the note's top
   centre, scaled by `1/zoom` so it keeps its screen size (`NOTE_TOOLBAR_GAP_PX` above the note).
5. **Starting a drag selects the dragged note** (single selection), so another note's toolbar
   does not stay visible while dragging; the toolbar of the dragged note appears on release.
6. **Pasting over the limit in the middle of text** drops the excess from the end of the
   *inserted* text (`clampAtCaret`), never the text after the caret. Pasting at the end is
   exactly `clampToLimit`. The caret is placed at the end of the kept inserted text.
7. **Clicking outside while editing** is detected by a capturing `pointerdown` listener on
   `document` installed by `StickyTextEditor` (it also covers the left toolbar and zoom
   controls). Panning the board by dragging empty space keeps the selection; only a click
   (press and release within `DRAG_THRESHOLD_PX`) clears it.
8. **Keyboard.** Tab focus on a note selects it; Enter on the selected note edits it; Enter and
   Delete are ignored while focus is on a button (e.g. a swatch), in a text field or while
   editing. Escape returns focus to the note.
9. **Remote text changes while editing** (story 3) are already reflected in the open textarea
   with the caret shifted across the change.
10. **Extra named settings:** `STICKY_PADDING_WORLD`, `STICKY_LINE_HEIGHT`,
    `NOTE_TOOLBAR_GAP_PX`. The toolbar's z-index is a named constant in `StickyNote.tsx`.
11. **`App` takes an optional `doc` prop** so component tests can drive and inspect a real
    `Y.Doc` (TC-37 deletes a note through the model mid-interaction).
12. **`StickyNote` is exported as `memo(...)`** (same props as the contract) so that 500 notes
    do not all re-render on every drag frame; `useBoardDoc` keeps unchanged note snapshots
    identical between updates.
13. **Component tests fake only animation frames** when using `userEvent` (Testing Library's
    async wrapper needs a real `setTimeout`).
14. **Browsers.** WebKit launched on the build machine for this run, so e2e ran in chromium,
    firefox and webkit (the default).

### Not covered
- The 500-note performance run is manual (design "Not covered"); the fixture builder is
  `tests/fixtures/board500.ts` but there is no in-app way to load it yet, and the run was not done.
- IME composition is covered by a jsdom test of the composition events only; a real macOS
  Japanese IME check was not possible on this machine.

## Story 3 — See other people's edits appear live on the same board

Decisions taken where the spec was silent or ambiguous:

1. **Vitest downgraded 5 → 4.1.** `@cloudflare/vitest-pool-workers` (0.22, the design's
   integration runner) requires vitest ^4.1 and fails to start its pool under vitest 5. All
   existing unit/component tests pass unchanged on vitest 4.1.
2. **Compatibility date 2026-08-15** (was 2026-09-01): the workerd binary bundled with the pool
   supports dates up to 2026-08-22 only.
3. **`binaryType = 'arraybuffer'`** is set on the room's server sockets (and the integration
   client's): at this compatibility date workerd delivers binary frames as `Blob` by default.
4. **`assets.run_worker_first: ["/api/*"]`** in `wrangler.jsonc`, otherwise the
   single-page-application fallback would answer room upgrades with `index.html`.
5. **Two TypeScript projects.** `tsconfig.worker.json` (Workers runtime types, no DOM) covers
   `src/worker`, `src/shared` and `tests/integration`; `npm run typecheck` runs both.
6. **`npm run test:integration` builds the client first** (`vite build`) because TC-06 checks
   that `/b/<id>` is served `index.html` from `dist/client`.
7. **Routing.** `main.tsx` calls `resolveBoardRoute()` (in `App.tsx`): a valid `/b/:boardId` is
   used as is; any other address, including `/` and `/b/<invalid id>`, is replaced with
   `/b/<newBoardId()>` via `history.replaceState`. Temporary until story 5.
8. **`App` props.** `App` takes `boardId`, and optionally `doc` and `createProvider` (a
   provider factory, so component tests can inject a fake y-websocket provider). Without
   `boardId` the board is local-only and the badge stays hidden (existing component tests).
   `useBoardDoc` takes an options object `{ boardId, doc, createProvider }` and also returns
   the mapped `connection` state.
9. **State mapping details.** The provider's `connected` status only counts once `sync(true)`
   follows. A first attempt that fails before ever syncing stays "Connecting…". A drop during
   the green confirmation cancels its timer and shows "Reconnecting…" at once.
10. **Deleted-note handling** needed no change: story 2 already clears selection/editing for
    a note that disappears, and a note's drag ends when its component unmounts (TC-25).
11. **Test hook.** In test builds `window.__vidi6.connectionState` and `connectionLog` expose
    the mapped state (nightly TC-29/TC-30). They are not in the production bundle.
12. **Outage simulation (TC-27).** Chromium's `context.setOffline(true)` blocks new requests
    but does not cut an already open WebSocket. The e2e helper therefore also proxies board
    sockets with `context.routeWebSocket`: going offline drops them and refuses reconnections
    until the network is back. The server path is still the real one (`connectToServer`).
13. **Nightly specs** are `tests/e2e/**/*.nightly.spec.ts`, run with `npm run test:e2e:nightly`
    and excluded from `npm run test:e2e`. Last local TC-30 run: 3,132 deliveries, p50 29 ms,
    p95 65 ms, max 139 ms.
14. **Multi-context e2e cases beyond TC-22/TC-23 skip in Firefox/WebKit** (design: Chromium is
    sufficient). On this run Firefox and WebKit were not installed, so e2e ran with
    `E2E_BROWSERS=chromium`.
15. **`vite dev` proxy.** `npm run dev` forwards `/api` (including WebSockets) to a
    `wrangler dev` on port 8787, so live sync also works in the Vite dev server.
16. **Every tab calls `initDoc`** before syncing. Concurrent sets of the same schema version
    converge, so this is harmless.

### Not covered
- Real-internet latency and a true production Durable Object restart (design "Not covered");
  TC-18 simulates the restart with a fresh object instance.

## Story 4 — Return to a board and find everything as it was left

Decisions taken where the spec was silent or ambiguous:

1. **Per-row limit.** SQLite-backed Durable Objects allow 2 MB per row/BLOB (Cloudflare docs at
   the time of writing); `SNAPSHOT_CHUNK_BYTES` stays at the design's 512 KiB.
2. **Room lifecycle.** `src/worker/room-state.ts` (`nextRoomState`) is the single transition
   function; `BoardRoom.lifecycle` holds its state and `BoardRoom.state` maps it to the contract's
   `'ready' | 'load-failed' | 'storage-failed'`. Compaction runs synchronously inside the update
   handler, so the room never observes `compacting` or `hibernated` in memory (both are covered by
   the unit test only). `BoardStore.compact()` (unconditional) is public for the test hooks.
3. **Refused sockets** (load-failed room) are accepted with `ctx.acceptWebSocket` and closed with
   4500 straight away: accepting them with `server.accept()` made workerd log an uncaught
   "Network connection lost" per refusal.
4. **`load_failed` is sticky until a sync.** After a 4500 close the badge stays red (and editing
   stays locked) through further failed attempts with other close codes (e.g. network errors),
   because the board is still not loaded; the first successful sync switches to `connected`.
   A 4500 close after the board was already open also locks it. 1011 is an ordinary
   "Reconnecting…".
5. **Edit lock.** `canEdit(state)` in `App.tsx` gates creation (double-click, disabled Sticky note
   button), Enter/Delete/Backspace, and is passed to `StickyNote` as an optional `editable` prop
   (no drag, no editor, no note toolbar with colours/delete). An editor that is open when the board
   becomes `load_failed` closes. Component tests observe "no model mutation" as zero updates on the
   real `Y.Doc` (every board-model mutation emits one), not spies on ESM exports.
6. **No row per visit.** Story 3 called `initDoc` before connecting, so every page open added a
   `meta.schemaVersion` update (one stored row per visit). A live board now calls `initDoc` after
   its first successful sync (a no-op on a saved board); local-only boards still initialise at once.
7. **Test hooks.** `src/worker/test-hooks.ts` adds `POST /__test/boards/:id/compact`,
   `/corrupt-snapshot` and `/repair`, only when `env.TEST_HOOKS === '1'`. The variable is set only
   on the e2e `wrangler dev` command lines (`--var TEST_HOOKS:1`), never in `wrangler.jsonc`; the
   BoardRoom's RPC methods check it again. `/__test/*` is in `run_worker_first` so POSTs reach the
   Worker; without the variable the Worker hands the request to the static assets (checked by an
   integration test). Corrupt fills chunk 0 with 0xFF bytes after saving it in a
   `test_hook_backup` table and reloads the room; repair restores it.
8. **E2E layout.** `tests/e2e/persistence.spec.ts` (TC-19–TC-21) runs in its own `persistence`
   project (chromium) and starts one `wrangler dev --persist-to <tmp>` per test on port
   `E2E_PERSIST_PORT_BASE` (default 8810) + parallel index, killing the whole process group with
   SIGKILL to "restart". It serves the test build produced by the shared webServer command.
   TC-24 is `tests/e2e/broken-board.spec.ts` on the shared server. Large and retro boards are
   seeded from Node through a real room socket (`tests/e2e/helpers/seed.ts`). TC-19 restarts the
   process instead of waiting 5 minutes.
9. **Large-board render.** TC-21 first measured ~7 s for 2,000 notes: the time was the client's
   per-note text fitting, each forcing a layout of the whole world layer. `.sticky-note` now has
   `contain: layout size style` (notes are fixed-size), so each measurement lays out one note:
   2,000 notes render ~0.8–1.0 s after navigation start locally (budget 3 s). The board itself
   arrives ~0.1 s after navigation start.
10. **TC-09 fixture.** A damaged row is only "one missing change" when no later row depends on it;
    rows written by the same Yjs client do (Yjs keeps them pending). TC-09 therefore writes each
    note from a different client, as on a real shared board, and asserts the other 24 are intact.
11. **TC-16 time.** The room reads time through a replaceable `now()`; the integration test moves
    it forward by `LOAD_RETRY_MIN_INTERVAL_MS` instead of sleeping.

### Not covered
- Output-gate ordering, production hibernation/eviction timing and real Cloudflare restarts
  (design "Not covered"); TC-18 uses the pool's `evictDurableObject` for hibernation.
- Load time over real internet latency (TC-21 is local).

## Story 5 — Share a board with others using a link

Decisions taken where the spec was silent or ambiguous:

1. **`App` stays the stories 1–4 board component** (existing component tests render it with
   `boardId`/`doc`/`createProvider`). `App.tsx` additionally exports `Routes`, the router switch
   that `main.tsx` renders (design: "App.tsx renders router"). `BoardPage` mounts `App` plus
   the `SharePanel` only once the board exists. `App.tsx` and `BoardPage.tsx` import each other;
   both only use the other's function at render time, so the cycle is harmless.
2. **Board HTTP handler lives in `create-board.ts`** (`handleBoardsRequest`), called from
   `index.ts`. The Worker entry module may export only handlers and entrypoint classes (wrangler
   refused to start with an exported constant), and integration tests TC-11/TC-12 need to call
   the handler with injected `generate` / `initialize` functions.
3. **Shared create action.** `src/client/pages/useCreateBoard.ts` holds the Idle → Creating →
   navigate / message logic used by both `HomePage` and `NotFoundPage` (design: "reuses
   HomePage's create action"). Not-found page home link text: "Go to the home page".
4. **Rate limiter.** The local runtime (Miniflare, in both `wrangler dev` and
   `@cloudflare/vitest-pool-workers`) implements the `ratelimits` binding, so the real
   `BOARD_CREATE_LIMITER` is used in integration and e2e tests; `namespace_id` is `"1001"`.
   E2E runs create many boards from 127.0.0.1, so with `TEST_HOOKS=1` only the
   `X-Test-Visitor` header replaces `CF-Connecting-IP` as the visitor key; every helper and
   e2e context uses its own random visitor. Production ignores the header.
5. **Existing tests now create their boards.** Rooms of unknown boards answer 404, so story 3/4
   integration tests initialise their board over RPC first (`createdBoardId()` in
   `tests/integration/helpers/ws-client.ts`) and e2e helpers create boards through
   `POST /api/boards` (`createBoard()` in `tests/e2e/helpers/seed.ts`; `openBoard` opens a created
   board instead of `/`). Story 3 TC-04 now expects 404 for a malformed room id (design).
6. **Storage.** `BoardStore.load()` treats missing tables as an empty board and `BoardRoom` no
   longer migrates on load; `migrate()` runs in `initialize()` and before the first `append()`.
   `initialize()` also reports a legacy board (content but no `created_at`) as `exists`, so it
   is never handed out as new. A room whose storage cannot even be queried for existence is
   treated as existing and left to story 4's load-failed path.
7. **TC-04 "chi-square" check.** 64⁴ four-character buckets are far too many for 10,000 ids, so
   the test runs a chi-square test on each of the first 4 characters (64 buckets, p > 0.001)
   and requires that no 4-character prefix is shared by 3 or more ids (p ≈ 0.0006 by chance).
8. **Legacy board e2e fixture (TC-31).** New TEST_HOOKS-only route
   `POST /__test/boards/:id/seed-legacy` (body: one Yjs update) writes it as a log row with no
   `created_at` and reloads the room.
9. **Share panel details.** Focusing or clicking the link field selects it all; the Share button
   toggles the panel; Escape returns focus to Share, an outside click leaves focus where the
   person clicked. Closing resets the copied/manual-copy state.
10. **`checkBoard` never rejects** (network errors and 5xx → `unreachable`); `BoardPage` also treats
    a rejection as unreachable. Retry delays: 1 s, 2 s, 4 s, 8 s, then 10 s
    (`RECONNECT_MAX_BACKOFF_MS`).
11. **Browsers.** Only Chromium is installed on this machine, so e2e ran with
    `E2E_BROWSERS=chromium`; TC-27 and TC-29 are written browser-neutral for Firefox/WebKit,
    TC-26 skips outside Chromium (clipboard permissions can only be granted there).

### Not covered
- Production rate-limiter accuracy, real Safari/Firefox clipboard behaviour and chat-app link
  rendering (design "Not covered").

## Story 7 — Select, move, resize and delete several objects at once

Decisions taken where the spec was silent or ambiguous:

1. **Generic snapshot.** `snapshot(doc)` still returns sticky notes only (story 2 TC-12 and the
   worker/e2e helpers rely on it). The new `snapshotObjects(doc)` returns objects of every
   type (`ObjectSnapshot`, with `width`/`height` read with a STICKY_SIZE_WORLD fallback);
   `useBoardDoc` now exposes `objects` from it. The renderer and the selection skip types the
   registry does not know.
2. **Known types live in board-model.** `allObjectIds` / `objectsInRect` must skip unknown
   types but board-model cannot import the client registry, so `registerObjectType` also calls
   `declareObjectType` in board-model (`sticky` is built in).
3. **New notes are created with explicit `width`/`height`** (design state diagram); notes
   created before this story keep reading STICKY_SIZE_WORLD until their first resize.
4. **Resize maths.** `resizeRect` is `applyScale(start, handle, resizeScale(...))` (both
   exported, plus `resizeAnchor`). An aspect-locked corner follows whichever axis moved
   further; an aspect-locked edge handle scales about the centre of the other axis. Sizes
   never flip below 0. `clampScale` always allows scale 1, so an object already outside its
   limits (written elsewhere) never forces a jump. Objects of non-resizable types in a
   resized selection (none exist yet) keep their size and only follow the layout.
5. **Sticky text at other sizes.** The note's content is laid out at the story 2 size and
   CSS-scaled to the note's `width`/`height`, so text fit (font sizes, fade, clipping) is
   identical at every size and a bigger note shows proportionally bigger text (emphasis).
6. **Selection reducer and snapshot.** `SelectionState` carries the ids present in the last
   pruned snapshot so `click`/`toggle`/`setMany` for absent ids are ignored in the pure
   reducer. `edit` is not checked (a note is edited in the same event that creates it); the
   hook also filters ids against the rendered snapshot and prunes in a layout effect.
7. **Click semantics.** A plain press on an unselected object selects it at once (drag
   selects-then-moves); a plain click on an already selected object selects only it on
   release; Shift-click toggles on release; Shift+drag on an unselected object adds it and
   moves the whole selection. Shift-click on empty space keeps the selection.
8. **Gesture listeners are on `window` (capture phase)** during a press, so a gesture ends
   even when the pressed element is removed (object deleted by someone else).
9. **Screen-space overlay.** `BoardViewport` got an `overlay` prop (drawn above the world
   layer) and a `marquee` prop. Selection outlines, the bounding box, handles and the bar
   live there; outlines use `data-object-id` (not `data-id`, which locates notes). The note
   toolbar moved from a world-layer portal in `StickyNote` into `SelectionBar` (shown for one
   selected sticky, above the bounding box). The sticky note no longer draws its own
   selection outline (focus-visible ring kept).
10. **Bar details.** The bar reads "N selected" with an icon Delete button
    (`aria-label="Delete selection"`); it hides while moving/resizing or editing text. The
    count is announced in a separate visually hidden `aria-live="polite"` region (not
    `role="status"`, which the connection badge uses); it also announces "1 selected". While
    the board is read-only (load failed) the bar shows the count without Delete and the
    handles are hidden.
11. **Keys.** Arrow keys call `preventDefault` whenever something is selected (even while
    read-only, so the page never scrolls); Delete/Backspace/Enter are still ignored while a
    button has focus. Escape also cancels a marquee in progress.
12. **`useTransformGesture` returns `gesture`** (`kind`, `ids`) in addition to the contract,
    used for the notes' `data-state="dragging"` and to hide the bar. Object components get
    `ObjectProps` from the registry (`transforming`, `onPointerDown`, …).
13. **Existing e2e TC-19 (story 4) race fixed.** Under the extra load of the 5-context TC-36
    run, the third "Zoom out" could render after the first note was created, shifting it
    under the next double-click. The test now waits for the zoom label before placing notes
    (the check itself is unchanged).
14. **Browsers.** Only Chromium is installed here: e2e ran with `E2E_BROWSERS=chromium`.
    TC-32 is written browser-neutral; the golden path and multi-context cases skip outside
    Chromium.

### Not covered
- The 200-object performance check is manual (design "Not covered") and was not run.
- Touch input; types from stories 9–12 (only the test-only `testbox` type exercises the
  generic path).

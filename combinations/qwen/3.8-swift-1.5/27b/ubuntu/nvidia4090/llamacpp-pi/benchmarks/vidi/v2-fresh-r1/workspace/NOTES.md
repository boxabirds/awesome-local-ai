# Story 1 — Notes

Decisions and environment facts worth remembering for later stories.

## Environment

- **Ports**: 24368–24383 are allocated to vidi6. `24368` = wrangler dev (E2E
  webServer), `24370` = `vite dev` (manual dev).
- **E2E browsers**: Chromium and Firefox are installed and pass. **WebKit is
  not available** in this environment (missing system library `libavif13`, no
  sudo to install it), so the E2E matrix is `chromium` + `firefox`. The
  Playwright config intentionally defines only those two projects.
- **E2E build**: E2E runs against a **test-mode build** (`npm run build:test`,
  i.e. `vite build --mode test`) so the `window.__vidi6` test hook
  (`src/client/canvas/testHooks.ts`) is present. The production build
  (`npm run build`) strips it. The Playwright webServer command builds in test
  mode and serves `dist/client` via `wrangler dev`.

## Design decisions

- **Safari pinch point**: `gesturestart`/`gesturechange` events carry no
  pointer location, so the Safari pinch handler zooms around the **viewport
  centre** (documented in `BoardViewport.tsx`). Primary path (Ctrl+wheel)
  zooms around the pointer.
- **Wheel delta normalisation**: `deltaMode` 1 (lines) and 2 (pages) are
  normalised to pixels via `WHEEL_LINE_DELTA_PX` / `WHEEL_PAGE_DELTA_PX` in
  `src/shared/config.ts` before reaching the camera.
- **`zoomByFactor`** was added to `CameraApi` (`useCamera.ts`) as the entry
  point for explicit scale-ratio zoom (Safari gesture); it wraps `zoomAt`.
- **Camera commits are rAF-coalesced**: input handlers update refs
  synchronously and commit at most one render per animation frame.
  Consequence for tests: the DOM (label text, `disabled` attribute) lags input
  by one frame. The TC-25 E2E test waits ~2 frames (32 ms) after each click
  before re-reading state; component tests flush the fake rAF explicitly.
- **Initial centring is synchronous**: viewport size is measured in a
  `useLayoutEffect` (before paint) and the camera is centred **during render**
  when the size is first known (`useCamera.ts`). A `ResizeObserver`-only
  approach (centring in a post-paint effect) caused two bugs: a flash of the
  top-left origin on load, and a late reset that clobbered the first user
  input (first click/drag). The design says resize does *not* move the camera
  (only the first size centres), which this implements.
- **Grid rendering**: the dot grid is a CSS `radial-gradient` on the viewport
  with `background-size = 24*zoom px` and `background-position` derived from
  the camera, so it stays even and cheap at any zoom (no per-dot DOM nodes).
- **World layer**: a single `div` transformed with
  `scale(zoom) translate(-x, -y)` (origin `0 0`), `pointer-events: none`.
  Object stories add children here with `pointer-events: auto`.

## Test infrastructure notes

- **jsdom `PointerEvent` polyfill** (`tests/component/setup.ts`): jsdom has no
  `PointerEvent`, and testing-library's `createEvent` falls back to
  `new Event(...)` which *drops* `clientX`/`button`/`pointerId` from the init
  dictionary. The setup file installs a minimal `PointerEvent` (subclass of
  `MouseEvent` plus the pointer fields) so `fireEvent.pointer*` works.
- **RTL cleanup**: the Vitest component project does not enable `globals`, so
  `@testing-library/react` auto-cleanup does not run; each component test file
  calls `cleanup()` in `afterEach`.
- **jest-dom matchers**: registered via `@testing-library/jest-dom/vitest` in
  `tests/component/setup.ts`.
- **Fake timers**: component tests fake `requestAnimationFrame` (and friends)
  and flush with `vi.advanceTimersByTime(16)` inside `act`.

## Coverage vs. spec

- All 32 spec test cases are covered: TC-01…TC-12 (unit, `camera.test.ts`),
  TC-13…TC-18 + TC-29…TC-32 (component), TC-23…TC-28 + TC-31 (E2E).
  TC-31 (no page zoom) appears in both component and E2E tiers per the spec
  matrix.

---

# Story 2 — Notes

## Design decisions

- **Y.Doc ownership**: `useBoardDoc()` creates one `Y.Doc` in a `useRef` and
  exposes an immutable snapshot via `useSyncExternalStore`. The snapshot is
  cached in a ref and only recomputed when the `objects.observeDeep` handler
  fires (dirty flag pattern), preventing infinite re-render loops that would
  occur if `getSnapshot` returned a new array reference on every call.

- **Interaction state machine uses a ref**: The `StickyNote` component uses
  `stateRef` (a `useRef<InteractionState>`) for the synchronous state machine
  (unselected → pressed → dragging → unselected). React `useState` updates are
  async, so using state for the pointer event handlers would cause the
  `handlePointerUp` closure to see the stale `state` value when it fires
  immediately after `handlePointerDown` in the same event loop tick.

- **Font fitting**: `fitFontSize` binary-searches integer px sizes on an inner
  text element (not the flex container). The outer wrapper handles centering
  and overflow clipping; the inner element's `scrollHeight` reflects the actual
  text content height. This is critical because a flex container with
  `height: 100%` always has `scrollHeight === clientHeight` regardless of
  content.

- **Surrogate-pair safety in `applyTextDiff`**: The common-prefix/common-suffix
  algorithm backs off by 1 code unit if the prefix boundary lands on a high
  surrogate (0xD800–0xDBFF) or the suffix boundary lands on a low surrogate
  (0xDC00–0xDFFF). This prevents splitting emoji or other supplementary plane
  characters, which would corrupt the Y.Text.

- **`pointer-events: auto` on StickyNote**: The world layer has
  `pointer-events: none` (from story 1) so the viewport receives drags on empty
  space. Sticky notes explicitly opt back in with `pointer-events: auto`.

- **Y.Text `transact` is on the doc**: `ytext.transact(...)` does not exist;
  transactions must be opened on `ytext.doc.transact(...)`. This is a common
  Yjs API gotcha.

- **Y.Text `observe` callback**: The callback receives a `YTextEvent` object;
  the delta array is at `event.delta` (a getter), not as the first argument.
  Each delta op is `{insert?: string, delete?: number, retain?: number}`.
  Pure `retain` ops are filtered out in tests.

## Environment

- Same as story 1 (ports, browsers, build mode).

---

# Story 3 — Notes

## Environment

- **`@cloudflare/vitest-pool-workers@0.12.21`**: 0.22.0 requires vitest 4;
  0.12.x supports vitest 3.2.x. The integration project uses
  `defineWorkersProject` with `isolatedStorage: false` (BoardRoom docs are
  memory-only; every test uses a unique board id, so no storage isolation is
  needed).
- **Playwright projects**: regular `test:e2e` runs `chromium` + `firefox`
  (`testIgnore: /nightly/`); `test:e2e:nightly` runs `chromium-nightly` +
  `firefox-nightly` (`testMatch: /nightly/`).
- **Long e2e tests** set their own timeout via `test.setTimeout(ms)` *inside*
  the test body — Playwright 1.63 does not accept `timeout` in test options.

## Worker / y-websocket gotchas

- **Workerd WebSocket**: no `onmessage`/`onclose`/`onerror` properties — use
  `addEventListener`. `server.accept()` returns `void` (the accepted socket is
  `server` itself).
- **`toUint8Array` is a free function** from `lib0/encoding`, not a method on
  the encoder.
- **`readSyncMessage` decoder position**: the caller must consume the
  top-level `MESSAGE_SYNC` byte (`readVarUint(decoder)`) *before* calling
  `readSyncMessage` — it expects the decoder positioned at the sync-type byte.
- **y-websocket event payloads are single-element arrays**: `status` emits
  `[{ status }]` and `sync` emits `[synced]` — handlers must normalise.
- **`provider.disconnect()`** force-closes the socket locally (works while the
  context is offline, where `ws.close()` would hang in CLOSING) **and sets
  `shouldConnect = false`** — it stops the automatic reconnect loop, so outage
  tests must call `provider.connect()` (the `__vidi6.reconnect()` hook) to
  resume.
- **Playwright `context.setOffline(true)` does not kill established
  WebSockets** — outage tests combine it with the test-only `__vidi6
  .disconnect()` hook.
- **TC-18 restart simulation**: `runInDurableObject(stub, (instance) => {
  instance.doc = null; instance.sockets.clear(); })` — vitest-pool-workers
  stubs have no `delete()` API.
- **TC-16 awareness framing**: wire format is
  `[MESSAGE_AWARENESS(1), varbytes(payload)]` where varbytes =
  `[length, ...data]`; the room relays the whole frame verbatim.

## Client sync design

- **`createConnectionMapper`**: pure state machine extracted from
  `connectBoard` for testability. Tracks `wsConnected`, `synced`,
  `everConnected`, `isReconnecting`; states map
  `connecting → connected → reconnecting → confirmed → connected` with a
  `CONNECTED_CONFIRMATION_MS` (2 s) confirmation window after reconnects.
- **Editor remote merge** (`StickyTextEditor`): local input is diffed into
  Y.Text synchronously (`applyTextDiff`), and a `ytext.observe` handler merges
  *remote* changes back into the textarea (caret re-anchored at the first
  divergence). Without this, two simultaneous editors each diff against a
  stale Y.Text and overwrite each other's characters — the last writer wins
  instead of merging.
- **`createSticky` stores top-left world coords** (`x - STICKY_SIZE_WORLD/2`)
  while the spec's (x, y) is the centre — assertions on snapshot positions
  must account for the 100 px offset.

## E2E test techniques

- **Stale-reference pitfall**: never capture one page's snapshot and compare
  other pages against that fixed value — a transiently stale reference pins
  the comparison and the poll times out even though the pages converged with
  each other. Re-read *all* pages inside the poll and compare pairwise.
- **`setOffline` + `disconnect` ordering**: go offline first, then disconnect —
  the reverse lets the provider's 200 ms backoff attempt reconnect before the
  offline emulation kicks in.
- **Soak test (TC-30)**: unbounded note creation floods the DOM and wedges
  the run; the test keeps a bounded per-participant pool (2 notes) with
  tracked home slots, seeded per-participant PRNG (mulberry32), mixed ops
  (create/move/type/recolour/delete), a 15 s outer timeout on every op, and
  slot bookkeeping resynced from real note texts on failure (ghost entries
  after merged creates would otherwise block all further creates).
- **`waitFor()` in `createNoteWithText`** is bounded (5 s) — an unbounded wait
  on an empty page is how a soak loop can hang past the test timeout.

---

# Story 4 — Notes

## Storage architecture: KV + SQL hybrid

- **SQLite `sql.exec()` has a ~100KB statement length limit** (BLOBs >40KB fail
  with `SQLITE_TOOBIG`). This makes it impractical to store Yjs updates directly
  in SQL BLOB columns.
- **Solution**: BLOB data lives in **KV** (`storage.put/get`), SQL stores only
  metadata (seq, kv_key, byte_length). KV handles arbitrary-sized data and is
  async; SQL provides ordering, counting, and atomic transactions.
- **`sql.prepare()` is NOT available** in the vitest-pool-workers test
  environment. Only `sql.exec()` works. All queries use string interpolation
  with validated integer values (no user input in SQL strings).
- **Cursor API**: `cursor.next()` returns `{ done: boolean, value: Record<string, unknown> }`
  (iterator pattern, NOT `toArray()`/`getRow()`).
- **`storage.transactionSync()`** works for atomic operations (compaction).

## AUTOINCREMENT for seq

- After compaction deletes all rows, manual `MAX(seq)+1` would reset to 1,
  which is less than `throughSeq` (e.g. 500). New rows would be invisible to
  `WHERE seq > throughSeq` queries.
- **Solution**: Use SQLite's `AUTOINCREMENT` by inserting without specifying
  seq, then reading `last_insert_rowid()`. The `sqlite_sequence` table tracks
  the high-water mark across deletions.

## Durable Object hibernation API

- **`ctx.acceptWebSocket(server)`**: allows the DO to hibernate with open
  sockets. On wake, the constructor runs again (loads from storage).
- **`ctx.getWebSockets()`**: returns all currently open sockets (replaces the
  manual `Set<WebSocket>`).
- **`ctx.blockConcurrencyWhile(async () => { ... })`**: blocks concurrent
  requests while the callback runs. Must be `await`ed in async contexts
  (e.g. `fetch`). In the constructor, it blocks before any requests are
  processed.
- **Output gate**: the platform holds outgoing WebSocket messages until all
  pending storage writes in the DO are confirmed. This provides the
  store-before-broadcast guarantee without explicit synchronization.

## Async append in sync handler

- `store.append()` is async (KV write). The `doc.on('update')` handler is
  synchronous. Solution: fire the async append with `.catch()` for error
  handling, then broadcast immediately. The output gate ensures the broadcast
  is not delivered until the write is durable.

## Client load-failure state

- **`load_failed`** is a new `ConnectionState` value. Triggered by WebSocket
  close code 4500 (`CLOSE_BOARD_LOAD_FAILED`).
- **Recovery**: when the y-websocket provider reconnects and syncs successfully,
  the state transitions from `load_failed` → `connected` (via `tryConnect`).
- **Editing gate**: `canEdit = connectionState !== 'load_failed'` in `App.tsx`.
  Gates dblclick, toolbar button, Delete key, and all board-model mutations.
- **`window.__Y`**: Yjs is exposed as a global in test mode for E2E tests
  that need to manipulate the doc directly (e.g. TC-21 large board seeding).

---

# Story 5 — Notes

## Design decisions

- **Board creation moved server-side**: `POST /api/boards` generates a 128-bit
  random id and calls `initialize()` RPC on the Durable Object. No retry loop
  (collision with 128 random bits is not practical).

- **Existence rule**: A board exists if `storage_meta.created_at` is set, OR
  (legacy) it has at least one row in `updates` or `snapshot_chunks`.
  `existsReadOnly()` checks `sqlite_master` first and never creates tables.

- **`migrate()` no longer runs on construct**: The BoardRoom constructor only
  calls `loadDoc()` if `existsReadOnly()` returns true. `migrate()` is called
  from `initialize()` and lazily before the first `append()` (via
  `ensureMigrated()`). This ensures probing unknown links writes nothing.

- **`BoardRoom.fetch` returns 404 for non-existent boards**: Before accepting
  a WebSocket, the room checks `existsReadOnly()`. Unknown boards get 404
  immediately. This breaks the old pattern where connecting implicitly created
  a board.

- **Doc lazy-load in fetch**: If the doc is null but the board exists (e.g.,
  after `seedLegacy()`), the fetch handler loads it before accepting the
  connection.

- **Router**: Minimal pathname router using History API (`/` home, `/b/:id`
  board, else not_found). No router library.

- **BoardPage retry**: Exponential backoff from `BOARD_CHECK_RETRY_BASE_MS`
  (1s) doubling up to `RECONNECT_MAX_BACKOFF_MS` (10s). Timers cleared on
  unmount.

- **SharePanel focus management**: Focus returns to the Share button on close
  via `setTimeout(0)` to avoid conflict with the click event's default focus
  behaviour (the clicked element would steal focus back).

- **Test hook for legacy boards**: `POST /api/test/seed-legacy?id=<id>` with
  header `x-test-hook: true` seeds a board with update data but no
  `created_at`. Used by TC-31 e2e test.

## Pre-existing typecheck errors

- `tests/e2e/persistence.spec.ts` and `tests/e2e/share.spec.ts`: Playwright's
  `test` function type doesn't resolve destructured fixture parameters correctly
  with `moduleResolution: "bundler"`. These are pre-existing (same pattern in
  persistence.spec.ts from story 4) and don't affect test execution (Playwright
  uses its own transpiler).
- `tests/integration/board-store.test.ts` and
  `tests/integration/board-room-persistence.test.ts`: Pre-existing type issues
  with the `DurableObjectStorage` type not being exported from
  `cloudflare:workers`.

---

# Story 8 — Notes

## Design decisions

- **`Y.UndoManager` with `trackedOrigins`**: The per-user undo isolation is
  achieved by Yjs's built-in `trackedOrigins` option. The local user's origin
  is `LOCAL_ORIGIN` (a module-level `Symbol`). Remote changes (from peers)
  have different origins and are never captured in the local undo stack.

- **`boundary()` = `stopCapturing()`**: The Yjs UndoManager's `stopCapturing()`
  method finalizes the current capture step and resets the internal `lastChange`
  timer. Calling it before and after a logical operation ensures each operation
  is a separate undo step regardless of timing.

- **Capture timeout grouping**: Yjs automatically merges transactions that occur
  within `captureTimeout` ms (default 500ms) into a single undo step. This is
  what groups rapid keystrokes into one "typing" step. The `boundary()` calls
  at gesture/editor boundaries ensure that separate logical operations are not
  merged.

- **Undo/redo shortcuts work regardless of selection**: The Ctrl+Z /
  Ctrl+Shift+Z handlers in `useBoardKeys` are placed BEFORE the
  `selection.ids.size === 0` guard, so undo/redo works even when nothing is
  selected.

- **Board-level shortcuts inert during text editing**: The `useBoardKeys` hook
  returns early when `selection.editingId !== null` or when the event target is
  a TEXTAREA/INPUT. The `StickyTextEditor` handles its own Ctrl+Z/Ctrl+Shift+Z
  (intercepted undo/redo that operates on the same UndoController).

- **`vi.hoisted` + dynamic import for time mocking**: Yjs's `lib0/time` module
  captures `Date.now` at module load time (`export const getUnixTime = Date.now`).
  To mock time in unit tests, `Date.now` must be patched BEFORE `lib0/time` is
  loaded. `vi.hoisted()` runs before all imports, and dynamic `await import()`
  ensures the module is loaded after the patch.

- **Yjs `popStackItem` skip behaviour**: When `undo()` is called and the most
  recent stack item cannot be applied (e.g., the object was remotely deleted),
  Yjs skips it and tries the next item. This means a no-op undo can consume
  multiple stack items. The TC-07 test verifies no-throw and no-recreation
  without asserting which specific steps were consumed.

- **Controller lifecycle**: The `UndoController` is created in `BoardContent.tsx`
  via `useEffect` (one per board doc) and destroyed on cleanup. It's stored in
  a `useRef` to avoid re-creation on re-renders. The `useUndo` hook subscribes
  to `onChange` events for reactive `canUndo`/`canRedo` state.

## Test coverage

- **Unit** (`undo-history.test.ts`): TC-01 to TC-11 (per-user isolation,
  undo/redo mechanics, remote change handling, maxSteps trimming).
- **Unit** (`undo-boundaries.test.ts`): TC-12, TC-13 (capture timeout
  grouping with mocked `Date.now`).
- **Component** (`undo.test.tsx`): TC-14 to TC-21 (gesture boundaries,
  typing boundaries, shortcuts, buttons, edit lock, editor focus guard).
- **E2E** (`undo-redo.spec.ts`): TC-22 to TC-24 (multi-browser peer
  isolation, repeated undo, toolbar buttons).

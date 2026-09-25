# Implementation notes

Decisions made while building without anyone to ask.

## Story 1: Pan and zoom around an infinite board

- **BoardViewport props.** The design lists `BoardViewport(props: { children })`, but also
  says `App.tsx` wires `useCamera` to `ZoomControls` and that `useCamera(viewport)` needs the
  board size measured by BoardViewport's `ResizeObserver`. To share one camera, `App` owns
  `useCamera` and passes it in: `BoardViewport({ controller, onResize, children })`.
- **Extra `zoomBy(point, factor)` on the `useCamera` result**, used by the Safari
  `gesturechange` handler (the listed `wheel()` only accepts deltas). Everything else matches
  the contract.
- **Initial view.** Before the board area is measured the camera is `resetCamera(0x0)`; the
  first measurement (in a layout effect, before paint) centres the starting point. After that,
  resizing never changes the camera, so content stays anchored to the board's top-left corner.
- **Hint dismissal.** `hasNavigated` latches only when a camera update returns a new object.
  Reset view on an untouched start view is treated as a no-op (same camera values), so it does
  not dismiss the hint. The e2e/test `setCamera` hook does not count as navigation.
- **Step zoom snapping.** Per design, step zoom snaps to `ZOOM_STEP_FACTOR^n` only when within
  1e-9. Consequence: after stepping down to the 10% limit, stepping back up gives
  12.5%, 15.6%, … (multiples of 10%) rather than the 100% ladder. PRD examples (100 → 125 → 100)
  hold.
- **Dot grid** is the viewport's own CSS background (radial-gradient), as the design says; there
  is no separate grid element. Dots sit at tile centres, so `background-position` is offset by
  half a tile to put dots exactly on world multiples of `GRID_SPACING_WORLD` (the origin
  crosshair sits on a dot).
- **Keyboard shortcuts** listen on `window` (the whole page is the board in this story); they
  accept `=`/`+`/NumpadAdd, `-`/`_`/NumpadSubtract and `0`/Numpad0 with Ctrl or Cmd, and are
  ignored while typing in an editable element (none exist yet).
- **Only the primary mouse button** starts a pan.
- **Test hook.** `window.__vidi6.{setCamera,getCamera}` is installed only when
  `import.meta.env.MODE === 'test'` (Vitest and `npm run build:test`). Verified that the
  production `npm run build` bundle does not contain `__vidi6`. e2e runs against
  `npm run build:test` served by `wrangler dev`.
- **E2E browsers.** `playwright.config.ts` defines chromium, firefox and webkit (design). The
  `E2E_BROWSERS` env var (comma-separated) limits them. On the build machine WebKit cannot
  launch (missing system libraries such as libavif13; installing them needs sudo), so e2e was
  verified with `E2E_BROWSERS=chromium,firefox npm run test:e2e`.
- **No integration test script.** The design states there is no request-handling boundary in
  this story, so there is no `test:integration` script yet.
- **Single commit.** Task 1's "red phase committed" step was run (all camera tests failed with
  "not implemented") but not committed separately; the story is one commit as instructed.
- **Not covered automatically** (per design): smoothness, real trackpad hardware, real Safari
  pinch (handler logic covered by TC-17 in jsdom), touch input. Headless browsers do not apply
  browser-level page zoom to synthetic Ctrl+= keys, so TC-31 additionally asserts the page
  called `preventDefault` on each shortcut.

## Story 2: Capture ideas on sticky notes and rearrange them

- **Stacking via CSS `z-index`, stable DOM order.** Notes are rendered in creation order
  (`createdAt`, then id) and stacked with `z-index` = rank in the model's `(z, id)` order.
  Rendering in `(z, id)` order would make React move the dragged element in the DOM when
  `bringToFront` runs at drag start, which drops its pointer capture (and focus) mid-drag.
  `StickyNote` therefore has one extra optional prop, `stackIndex`.
- **Extra optional `onDragChange(id, dragging)` prop on `StickyNote`.** The note toolbar is
  hidden while dragging, and it is rendered by `App` (see next point), so the note reports drags.
- **Note toolbar placement.** `NoteToolbar` is rendered by `App` as a fixed, screen-space overlay
  above the selected note (via `worldToScreen`), not inside the note element. Inside the world
  layer it would scale with zoom and could be covered by notes stacked above the selected one.
- **Selection outline** is 2 screen px at every zoom (`outline-width = 2 / zoom` world px).
- **Selecting on press.** The design's state diagram selects on pointer-up; that is what the code
  does. In addition, keyboard focus (Tab) on an unselected note selects it, so "reachable with Tab
  and editable with Enter" works. Focus caused by a mouse press does not select early.
- **Clicking outside while editing.** A press on empty board space ends editing and clears the
  selection immediately (on pointer-down); a press on another note selects that note. Presses
  on the note being edited (outside its textarea) keep focus in the textarea.
- **Empty-space click** clears the selection only when the pointer moved less than
  `DRAG_THRESHOLD_PX`; panning the board keeps the selection.
- **Keyboard.** Enter / Delete / Backspace act on the selected note only when no note is being
  edited and the key is not aimed at an input, textarea, select, button or editable element
  (so Enter on a focused swatch or toolbar button just activates that button).
- **`createSticky` with non-finite coordinates** returns `''` (the contract's return type is
  `string`) and opens no transaction. The model also exports `hasObject(doc, id)`; drags use it to
  detect a note deleted mid-drag, because `moveObject` also returns `false` for a same-position
  no-op.
- **`moveObject` / `setStickyColor` same-value calls** return `false` with no update (no-ops).
- **`bringToFront`** returns `false` only when the note is strictly above every other object; a
  note tied for the top `z` (possible once story 3 syncs) is lifted to `max + 1`.
- **Text limit** is enforced twice: the textarea's `maxLength` and `clampToLimit` on every input
  (which also avoids splitting an emoji surrogate pair at the limit).
- **Edit layout.** While editing, the display text stays in layout (hidden) and is what font fit
  measures; a transparent, auto-height textarea is centred over it with the same font size. When
  text overflows at the minimum size, the textarea scrolls (so the caret stays visible) and the
  display text is clipped with a bottom fade.
- **Empty notes** render nothing (no placeholder), per the PRD.
- **Test hooks.** `window.__vidi6` (test mode only) gained `getNotes()` and `getDoc()`. Hooks are
  merged, since camera and board install theirs from different components. `getDoc` lets
  component tests delete a note "remotely" (TC-37).
- **Component tests fake only animation frames**, not `setTimeout`: Testing Library's async
  wrapper (used by user-event) waits on a real `setTimeout(0)` and only auto-advances Jest's fake
  timers, not Vitest's, so faking `setTimeout` hangs every user-event test.
- **Red phase.** Tasks 1 and 3 were run red against stubs that threw "not implemented" (20/20 and
  12/12 failures) before implementing; not committed separately (single story commit).
- **One model test assumption corrected.** The emoji-diff test first expected Yjs to report
  `insert` before `delete` in the delta; Yjs reports them the other way round. The property under
  test (the whole surrogate pair is replaced, nothing else) is unchanged; the assertion is now
  order-independent.
- **Not done (per design "Not covered").** The 500-note performance run is a manual script, not
  run here; notes are memoised and unchanged notes keep object identity to support it. IME was
  covered only with synthetic composition events in jsdom, not a real input method.
- **E2E browsers.** As in story 1, WebKit cannot launch on the build machine; e2e verified with
  `E2E_BROWSERS=chromium,firefox`.

## Story 3: See other people's edits appear live on the same board

- **Vitest downgraded 5 → 4.1.** `@cloudflare/vitest-pool-workers` (latest 0.22.0) requires
  `vitest ^4.1`; with vitest 5 npm refuses to install it. The design requires real workerd
  integration tests via the pool, so vitest is pinned to `^4.1.11`. All story 1–2 unit and
  component tests pass unchanged on it. The root `extends: true` was replaced by per-project
  plugins (react for unit/component, `cloudflareTest` for integration).
- **Integration compatibility date.** The workerd bundled with the pool supports dates up to
  2026-08-22, older than `wrangler.jsonc`'s 2026-09-01, so the integration project overrides the
  compatibility date (`POOL_WORKERD_COMPATIBILITY_DATE` in `vitest.config.ts`). `wrangler dev`
  (e2e) and deploy use the real date.
- **`test:integration` builds first** (`vite build && vitest run --project integration`): TC-06
  checks the Worker's SPA fallback, which needs `dist/client/index.html`.
- **Binary frames.** At this compatibility date workerd delivers binary WebSocket frames as
  `Blob` by default; the room sets `server.binaryType = 'arraybuffer'`. (Before that, every
  frame was rejected with 1003.)
- **Room handles sync messages itself** instead of `readSyncMessage`: y-protocols catches
  `applyUpdate` errors internally (and logs them), which would make the design's "invalid Yjs
  update → close 1003" impossible. A malformed SyncStep1 state vector is also closed with 1003
  (extra TC-15 run). `decodeMessage` validates the whole frame (known sync sub-type, complete
  varUint8Array, no trailing bytes); its `sync` payload starts at the sync sub-type.
- **`run_worker_first: ["/api/*"]`** added to `wrangler.jsonc` assets so room connections always
  reach the Worker, never the SPA fallback. `assets.binding: ASSETS` per tasks.md.
- **Separate `tsconfig.worker.json`** (workers types, no DOM) for `src/worker`, `src/shared` and
  `tests/integration`; the main tsconfig excludes those two folders. `npm run typecheck` runs
  both.
- **`connectBoard` takes an optional 4th argument** (provider factory) so component tests drive
  the state mapping with a fake event emitter (TC-19–21). The factory's `BoardProvider`
  interface is the subset of `WebsocketProvider` used.
- **Browser offline/online events.** Playwright's `context.setOffline(true)` (like a real Wi-Fi
  drop on an idle socket) does not close an open WebSocket; y-websocket would only notice after
  its 30 s no-message timeout. `connectBoard` therefore restarts the provider on the window
  `offline` event (badge turns "Reconnecting…" at once, retries continue with backoff) and on
  `online` when not connected (reconnects at once instead of waiting for the backoff).
- **State mapping details.** Before the first sync, failed attempts keep "Connecting…" (never
  "Reconnecting…"). The socket opening is not "connected"; the first SyncStep2 (`sync` event)
  is. A drop during the green confirmation cancels its timer.
- **Badge** is `role="status"` with `aria-label="Connection status"` (the zoom label is also a
  status region, so the badge needs its own name) and `data-state`; it renders nothing when
  connected. Colours: neutral for Connecting…, amber Reconnecting…, green Connected.
- **Remote typing into an open editor.** Story 2's editor only read the Y.Text when editing
  started; with live edits its next local diff would have deleted other people's text. The
  editor now observes its Y.Text and applies non-local changes to the textarea, mapping the
  caret/selection through the delta (`transformIndex`, unit tested; insertions exactly at the
  caret land after it). Known limit: a remote change to the same note during an IME
  composition may interrupt that composition (the text is kept).
- **Addresses.** `/b/:boardId` with a valid id opens that board; anything else (including `/`
  and malformed ids) is replaced via `history.replaceState` (no reload) with a new
  `/b/<newBoardId()>`. Temporary until story 5.
- **Test hook** `window.__vidi6.connectionState` (test builds only; production bundle verified
  to contain no `__vidi6`).
- **Component tests stub `WebSocket`** globally (`tests/component/setup.ts`) with a socket that
  never opens, so the app stays "Connecting…" and fully usable; an extra component test proves
  notes can be created in that state (no lockout).
- **Integration test client** (`tests/integration/ws-client.ts`) speaks the same framing as
  y-websocket and has `hold()`/`release()` to create truly concurrent edits and `barrier()` (a
  SyncStep1 round trip) to prove "no echo" deterministically. Text edits in integration tests
  use `Y.Text.insert` in a `LOCAL_ORIGIN` transaction (the editor's `applyTextDiff` lives in a
  DOM-typed module).
- **TC-18 restart** is a real restart of the same object (`state.abort()` via
  `runInDurableObject`) rather than a new object id; the test first proves the restarted room is
  empty. workerd logs the abort as an "uncaught exception … restart" line; that is expected.
- **Nightly suite.** `npm run test:e2e:nightly` (`E2E_NIGHTLY=1`, project `nightly`, Chromium)
  runs TC-29 and TC-30; the default `test:e2e` projects ignore `*.nightly.spec.ts`. Last run:
  TC-30 10,880 deliveries, p50 9 ms, p95 24 ms, max 90 ms. TC-30's "no reconnect attempts after
  close" point is not asserted: closing a context kills the page, so nothing can be observed
  afterwards; `destroy()` on unmount is covered by a component test instead.
- **E2E browsers.** WebKit still cannot launch on the build machine; e2e verified with
  `E2E_BROWSERS=chromium,firefox` (all live-collaboration tests pass in both).
- **`npm run dev`** is still Vite only (no Worker), so it shows "Connecting…"; use
  `npm run build && npx wrangler dev` for a live board.
- **Red phase.** Task 1's unit tests were run red against "not implemented" stubs (12/12 failed)
  before implementing; not committed separately (single story commit).

## Story 4: Return to a board and find everything as it was left

- **Measured latency regression from the hibernation API (local `wrangler dev`).** Design key
  decision 4 (hibernatable sockets) is implemented as specified, but locally it is the dominant
  cost. Story 3's 5-person 60 s soak (TC-30, `npm run test:e2e:nightly`, Chromium):

  | room | p50 | p95 | deliveries |
  |---|---|---|---|
  | story 3 (`accept()`, no storage) | 9 ms | 24 ms | 10,880 |
  | `accept()` + write-before-broadcast | 33 ms | 119 ms | 7,348 |
  | hibernation, no storage writes | 139 ms | 287 ms | 4,524 |
  | hibernation + storage (shipped, per design) | 272 ms | 430 ms | 3,020 |

  Caching the socket set instead of calling `ctx.getWebSockets()` per broadcast changed nothing
  (p50 253 ms), so the cost is in how local workerd delivers hibernatable-socket events, not in the
  room code. Production latency was not measured (not available here). The PRD cost constraint
  only covers boards with *nobody connected*, which non-hibernating sockets also meet (the object
  is evicted when its last socket closes); if production shows the same overhead, reverting to
  `server.accept()` is a small change in `board-room.ts` (TC-18 would then need rewriting).
- **E2E workers capped at 2** (`E2E_WORKERS` in `playwright.config.ts`). All tests share one local
  workerd; with Playwright's default (16 workers here) story 3's multi-person tests missed their
  1 s live-update budget purely from contention (at 4 workers one 5-person test still failed once).
  Assertions are unchanged. Two consecutive full runs at 2 workers: 45/45.
- **`E2E_PORT`** overrides the shared e2e server port (default 8787). Another project on the shared
  build machine was holding 8787; final e2e runs used `E2E_PORT=8877`.
- **Story 3 tests changed by this story's behaviour:** integration TC-18 expected a restarted room
  to be empty; it now expects the reloaded board (repopulation of what the room lacks is still
  asserted). TC-12 (1,000 random ops with round trips) got a 60 s timeout: each write's commit
  gates output, so it takes ~7 s instead of ~0.2 s. No assertion was removed.
- **Large boards and CSS containment.** TC-21 first measured 7.9 s for 2,000 notes. The server side
  was 86 ms (cold wake + load + SyncStep2); the rest was one 7.7 s client task: every note's font
  fit (binary search over forced layouts) reflowed the whole 2,000-note document. `.sticky-note`
  now has `contain: layout size style` (it is a fixed-size box), making each note its own relayout
  root: 1.1–1.5 s. No virtualisation was needed.
- **Validation before apply.** `applyCheckedUpdate` runs `Y.decodeUpdate` before `Y.applyUpdate`:
  `applyUpdate` alone can integrate the structs of a truncated update and then throw on its delete
  set, which would store/serve half an update. Used by the room (incoming updates, closed 1003) and
  the loader (quarantine). Integration TC-17 includes a truncated real update.
- **Oversized updates.** Cloudflare's documented limit (checked 2026-09): 2 MB per row/BLOB;
  incoming WebSocket messages up to 32 MiB. An applied update larger than `SNAPSHOT_CHUNK_BYTES`
  is saved by compacting immediately (the snapshot is chunked) instead of as one log row; if that
  fails the room takes the storage-failure path.
- **Damage is local only per client.** The quarantine keeps the rest of the board, but in Yjs a
  missing update leaves a clock gap for its author: that author's *later* saved changes stay
  pending until the author reconnects and re-sends. The fixture therefore logs each change from its
  own client (as when several people edit), which is what TC-09 exercises.
- **`BoardStore(storage, options?)`**: the constructor takes a structural `SqlStorageLike` (the part
  of `DurableObjectStorage` used) so the pure functions can be unit-tested under DOM types, plus an
  optional `snapshotChunkBytes` (TC-08 also checks the multi-chunk path at 64 KiB). Public
  `compact(doc)` (forced) and `logSize()` were added; `sql()` is the single SQL entry point that
  TC-11 wraps to inject a failure after `DELETE FROM snapshot_chunks`.
- **Room state.** `room-state.ts` holds `nextRoomState` over the full lifecycle diagram (TC-27).
  Hibernated/wake are modelled for completeness only: the object cannot observe its own eviction.
  `BoardRoom.state` exposes the contract's `'ready' | 'load-failed' | 'storage-failed'`;
  `loadAttempts` and `loaded` (the `blockConcurrencyWhile` promise) exist for tests.
- **Load failure handling.** A LoadFailed connection is accepted then closed with 4500 before the
  room sends anything; messages from it are closed 4500 and never stored. y-websocket counts an
  accept-then-close as an unsuccessful attempt, so the client backs off (up to
  `RECONNECT_MAX_BACKOFF_MS`) rather than hammering the room; 4500 is outside its terminal range
  (4400–4499). The first successful sync switches `load_failed` → `connected`.
- **Edit lock.** `canEdit(state)` is false only for `load_failed`. Then: double-click and Enter
  create/edit nothing, the Sticky note button is disabled, notes do not drag (`readOnly` prop on
  `StickyNote`), the note toolbar (colours, delete) is hidden, Delete/Backspace do nothing, and an
  open editor closes. Selection still works (it is not an edit).
- **Test hooks.** `POST /__test/boards/:id/{compact,corrupt-snapshot,repair}` exist only when
  `env.TEST_HOOKS === '1'` (e2e `wrangler dev --var TEST_HOOKS:1`); the DO methods also refuse
  otherwise. `/__test/*` was added to `run_worker_first` so the Worker can hand those paths back to
  the assets when hooks are off; integration verifies a hook request is not handled without the
  var. `corrupt-snapshot` saves chunk 0 in a `test_saved_chunks` table, halves it, closes sockets
  and reloads (→ LoadFailed). Production client bundle verified to contain no `__vidi6`/`__test`.
- **Persistence e2e project.** `persistence` (Chromium) runs `persistence.spec.ts`; each test starts
  its own `wrangler dev --persist-to <tmp>` on its own port and SIGKILLs the process group to
  restart. The shared webServer still runs because it builds the test-mode client these serve.
  Last timings: TC-20 leave + kill issued 1–2 ms after Sam saw the note; TC-21 2,000 notes rendered
  1.1–1.5 s after navigation start (budget 3 s). The PRD's "wait 5 minutes" before reopening was not
  reproduced; a process kill is the stronger condition for memory loss.
- **Opening a board writes one tiny row.** Each browser's `initDoc` sets `meta.schemaVersion`
  before syncing, so every visit by a new page appends one small update. Harmless (compaction
  absorbs it); TC-25 checks that a sync-only visit writes nothing.
- **Red phase.** Task 1's unit tests were run red against "not implemented" stubs (all failed)
  before implementing; not committed separately (single story commit), as in earlier stories.
- **Not covered** (per design): output-gate ordering under real disk latency, production
  eviction/hibernation timing, storage quota exhaustion, load time over real internet latency,
  boards larger than `PERSIST_TESTED_NOTES`.

## Story 5: Share a board with others using a link

- **Board UI moved to `src/client/board/Board.tsx`** (`Board({ boardId, children })`, plus
  `canEdit`). `App.tsx` now only renders the router, as the design says; `BoardPage` mounts
  `Board` (with `SharePanel` as a child) once the link check says the board exists. Story 1–4
  component tests render `<Board boardId={newBoardId()} />` instead of `<App />` (no assertion
  changed). The story 3 `/` → random-id redirect (`resolveBoardId`) is deleted.
- **Existence and storage.** `created_at` is a `storage_meta` row (epoch ms). `BoardStore.load()`
  treats missing tables as an empty board without creating them; `migrate()` runs in
  `initialize()` and lazily before the first `append()`/`compact()`. `initialize()` returns
  `'exists'` for legacy boards too (data but no `created_at`) and writes nothing to them, so a
  generated id that happens to match a legacy board is never handed out as new.
- **`createBoard(env, visitorKey, deps?)`**: the optional third argument (`generate`,
  `initialize`, `limiter`) is the injection seam for TC-11/TC-12; production passes none. Its env
  parameter is structural (`CreateBoardEnv`) so the unit tests type-check under DOM types.
  Missing `CF-Connecting-IP` (local tools only) is keyed as `unknown`.
- **HTTP details beyond the contract:** `GET /api/boards/:id` also accepts `HEAD`; 405 responses
  carry an `Allow` header and `{"error":"method_not_allowed"}`. The WebSocket route checks the id
  format, then the Upgrade header (426), then the room answers 404 for unknown boards.
- **Rate limiter: real binding in both integration and e2e.** Miniflare implements `ratelimits`
  locally (`wrangler dev` lists it as "10 requests/60s"), so TC-13 uses the real
  `BOARD_CREATE_LIMITER`. Miniflare keeps a client-supplied `CF-Connecting-IP`, so every
  integration test and every e2e test that creates boards through the UI sends its own random
  visitor address; parallel tests never share a budget.
- **Test board creation.** Tests that do not exercise creation create boards through a new
  TEST_HOOKS-only route `POST /__test/boards/:id/initialize` (no rate limit; all e2e traffic comes
  from 127.0.0.1). `openBoard`, `openParticipants`, `seedBoard` and the persistence spec now create
  their board first. Integration `connect()` calls `ensureBoard()` (RPC `initialize()`, idempotent)
  before upgrading; new story 5 tests use the raw `upgrade()` to test unknown boards. TC-31's
  legacy board is seeded by `POST /__test/boards/:id/seed-legacy` (body: a Yjs update, stored as a
  log row without `created_at`).
- **Story 3/4 tests changed by this story's behaviour:** integration TC-04 now expects 404
  instead of 400 for a malformed id (design: "story 3's 400 for malformed becomes 404");
  worker TC-13 and persistence TC-26 create their board before upgrading / before damaging its
  tables (tables no longer exist before creation).
- **`wrangler dev` proxy and idle POSTs.** Persistence TC-19 failed deterministically with
  `500 Network connection lost` on the second `initialize` hook call: wrangler's dev ProxyWorker
  logged "Error inside ProxyWorker … POST … (failed after 1 attempt): Network connection lost" —
  a pooled connection went stale while idle, and the proxy retries GETs but not POSTs; the Worker
  never saw the request, and an immediate retry succeeded. The e2e hook helper retries the
  idempotent `initialize` hook up to 3 times on exactly that message. This is dev tooling, not
  app behaviour (production has no proxy), but in `wrangler dev` a real "Create a board" POST
  could hit the same thing and show "Couldn't create a board" once.
- **Clipboard.** Copy uses `navigator.clipboard.writeText`; missing API, a synchronous throw or a
  rejection all go to the manual-copy state (input focused, whole value selected). The tick in
  "Link copied" is `aria-hidden`, so the button's accessible name is exactly "Link copied". On
  open, focus moves to Copy link; on close (Escape or outside pointerdown) it returns to Share.
  Closing clears the "Link copied" timer; reopening starts at "Copy link".
- **Home link text** on Board not found (the PRD only says "link back to the home page"):
  "Go to the home page".
- **TC-04 distribution check.** A chi-square over 64⁴ four-character prefixes is meaningless for
  10,000 samples, so TC-04 checks (a) per-position uniformity of each of the first 4 characters
  (chi-square, 63 df, critical 103.44 at p = 0.001) and (b) shared 4-character prefixes: pairs
  ≤ 11 (Poisson λ ≈ 2.98, p < 0.001 beyond) and no prefix shared by more than 3 ids.
- **TC-22 "full https link".** jsdom's origin is `http://localhost:3000`; the component test
  checks the copied text equals `${location.origin}/b/<id>` and the field value, and
  `boardLink('https://…', id)` is checked separately. TC-26 (real Chromium clipboard) checks the
  pasted text is the page's full URL and opens the same board in a new context.
- **TC-26 is Chromium-only** (clipboard read/write permissions cannot be granted in Firefox);
  skipped there. TC-27/TC-29 run in Chromium and Firefox; WebKit still cannot launch on the build
  machine.
- **Flaky under load (not caused by this story):** one full Chromium+Firefox e2e run missed story
  3's 1 s live-update budget in Firefox's 5-person TC-26 (contention on the single local workerd,
  see story 4 notes); the next full run passed 58/58 (+1 skipped).
- **Red phase.** Unit tests were written before the Worker changes but `createWithRetries` was
  implemented in the same step, so they were not observed failing against a stub. Instead, after
  the fact, two mutations were checked: removing the room's existence check fails integration
  TC-09, and removing the manual-copy selection fails component TC-23 and TC-24.

## Story 7: Select, move, resize and delete several objects at once

- **`snapshot(doc)` stays stickies-only; new `objectSnapshot(doc)` returns every object.** Story 2's
  TC-12 requires `snapshot` to skip unknown types, and many earlier tests use it as the note list.
  The board (`useBoardDoc`, now `objects`) renders `objectSnapshot` through the registry; unregistered
  types are skipped. `ObjectSnapshot` has the shared fields plus optional `width`/`height` (present
  only once stored) and sticky-only `color`/`text`; `StickySnapshot` extends it; `isSticky()` narrows.
- **Known types in the shared model.** `board-model.ts` is framework-free (the Worker imports it), so
  it cannot see the client registry. `objectsInRect` and `allObjectIds` take an optional
  `isKnownType(type)` predicate defaulting to `KNOWN_OBJECT_TYPES` (`sticky`); the client passes
  `isRegisteredType` from the registry, so the test-only `testbox` is selectable in component tests.
- **New stickies are created with explicit `width`/`height`** (= STICKY_SIZE_WORLD), per the design's
  state diagram ("object created after this story → ExplicitSize"). Older stickies without the fields
  render at STICKY_SIZE_WORLD; the first resize writes both. No migration.
- **Extra geometry exports** beyond the contract: `HANDLES`, `anchoredRect(start, handle, scale)` and
  `scaleBetween(from, to)`. The gesture computes the wanted scale with `resizeRect`, clamps it with
  `clampScale`, then re-anchors with `anchoredRect` so a clamped box still stays pinned to the opposite
  edge/corner. With aspect lock, corners follow the axis dragged furthest (TC-01: +100/+40 → ×1.5);
  edge handles scale the other dimension about its centre. Sizes never flip below zero.
- **`clampScale` semantics.** A uniform scale (x === y, i.e. aspect-locked) is clamped once for the
  whole selection (key decision 2). A free scale is clamped per axis. An object already outside its
  limits (possible only for data written elsewhere) may not move further out but is not forced back.
- **`resizeObjects`** rejects the whole call for any non-finite value or non-positive size;
  `moveObjects` for any non-finite value. Both skip missing ids and unchanged entries; 0 means no
  transaction. `bringObjectsToFront` is a no-op when the selection is already strictly above every
  other object (so repeated drags do not churn z); otherwise `z = maxUnselected + rank`. Story 2's
  `moveObject`, `bringToFront` and `deleteObject` are now thin wrappers; their story 2 tests pass
  unchanged.
- **Registry** (`src/client/objects/registry.tsx`) also exports `isRegisteredType` and
  `boundsHitTest`, and defines `ObjectProps` (object, doc, zoom, stackIndex, selected, editing,
  dragging, readOnly, onPointerDown, onSelect, onStartEdit, onEndEdit). `StickyNote` takes
  `ObjectProps` (was `note: StickySnapshot`); its own drag code is gone.
- **`useSelection(snapshot)`**: `click`, `toggle` and `setMany` ignore ids not in the snapshot;
  `startEdit` is not checked (a note just created is edited before the next render shows it; prune
  ends the edit if it vanished). `endEdit(next?)` keeps story 2's optional `'unselected'`. Prune runs
  in a layout effect so a remotely deleted object never paints a stale bar/box.
- **Press semantics.** Pressing an unselected object selects only it immediately (so a drag moves
  only it). Pressing an already-selected object keeps the selection until release: a click without
  movement then selects only it; Shift-click toggles. Shift-press on an unselected object adds it
  on release, or when a drag starts (then the whole selection including it moves). A press that
  travelled DRAG_THRESHOLD_PX is never treated as a click, also on a read-only board (so a failed
  drag attempt there does not collapse the selection).
- **Gesture listeners** (`useTransformGesture`) are on `window` (pointer capture on the pressed
  element retargets events, which still bubble to window); lost capture/pointercancel ends the
  gesture keeping the last applied frame. The hook also returns `activeIds` (objects being moved or
  resized) so objects render their dragging style and the bar hides mid-gesture. Resize of a mixed
  selection: non-resizable objects keep their size and only their position scales (no such type yet).
  `onGestureStart`/`onGestureEnd` exist for story 8; `Board` passes none yet.
- **Selection bar.** Two or more objects → "N selected" + Delete selection. Exactly one sticky →
  story 2's note toolbar. **Exactly one non-sticky object → "1 selected" bar** (the PRD does not cover
  this case; it keeps a delete button available for types from stories 9–12). The polite live region
  (`data-testid="selection-announcer"`, visually hidden) always exists and reads "N selected" (empty
  at 0). While the board cannot be edited (story 4): note toolbar hidden (as before), bar shown with a
  disabled Delete button, no resize handles, arrows/Delete do nothing, drags write nothing.
- **Overlay.** Bounding box and 8 handles are a fixed, screen-space overlay (like the note toolbar), so
  handles are HANDLE_SIZE_PX at any zoom; the box never takes pointer events, handles are
  `role="button"` with "Resize top-left" … "Resize left". The overlay is hidden while text is edited.
  Objects keep their own 2 px outline (`data-selected`).
- **Marquee.** Shift+press on empty space in `BoardViewport` enters mode `marquee` (story 1's pan is
  unchanged without Shift). Escape during a marquee is caught in the capture phase on window, so it
  discards the rectangle without also clearing the selection. A marquee that encloses nothing leaves
  the selection unchanged. `MarqueeRect` gets a `zIndex` above every object.
- **Keyboard** (`useBoardKeys`) replaced story 2's handler in `Board.tsx`. Keys aimed at inputs,
  textareas, selects and contenteditable are ignored; Delete/arrows/Enter aimed at buttons (e.g. a
  focused swatch) are also left to the button, as in story 2. Ctrl/Cmd+A works from anywhere else.
- **Test hooks** gained `getObjects()` and `getSelection()` (test builds only).
- **TC-36 is Chromium-only.** In Firefox, simultaneous mouse input to five windows is delivered to
  only some of them (and selecting by Shift+drag in background windows fails), so the concurrent drags
  do not actually happen; the test skips there. The selection set-up in TC-36 is done one person at a
  time (`bringToFront`); the drags themselves are simultaneous (all press, all move, all release).
  All other story 7 e2e tests pass in Chromium and Firefox; WebKit still cannot launch on the build
  machine.
- **Red phase not observed.** The unit tests were written after the implementation, not run against
  "not implemented" stubs. Instead two mutations were checked: removing `clampScale`'s uniform clamp
  fails TC-02, TC-03 and two other geometry tests; making `prune` keep deleted ids fails unit TC-15 and
  component TC-15/TC-16. Both reverted.
- **Not covered** (per design): the 200-object performance run (manual), touch input, types from
  stories 9–12. Other people's selections are not shown (story 6 is not part of this build).

## Story 8: Undo and redo my own changes without undoing anyone else's

- **Controller lives in `Board.tsx`, not `App.tsx`.** Since story 5 the board document is owned by
  `Board` (`useBoardDoc`), and `App` only routes. `useUndoController(doc)` (in `useUndo.ts`) creates
  one controller per board document in an effect and destroys it on unmount/board change, so React
  StrictMode's mount/unmount/mount leaves exactly one live controller (an inert stand-in is used
  for the first render). `Board` takes an optional `createUndoController` prop, the seam the
  component tests use for a fake controller (like `connectBoard`'s provider factory).
- **Extra `UndoController` methods beyond the contract:** `beginGesture()` / `endGesture()` and
  `lastStep()`. The design passes `boundary` as `onGestureStart/End` and relies on frames being
  < UNDO_CAPTURE_TIMEOUT_MS apart, but frames are only produced while the pointer moves: holding a
  drag still for 0.5 s would split it into two steps (PRD: one complete drag = one step). A gesture
  therefore suspends timeout grouping until it ends (it still starts and ends with a boundary,
  including on pointercancel). `lastStep()` lets the text editor stop at the step that was newest
  when editing began (see below). Also exported: `undoKey(event)`, the shortcut matcher shared by
  the board keys and the editor.
- **Capture timeout is measured by the controller, not by `Y.UndoManager`.** Yjs reads the clock via
  lib0's `Date.now` reference captured at module load, which fake clocks cannot control, so TC-13's
  exact boundary (500 ms → two steps, 499 ms → one) could not be tested against it. The manager runs
  with `captureTimeout = Infinity`; the controller's `captureTransaction` hook calls
  `stopCapturing()` when this person's previous tracked change is at least
  `UNDO_CAPTURE_TIMEOUT_MS` old. Same semantics, testable.
- **One press = one step, also for steps with no effect.** `Y.UndoManager.undo()` keeps popping
  while a step has no effect (e.g. a move of a note someone else deleted), so it would silently also
  undo the step below it. PRD undo.safe says nothing visible happens and the *next* undo continues
  normally, so the controller exposes only the top step to the manager for each undo/redo and puts
  the rest of the stack back afterwards. Unit TC-07 and e2e TC-23 assert the earlier step survives
  the first press. `undo()`/`redo()` return true when a step was consumed (even without effect).
- **Undo inside the note editor** (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y, always `preventDefault` so
  the textarea's native history never diverges from the Y.Text) only walks back steps made during
  this edit: it stops at the step that was newest when editing started (so it can never undo the
  note's own creation or an earlier move while you type). Redo inside the editor only re-applies
  steps undone inside that editor (a new keystroke clears them). After leaving the note, board-level
  undo continues through everything. Undo/redo arrive at the editor like remote changes (origin is
  the UndoManager, not LOCAL_ORIGIN), so the existing observer updates the textarea and keeps the
  caret. During IME composition the shortcut is left to the input method.
- **Where the controller reaches the editor:** `UndoContext` (React context provided by `Board`);
  object components keep the registry's generic `ObjectProps`.
- **Boundaries:** `Board` wraps note creation (button and double-click), colour change and the bar /
  toolbar delete in `boundary()` before and after; `useBoardKeys` does the same around Delete and
  each arrow-key nudge (each nudge is its own step). Edit start and end are boundaries (editor
  mount/unmount).
- **Shortcuts:** Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo (Cmd+Y is not redo: it is the
  browser's history shortcut on macOS). Alt combinations are ignored. They work from anywhere on the
  board including a focused toolbar button, but not in inputs/textareas/contenteditable (e.g. the
  share link field). While the board failed to load, shortcuts are ignored without
  `preventDefault` and both buttons are disabled.
- **Buttons** sit in the left `Tools` toolbar below the Sticky note button, in a `History` group with
  a divider, with `disabled` and `aria-disabled`, tooltips "Undo (Ctrl/Cmd+Z)" and
  "Redo (Ctrl/Cmd+Shift+Z)".
- **History trimming** drops `undoStack[0]` while longer than UNDO_MAX_STEPS. Yjs's private
  `keepItem` release is not exported, so the items of a dropped step stay un-garbage-collected in
  this tab's document until reload (local memory only; the room's copy is unaffected).
- **Redo is not cleared by other people's changes**, only by this person's own new changes
  (unit TC-06b).
- **E2E fixture** `undoRetroBoard()` (12 notes, varied colours and sizes, 2 × 4 cluster of 8) in
  `tests/fixtures/boards.ts`. TC-24 is Chromium-only for the same reason as story 7's TC-36 (Firefox
  delivers simultaneous input to only some of several windows); TC-22 and TC-23 pass in Chromium and
  Firefox. WebKit still cannot launch on the build machine.
- **Firefox flakiness under load (story 3 tests).** One full Chromium+Firefox run failed story 3's
  Firefox TC-24 and TC-26 (1 s live-update budget / concurrent drag in two windows). Re-runs: with
  this story, the two tests alone 6/6 and the whole live-collaboration file ×2 14/14; without it
  (stashed) 6/6 and 14/14. Treated as the known contention on the single local workerd (story 4/5
  notes), not a regression, but noted because the first failing run was with this story's code.
- **Red phase.** Unit TC-01–TC-13 were run against a `createUndo` stub throwing "not implemented"
  (all failed) before implementing; not committed separately (single story commit). Component
  boundary tests were checked by mutation: passing `boundary` instead of `beginGesture/endGesture`
  fails the held-still drag test, and removing the editor's start-of-edit stop fails TC-16.
- **Not covered** (per design): object types from stories 9–12 and comments (story 16) — the
  controller tracks the whole `objects` map, so they need no undo code; IME with the capture timeout
  (manual). Presence (story 6) is not part of this build.
- **Nightly soak (TC-30).** The first `npm run test:e2e:nightly` run with this story failed TC-30 on
  its maximum (one delivery 1,173 ms > 1 s; p50 266 ms, p95 403 ms) while TC-29 ran alongside it.
  TC-30 alone with this story: p50 252/263 ms, p95 439/421 ms, max 800/697 ms — passed twice;
  without this story (stashed): p50 246 ms, p95 419 ms, max 690 ms. Same distribution; the outlier
  is the local hibernation latency recorded in story 4.

## Story 9: Write free text anywhere on the board

- **Snapshot fields.** `board-model.ts` reads text objects itself (it cannot import
  `objects/text.ts`, which imports it): `ObjectSnapshot` gained optional `createdBy`, `size` and
  `widthMode`, and `text` now also applies to text objects. `TextSnapshot` (in `objects/text.ts`)
  narrows `width`/`height` to required; a malformed text entry without them reads as one empty line.
  `KNOWN_OBJECT_TYPES` now includes `text`. `objectOf` and `maxZ` are exported for the per-type
  module. Older clients skip `text` objects (story 7's unknown-type rule), so boards stay compatible.
- **Extra exports** beyond the contract: `readTextLayoutInput` (text.ts); `remeasureText(doc, id,
  measure)` and `resizeTextWidth(doc, id, rect, measure)` (useTextBoxSync.ts, the pure parts of the
  hook used by the toolbar and the gesture); `estimateMeasurer`, `textMeasurer()` (one shared canvas
  measurer), `fontPxOf`, `linesHeight` (textLayout.ts).
- **Extra named setting `TEXT_AUTO_WIDTH_PADDING_WORLD = 4`.** TC-07 says auto width is "measured
  line + padding"; the design names no value. Auto width = min(longest line incl. trailing spaces +
  padding, TEXT_MAX_AUTO_WIDTH_WORLD); lines wrap only when wider than TEXT_MAX_AUTO_WIDTH_WORLD, so a
  line of exactly 600 stays one line at width 600 (TC-09). The padding gives the caret room and
  absorbs canvas-vs-DOM rounding. Estimate fallback ratio `ESTIMATE_GLYPH_WIDTH_RATIO = 0.55`.
- **Rendering.** The stored box is rendered as is and the browser wraps (`pre-wrap`,
  `overflow-wrap: break-word`), matching `layoutText`'s greedy word wrap. e2e compares the rendered
  text height with the stored height in Chromium and Firefox (within 2 units). A trailing newline
  gets a zero-width space in the display copy so it shows as a line, like in the editor.
- **Registry.** Besides `handles?: 'all' | 'horizontal'`, `ObjectTypeSpec` gained optional
  `resizeBehavior(obj, single)` ('size' | 'width' | 'position', default 'size') and
  `resizeWidth(doc, id, rect)`. Text: alone → 'width' (fixed width, height re-measured, one
  transaction); in a mixed selection fixed-width text → 'width', auto-width text → 'position'. A
  'width' object constrains only the width in `clampScale` (its height is passed as 0, so short text
  never blocks shrinking a group); an all-horizontal selection never locks the aspect ratio (Shift
  ignored), so a side-handle drag never moves the text vertically.
- **`TextObject` props** are the registry's `ObjectProps` (it narrows `object` with `isText`), not
  `ObjectProps & { note: TextSnapshot }`, because the board renders every type the same way.
- **`TextEditor`** takes the contract's props plus optional `className`, `ariaLabel` and
  `onLengthChange` (the sticky counter). `StickyTextEditor` is a thin wrapper; story 2's editor tests
  pass unchanged. `onInput` fires only when the Y.Text actually changed. The text editor is a
  textarea named "Text".
- **Empty text removal and undo.** Removal runs when editing ends however it ends (Escape, a click
  elsewhere, selecting something else), in the text object's layout effect. It must join the edit's
  last step (key decision 3), but the editor closes the step on unmount and the capture timeout may
  have passed, so `UndoController` gained `joinLastStep(action)` (re-opens the newest step by setting
  `Y.UndoManager.lastChange`, suspends timeout grouping, closes the step afterwards). Erasing all
  characters then leaving → one undo brings the text back with its characters. A new text abandoned
  without typing: creation and removal are one step with no net effect, so undo never restores an
  invisible object (that press consumes the empty step, as story 8's "one press = one step").
  Nothing is removed while the board cannot be edited.
- **Tool shortcuts** (V, T, N, Escape) are in `useBoardKeys`, ignored while any text is edited, when
  focus is in a form field, and with Ctrl/Cmd/Alt (Ctrl+V stays paste). **N did not exist before**
  (story 2 only had the button and double-click); it is added here as the PRD describes it, creating a
  note at the view centre (key repeat ignored). Escape with the Text tool returns to Select without
  clearing the selection; otherwise Escape clears the selection as before.
- **Text tool click.** `BoardViewport` takes the press in the capture phase (so presses on objects
  never reach them: no selection, drag, pan or marquee) and creates on release at the pressed point,
  so the new editor's focus is not taken away by the press. Creating switches the tool back to Select
  first; a click with the board not editable creates nothing.
- **Toolbar.** Select (V) and Text (T) buttons above Sticky note, `aria-pressed`, Text disabled when
  the board cannot be edited. Story 8's TC-18 checked the exact button list of the Tools bar; its
  expectation now includes the two new buttons (nothing else changed). The Sticky note button keeps
  its name and tooltip.
- **Text toolbar.** `role="toolbar"` named "Text"; size buttons' accessible names are their visible
  labels S, M, L, XL (with `aria-pressed`) and tooltips "Small text" … "Extra large text"; "Delete text".
  Hidden while the board cannot be edited (like the note toolbar); the size change and its re-measure
  are one undo step.
- **Accessibility.** Text objects are `role="group"`, `aria-roledescription="text"`, named by their
  content ("Empty text" while a new one has no characters), Tab-focusable (focus selects).
- **`createdBy`.** Identity (story 6) is not in this build; each tab records an anonymous
  `g_<uuid>` guest id.
- **Component tests** stub `HTMLCanvasElement.getContext` (jsdom has no canvas and logs "not
  implemented"), so board-level tests use the estimate measurer; unit/hook tests use a fake measurer.
- **Test helper change.** e2e `openBoard` retries the idempotent `initialize` hook on wrangler dev's
  "Network connection lost" proxy error (as `seed.ts` already did), which failed TC-31 once.
- **E2E results.** `tests/e2e/text.spec.ts` (TC-26–TC-31) passes in Chromium and Firefox (TC-29/30
  included); WebKit still cannot launch on the build machine. In the first full run one text test
  timed out in the shared `openBoard` helper with the page stuck on "Opening board…" for 5 s (board
  existence check under load on the single local workerd); the full re-run passed 86/86 (+3 existing
  skips).
- **Red phase not observed.** Tests were written alongside the implementation and first run against
  it, not against "not implemented" stubs; single story commit as before.
- **Not covered** (design): font loading flashes, IME in text objects (shares the editor code with
  stickies), right-to-left text. Remote clients render the stored box; if two people type into the
  same text the last box written wins, which can briefly differ from the merged text until the next
  local change.

## Story 10: Draw shapes and connect them with arrows that follow when moved

- **Active tool.** `src/client/tools/useActiveTool.ts` has the contract's `ToolId`, `TOOL_SHORTCUTS`
  and `useActiveTool()`, plus `MODE_TOOLS` (the tools that are modes in this build: select, text,
  shape, connector; `setTool` ignores pen/image/comment/sticky). It takes optional
  `{ canEdit, onSelect }` (the contract has no arguments, but story 9's "only Select while the
  board cannot be edited" rule and `toolCreated` selecting the new id need them). Story 9's
  `board/useTool.ts` is now a thin wrapper so its tests and callers are unchanged. The single-letter
  shortcuts stay in `useBoardKeys` (which already owns "not while typing / not with Ctrl"), now
  driven by `TOOL_SHORTCUTS`: S and L only while editable, key repeat ignored.
- **`useSelection` gained `adopt(id)`**: selects a just-created id that is not in the snapshot yet
  (`click` ignores unknown ids). Prune removes it if it never appears.
- **Tool layer instead of capture.** Shape and Connector tools render a transparent screen-space
  layer over the board (new `BoardViewport` prop `overlay`), so every press goes to the tool and
  never to objects (TC-28), and hover hit testing is geometric (works in jsdom). The viewport got
  `isolation: isolate` so that layer stacks above the objects but never above the panels.
  Story 9's capture-phase click creation is now limited to the Text tool.
- **Arrow selection by geometry.** Arrows take no pointer events (their SVG spans a bounding box that
  would otherwise swallow clicks meant for objects below). A new `BoardViewport` prop
  `onPressCapture` lets `Board` hit test each Select-tool press first: the topmost arrow within
  `CONNECTOR_HIT_TOLERANCE_PX / zoom` of the press, stacked above whatever element was pressed, gets
  the generic select/move gesture. So a press near an arrow drawn over a shape selects the arrow,
  away from the line it selects the shape.
- **Registry.** Split into `objects/objectTypes.ts` (the map, lookups, `boundsHitTest`,
  `connectorHitTest`, new `topObjectAt` / `attachableAt`) and `registry.tsx` (registrations, which
  re-exports everything). Object components now use lookups, and importing `registry.tsx` from them
  would be a module cycle. `hitTest(obj, p, zoom?)` gained the optional zoom; `ObjectTypeSpec` gained
  `attachable` (arrows are not attachable: arrows never connect to arrows) and `selectionBox`
  (arrows show their end handles, not the selection box; a selection of only arrows draws no box).
- **Model layout.** Like story 9, `board-model.ts` reads shapes and connectors itself (the snapshot
  must derive arrow boxes from all other rects): `ObjectSnapshot` gained optional `kind`, `fill`,
  `stroke`, `label` (shapes) and `from`, `to`, `fromPoint`, `toPoint` (arrows). `ShapeSnap` and
  `ConnectorSnap` narrow them. `detachConnectorsTo` is implemented in `board-model.ts` (which
  `deleteObjects` calls inside its transaction) and re-exported from `objects/connector.ts`, which
  keeps the modules acyclic. Extra exports: `rectsOf`, `docRects`, `connectorPoints`,
  `transformConnectorEnds`, `isShapeKind`/`isFillColor`/`isStrokeColor`, `SHAPE_TYPE`,
  `CONNECTOR_TYPE`; `shapeRect` (shape.ts); `readEndpoint`, `isValidEndpoint`, `rectCentre`,
  `attachedAnchor` (connector-geometry.ts). A shape with a kind this client does not know is
  skipped (not drawn as a rectangle).
- **Endpoints** are plain JSON values in the object's Y.Map, replaced whole; two people re-attaching
  the same end at once: last writer wins. The stored `x, y, width, height` of an arrow are 0 and
  never read.
- **Sides.** Each attached end aims at the other end's object centre (or free point) and uses
  `nearestSide` against the rect's diagonals. Exactly on a diagonal, left/right wins.
- **Moving and resizing arrows.** Moving a selection moves each selected arrow's free ends by the same
  delta; attached ends stay attached and follow their objects. A resize scales free ends with the
  box. Arrows are not resizable (their ends are changed with the end handles). The gesture computes
  every frame from its start snapshot (`transformConnectorEnds`), and each frame is now one
  transaction (arrows included). `moveObjects` also handles arrows (delta against the current derived
  box) for the one-shot arrow-key nudge.
- **Orphaned ends.** `createConnector` keeps the caller's fallback for an end whose object is already
  gone (TC-27 race). `setConnectorEndpoint` normalises an orphaned other end to a free end at its
  fallback in the same transaction (the design's "next local write normalises"). Re-attaching to the
  object it is already attached to is a no-op (false).
- **Shift square** keeps the rect corner nearest `at` (the drag origin) fixed, so squares grow in the
  drag direction. The minimum-size check comes first: a drag under 20 units in either direction drops
  a default shape even with Shift.
- **Connector tool.** Moving less than `CONNECTOR_MIN_LENGTH_WORLD` (world) or releasing on the start
  object creates nothing and keeps the tool. A drag from empty space to empty space creates a
  free-to-free arrow. The dots are drawn on the object under the pointer; while dragging, on the
  target (its highlighted dot is the side facing the start).
- **Label.** An HTML label box over the SVG, not a `foreignObject` (same result, simpler with the
  existing textarea editor). The box is the largest centred box inside the shape (rect: full size
  minus 8 px padding; ellipse: 1/√2; diamond: 1/2), so resizing re-wraps it. Extra named setting
  `SHAPE_LABEL_FONT_PX = 16`; `CONNECTOR_COLOR` names the arrow colour. Double-click or Enter edits,
  the editor is named "Shape label", and the 500-character limit uses the shared `TextEditor`.
- **Names and text.** Toolbar: "Shape (S)" (with `aria-haspopup`; its menu `role="menu"` "Shape kind"
  with `menuitemradio` Rectangle / Ellipse / Diamond, shown while the Shape tool is active) and
  "Connector (L)". Shape toolbar (`role="toolbar"` "Shape"): "No fill", "White fill" … "Grey fill",
  "Dark outline" … "Grey outline", and "Delete shape". Shapes are `role="group"` with
  `aria-roledescription="shape"` and name "Rectangle: Checkout" (just "Rectangle" when unlabelled).
  Arrows are groups named "Arrow" (`aria-roledescription="arrow"`), Tab-focusable; end handles are
  buttons "Arrow start" / "Arrow end".
- **Story 8 test change.** TC-18's expected Tools bar button list now includes Shape (S) and
  Connector (L) after Text (T). Nothing else changed.
- **TC-27 race.** Instead of a timed delay, Sam's outgoing WebSocket frames are held with
  `page.routeWebSocket` until Dana has created her arrow, then released, which forces the overlap
  deterministically. Both screens show the arrow with its end at the fallback, and neither logs an
  error.
- **Test results.** New: `tests/unit/shape-model.test.ts` (TC-01–06), `tests/unit/connector-model.test.ts`
  (TC-07–14, TC-29, plus orphan and move cases), `tests/component/ShapeTool.test.tsx` (TC-15–17,
  TC-28), `Connector.test.tsx` (TC-18–21), `useActiveTool.test.tsx` (TC-22), e2e `shapes.spec.ts`
  (TC-23, TC-24, checkout fixture) and `connectors.spec.ts` (TC-25 + TC-26 in one workflow, TC-27),
  fixture `tests/fixtures/checkout-flow.ts`. All e2e pass in Chromium and Firefox; WebKit still cannot
  launch on the build machine, so TC-23 was not run in WebKit.
- **Red phase not observed.** The model tests were written right after the model and passed on first
  run. Instead, mutations were checked: widening the arrow hit tolerance fails both TC-20 zoom cases,
  and removing the "released on the start object" rejection fails the no-accidental-arrows test
  (both reverted).
- **Not covered** (design): the 300 shapes + 300 arrows smoothness check (manual), exact
  screen-reader wording, touch input.

## Story 11: Sketch freehand with a pen

- **Tool layer, like story 10.** `PenTool` is a transparent screen-space layer over the board (the
  `overlay` prop of `BoardViewport`), so every press while the Pen is active goes to it: drags over
  objects draw and never move/select them or pan. Wheel and Safari pinch listeners sit on the
  viewport element and still receive the events bubbling from the layer, so scrolling pans and
  Ctrl/Cmd+scroll zooms. `BoardViewport` itself needed no code change.
- **Preview without React renders.** The screen-space preview `path` and the round cursor are
  updated through refs: the path's `d` is rewritten at most once per animation frame, the cursor's
  transform on every move. The preview is never written to the document.
- **Extra `step` prop on `PenTool`** (like `ShapeTool`): `Board` passes `asStep`, which closes an undo
  step before and after each commit (equivalent to the design's `stopCapturing()`), so each stroke
  and each part of a split stroke is exactly one undo step. `identityId` is the tab's guest id (no
  identity in this build).
- **Escape (or another tool) mid-drag discards the stroke being drawn**; only pointercancel / lost
  pointer capture keep it (pen.interrupted). The design's state diagram only has Escape from Idle.
- **Click vs drag.** Movement below `DRAG_THRESHOLD_PX` (screen) from the press makes a dot at the
  press point. A split long stroke whose last part has only the join point creates no extra dot.
- **Smoothing faithfulness** is guaranteed for the stored points: RDP uses distance to *segments*
  (not the infinite line), so every recorded point is within `STROKE_SIMPLIFY_TOLERANCE_PX / zoom`
  world units of the stored polyline. The drawn curve (`smoothPath`, midpoint quadratics) passes
  through the midpoints, and at sharp corners can cut inside the stored polyline by more than that;
  it is only a rendering of the stored stroke.
- **Stroke box** = points' bounding box padded by half the thickness (a straight horizontal line
  still has a non-zero height). `baseWidth/baseHeight` are that padded box; `scaledPoints` scales
  from its top-left, so the padding scales with a resize while the thickness does not.
- **Snapshot.** As in stories 9/10, `board-model.ts` reads strokes itself (`readStroke`,
  `STROKE_TYPE`, `isPenColor`, `isPenThickness`); malformed strokes (odd/non-numeric points, unknown
  colour/thickness, non-positive base size) are skipped. `ObjectSnapshot.color` widened to
  `StickyColor | PenColor`; new optional `points`, `baseWidth`, `baseHeight`, `thickness`.
  `PenColor`/`PenThickness` are defined in `config.ts` and re-exported from `objects/stroke.ts`.
  Extra export `scaledLocalPoints` (box-relative points for rendering).
- **Selection by geometry.** Strokes take no pointer events. The story 10 arrow press routing in
  `Board` now accepts any type whose registry spec sets the new `hitByGeometry: true` (arrows and
  strokes), using that type's `hitTest`. A click inside a stroke's box but away from its line
  therefore reaches the object underneath (or empty board).
- **Component split.** `StrokeObject({ stroke, selected, zoom? })` is the contract's rendering
  component (SVG path, `aria-label="Drawing"`); the registry registers `StrokeBoardObject`, a thin
  wrapper taking the registry's `ObjectProps` (positioned `role="group"` named "Drawing",
  Tab-focusable, focus selects). The hit test is `strokeHitTest` in `StrokeObject.tsx`.
- **Names.** Toolbar button "Pen (P)" after Connector. Pen toolbar `role="toolbar"` "Pen", shown
  right of the left toolbar only while the Pen is active; swatches "Black pen", "Blue pen", "Red pen",
  "Green pen", "Orange pen", "Purple pen" (capitalised, like story 10's "Blue fill"); "Thin",
  "Medium", "Thick"; all with `aria-pressed`. Pen options live in `Board` (per page load).
- **Story 10 tests changed by this story's behaviour:** `useActiveTool.test.tsx` used `pen` as its
  example of a tool not in this build; it now uses `image`. Story 8's TC-18 toolbar button list now
  includes "Pen (P)". Nothing else changed.
- **Fixture paths are generated, not recorded.** No real pointer recordings are available here;
  `tests/fixtures/pen-paths.ts` builds the loop and underline deterministically with a seeded PRNG
  (uneven spacing, jitter, wobble) and the 5,010-point spiral analytically.
- **E2E.** `tests/e2e/pen.spec.ts` (TC-17–TC-20) passes in Chromium and Firefox; WebKit still cannot
  launch on the build machine, so TC-17 was not run in WebKit. TC-17 samples the preview's `d` with
  `requestAnimationFrame` in the page and requires at least 80% of consecutive sampled frames during
  the drag to differ (a strict 100% would fail whenever the test driver stalls for a frame).
  The fixtures are drawn offset to the right so the first press does not land on the pen toolbar.
- **Red phase not observed.** The model was written before its tests. Mutations were checked
  instead: doubling the hit tolerance fails all four TC-15 cases; ignoring pointercancel / lost
  capture fails TC-11 (both reverted).
- **Not covered** (design): drawing latency on low-end hardware, compression ratio (manual; TC-17
  only asserts fewer stored than recorded points), stylus pressure/palm rejection.
- **Full e2e runs (Chromium + Firefox, `E2E_PORT=8877`).** Final run: 104 passed, 3 skipped (the
  existing Chromium-only skips), 0 failed. Two earlier full runs each had one unrelated failure in a
  different story's test, both at an `openBoard`/page-visibility wait under load: story 9's
  text TC-26 (then 28/28 in `text.spec.ts` ×2) and story 5's share TC-30 (then 8/8 alone ×4, after
  one more failure in a repeat run). Neither touches pen code; recorded as the known contention on
  the single local workerd (story 4/5/9 notes).

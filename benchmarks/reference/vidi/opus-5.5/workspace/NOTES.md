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

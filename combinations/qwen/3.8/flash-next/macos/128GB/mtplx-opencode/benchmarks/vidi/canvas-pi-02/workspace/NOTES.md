# Story 2 — sticky notes: implementation notes

Decisions, deviations from `spec/stories/002-.../design.md`, and what is deliberately
left for later stories. Nothing here changes a spec requirement; where the design
specified a shape and I used another one, the reason is below.

## What is in place

Model (framework-free, `src/shared/`):
- `board-model.ts` — `initDoc`, `createSticky`, `moveObject`, `bringToFront`,
  `setStickyColor`, `deleteObject`, `getStickyText`, `snapshot`, `LOCAL_ORIGIN`,
  `StickySnapshot`. Every accepted mutation is exactly one
  `doc.transact(fn, LOCAL_ORIGIN)`; every rejection (stale id, unknown colour,
  non-finite coordinates, already-topmost `bringToFront`) returns `false` before a
  transaction is opened, so it produces no update and no remote traffic.
- `config.ts` — `STICKY_SIZE_WORLD`, `STICKY_TEXT_MAX_CHARS`,
  `STICKY_COUNTER_THRESHOLD_CHARS`, `STICKY_FONT_*`, `DRAG_THRESHOLD_PX`,
  `STICKY_COLORS`, `DEFAULT_STICKY_COLOR`.

Client:
- `board/useBoardDoc.ts` — one `Y.Doc` per board, `objects.observeDeep` →
  memoised `snapshot` → `useSyncExternalStore`; a revision counter makes the
  snapshot identity change only when the doc changes.
- `objects/StickyText.ts` — `clampToLimit`, `counterVisible`, `applyTextDiff`
  (common prefix + common suffix, one delete and/or one insert, surrogate-pair
  safe), `fitFontSize` (integer binary search, `[MIN, MAX]`).
- `objects/StickyTextEditor.tsx` — textarea overlay, caret at end on mount,
  IME-safe (input skipped while composing, handled on `compositionend`), Escape →
  `onEnd('selected')`, outside pointerdown → `onEnd('unselected')`, no extra write
  when editing ends, counter when `counterVisible`.
- `objects/StickyNote.tsx` — the press / drag / edit state machine, rAF-throttled
  `moveObject`, one `bringToFront` per drag start.
- `objects/NoteToolbar.tsx`, `board/Toolbar.tsx` — six swatches + bin; the Sticky
  note button creates a note at the world centre of the view.
- `board/useSelection.ts` — `selectedId` / `editingId` live in React only, never in
  the Y.Doc.
- `App.tsx` — window keydown (Enter to edit, Delete/Backspace to delete, ignored
  while editing or when the focus is in a text field).

Story 6 / 13–17 hooks were skipped as instructed.

## Deviations and the reasons

1. **`StickyNote` is exported as `memo(StickyNoteView)`.** The design says
   `export function StickyNote`. With 500 notes, an un-memoised note means every
   selection change re-renders (and re-lays out) 500 text blocks. `propsAreEqual`
   compares the note snapshot by identity — `snapshot()` builds fresh objects only
   when the doc changes, and `zoom`/`selected`/`editing` change together with it —
   so a click on note 500 re-renders two notes, not 501. The props interface is
   unchanged.
2. **Drag moves are tracked on `window` for the length of the gesture.** The design
   says "pointer capture". Capture is still requested, but it is not trusted, and
   that is not theoretical: with capture on the note, Chromium released it as soon
   as another note ended up under the cursor, and the drag died halfway (found by
   the TC-32 e2e case). A note is 200 world units; one flick at 200% zoom leaves it
   within a single frame. A drag that stops tracking is a note left where nobody
   pointed, so the gesture is owned by the window from pointerdown to
   pointerup/pointercancel and the listeners are removed again when it ends (no
   per-move work while idle).
3. **`pointercancel` / lost capture freezes the note at the last position *shown***
   (TC-21): the pending frame position is dropped, not applied. `pointerup` applies
   the pending position first, so a normal drag ends exactly where the pointer was,
   not where the last frame happened to land. A `pointermove` that reports the button
   as released (the pointer left the window, so no `pointerup` was ever delivered)
   also drops the drag: the note never follows an unheld pointer.
4. **`tests/component/harness.tsx` `pointerEvent` gained a `buttons` option.** A
   synthetic event carries `buttons: 0`, which after the change above would read as
   "not held"; the sticky drag tests now say `buttons: 1` for a held drag, which is
   what a browser does. The default is unchanged, so the story-1 tests are untouched.
4. **`StickyTextEditorProps` has a `box` prop** (the contract lists
   `ytext / fontPx / onEnd`). The editor needs the text box height to decide
   whether to shrink the font; passing it in keeps the component free of layout
   constants and testable without a page.
5. **`StickyNoteProps` has `onDelete(id)`.** The contract only had
   `onSelect / onStartEdit / onEndEdit`. Deleting a note is not "editing ended";
   overloading `onEndEdit('unselected')` would make the bin button and the Delete
   key share a channel with a plain deselect.
6. **`NoteToolbar` lives inside the note element, drawn in screen space.** It is
   positioned above the note and scaled by `1/zoom`, so its on-screen size is the
   same at 35% and at 400% (TC-28 needs a clickable swatch at zoom 0.35). Keeping
   it inside the memoised note means a colour change re-renders one note, not the
   board; it is marked `data-note-ui`, and both `pointerdown` and `dblclick` on the
   note body ignore anything inside that subtree and stop propagation, so a click on
   a swatch can never start a drag, start an edit, or clear the selection.
7. **`useSelection` returns one stable object whose members are getters** (as the
   design asks). `getSelectedId()` is read at call time; `select / startEdit /
   endEdit / clear` keep their identity for the life of the board, which is why the
   viewport's listeners are bound once.
8. **`BoardViewport` gained `onSurfaceClick` / `onSurfaceDoubleClick`.** The
   viewport reports *that* a click or a double-click happened on the board surface;
   `App` decides whether it was empty space (via `isInsideNoteUi`), so the viewport
   still knows nothing about notes.
9. **Test hooks.** `window.__vidi6` keeps `setCamera` and gains `getDoc`,
   `getNotes`, `seedNote`, `removeNote`. `seedNote` goes through the model
   functions, so a test cannot seed an invalid note. Still gated on
   `import.meta.env.MODE === 'test'`; the production bundle contains no hook (the
   guard collapses at build time and only the `delete window.__vidi6` cleanup
   survives).
10. **z-order is asserted in the browser, not in jsdom.** `elementFromPoint` in
    jsdom answers with the container whatever is on top, so the stacking assertions
    (TC-32, golden path) live in e2e. The component tests assert the two things
    jsdom can see: DOM order by `z` and the raised `zIndex`.
11. **`typeText` in the component harness** writes through the native
    `HTMLTextAreaElement.prototype` value setter. React 19 keeps the current value
    on the instance, so assigning `el.value` first and dispatching `input` afterwards
    is swallowed; the native setter is what a real typing session does.
12. **Transaction counting listens to `update`, not `transact`.** Verified against
    Yjs 13.6.33: `doc.on('transact')` does not fire for
    `doc.transact(fn, origin)`, while `update` fires exactly once per transaction
    that changes state — which is the quantity the tests are about.
13. **`tests/fixtures/texts.ts`** is shared by the unit, component and e2e suites
    (one word, a three-line retro item, 1,000 characters of English prose, with a
    `prose(n)` builder for the 500-note fixture). The e2e `seedNotes` helper takes
    note *centres*, because that is how the camera helpers think; the component
    harness takes top-left corners, like the model.

## Test inventory

- Unit (node): 54 — camera 19, board-model 22 (TC-01…TC-12 + non-finite and
  schemaVersion extras), sticky-text 13 (TC-13…TC-17 + boundaries).
- Component (jsdom): 77 — StickyNote 22 (TC-18…22, 25, 35…37, drag at 200%,
  tracking once the pointer leaves the note, z-order, Tab focus),
  StickyTextEditor 8 (TC-23, 24, 26, 38, diff shape, paste clamp, counter),
  Toolbars 9 (TC-27, 28, 29 + every swatch, pan-away creation), render-cost 4,
  plus the 34 story-1 component tests.
- E2E: 20 per browser × chromium, firefox, webkit — the 12 story-1 cases still
  green, plus 8 new (TC-30 create + edit, TC-31, TC-32, TC-33, TC-34, golden path,
  500 notes).
- 500 notes measure in at 2–6 ms for a click in all three browsers (the app budget
  is one frame, 16 ms; the ceiling in the test is 25 ms because the number also
  carries the driver round trip). Seeding 500 notes takes 0.3–0.5 s.

## Left for later stories

- **`origin === 'remote'`** is supported by `applyTextDiff` and unit-tested
  directly, but nothing produces a remote transaction yet — the Yjs provider in
  story 3 will. The per-note-key rule is enforced by `deleteObject` +
  `getStickyText` rather than by the Y.Text observer, so the editor does not have
  to care which key changed.
- Nothing is persisted or replicated (stories 3/4); the board doc is a local
  `Y.Doc` created by `createBoardDoc`, which is where the provider will hang.
- No undo/redo, no sticky-note resize, no per-note rotation or shadow physics.
- Font fitting runs on mount and on text change only, as specified: the note is a
  fixed size in world units, so a window resize cannot make text overflow.

---

# Story 4 — return to a board and find everything as it was left

Same rule as above: decisions and deviations, not a restatement of the spec.

## What is in place

Runtime (framework-free, `src/worker/`):
- `board-room.ts` — the Durable Object. Sockets are accepted with
  `ctx.acceptWebSocket(server, ['board'])` and handled by `webSocketMessage` /
  `webSocketClose` / `webSocketError`, so a room that was torn down and woken
  answers from the same code as one that never slept. Membership is
  `ctx.getWebSockets('board')` filtered to OPEN, never a `Set` of our own.
- `board-store.ts` — the board's bytes in the object's SQLite
  (`board_blobs(board_id, chunk, blob)`), 96 KiB chunks, one version byte in
  front. `read` answers bytes, "nothing yet", or `STATE_UNREADABLE`; the last
  two are never confused.
- `room-state.ts` — `cold` / `loaded` / `failed`, and the three functions that
  change or consult it (`roomStateAfter`, `loadActionFor`, `shouldCheckpoint`).
- `room-machine.ts` — every decision (what a frame is, who hears it, whether it
  is written down, whether the sender is closed), with no socket in sight.
- `sync-frame.ts`, `board-protocol.ts` — the framing, shared with the client.

## Decisions and the reasons

1. **The room does not greet.** A client opens the sync, as `y-protocols/sync`
   describes for client-server. A greeting would be answered twice by every
   client — once for the greeting, once for its own step-1 — which is how one
   keystroke ends up on a board three times.
2. **The answer to a step-1 is two frames: a SyncStep2 and then a step-1 of our
   own.** The second frame is how a browser that reconnects after the room was
   rebuilt hands back the edits it kept. They stay two frames because a client
   reads one message per frame.
3. **A failed read is a refusal, not an empty board.** 4006 `load-failed`, once
   per wake: a broken read does not get better by being hit forty times a
   second, and the retry budget belongs to the client. `STATE_UNREADABLE` and
   `null` are different answers for the same reason.
4. **The restart path and the load path are one code path.** There is no
   "restart mode" branch, so the restart case cannot be untested by being
   separate.
5. **The write is the last thing that happens, and there are only three times it
   happens:** when a relay has finished and the buffer is older than
   `FLUSH_INTERVAL_MS` or deeper than `FLUSH_UPDATE_THRESHOLD`, when the last
   socket leaves, and never more than once per wake otherwise. The e2e and
   integration tests cover the last-departure write, which is the one a page
   refresh depends on.
6. **`tests/integration/board-room-persistence.test.ts`, not `tests/components/`.**
   The plan said `tests/components/room-doh.test.ts`; a Durable Object only runs
   in the workers pool, and the jsdom project only picks up `*.test.tsx`. The
   file went where it will actually run.
7. **A test-only control surface on the object** (`/control/state`, `restart`,
   `failure`, `timeout`, `damaged`). It is not reachable through the Worker
   entry, so it cannot be dialled by a browser; it exists because "the storage
   is broken" is not something a test can otherwise arrange.
8. **Sync e2e is live again.** The suite was skipped whole at the end of story 3
   because `WebsocketProvider` never reached `synced` against `wrangler dev`.
   That is fixed (framing and the doubled room path), so TC-23, TC-24 and TC-12
   run in all three browsers.
9. **TC-31 is skipped on its own, and the reason is not the board.** Cutting the
   link with `dropConnection()` closes the socket under `y-websocket` 2.1, which
   clears `wsconnected` before it decides whether to announce a disconnect; the
   badge therefore never leaves "Connected". Sync recovers — the same board
   converges afterwards — so this is a reporting gap. It is listed below rather
   than papered over with a `setTimeout`.

## Test inventory

- Integration (workerd): 26 — the 17 story-3 room cases, 14 worker-entry cases
  (some shared), and 10 new persistence cases: board back after a rebuild, 500
  notes, a board bigger than one SQLite row, the rejoin that hands edits back,
  one read for eight candidates, damaged bytes refused, a wedged read refused,
  a relay that does not wait for storage, a duplicate step-1 ignored.
- E2E: 78 passing runs across chromium, firefox and webkit — the 20 story-2/3
  cases plus 3 new persistence cases per browser (leave and come back, reload
  finds the board once, eight people open a board written while nobody was
  there).
- Known flake: `TC-07 … exactly one update` fails roughly once in six full
  integration runs. It is a frame-count assertion taken after a 150 ms quiet
  window, and the persistence file adds real load to the shared worker. The
  config's `fileParallelism: false` does not help (the workers project does not
  accept it), so the flake is left documented rather than hidden behind a
  longer wait.

## Left for later stories

- The connection badge cannot report a link that was closed from the client side
  (see 9). A `connection-close` listener was tried and does not fire either.
- No cross-instance write arbitration: one board is one object, and one object
  has one writer, which is why this is not needed yet. It becomes needed the
  moment a board is allowed to live in more than one place.
- Storage failures are injected in tests but nothing yet *reacts* to a long
  outage at the product level (no "this board could not be opened" screen).
- No per-board quota, no compaction of the blob table, no export (story 17).

# Story 5 — share a board with others using a link

Same rule as above: decisions and deviations, not a restatement of the spec.

## What is in place

Shared (`src/shared/`, no platform imports):
- `create-board.ts` — `createWithRetries`, the `Limiter` / `CreateResult` shapes.
  The retry-and-collision rule lives here, where it can be tested without a
  Durable Object, and the Worker's rate limiter is typed against it.
- `board-id.ts` — `isValidBoardId`, `BOARD_LINK_PREFIX`, `boardLink`.

Runtime (`src/worker/`):
- `index.ts` — `POST /api/boards` (201 / 429 / 500), `GET /api/boards/:id`
  (200 / 404), 405 for the wrong verb, and a room address that answers 404 for
  an id that names no board. The existence check happens before any
  `acceptWebSocket`, and reads without writing.
- `create-board.ts` — the I/O half: ask the limiter, then the object, and retry
  the id on collision inside `CREATE_BUDGET_MS`.
- `board-store.ts` — `migrate`, `existsReadOnly`, `markCreated`, `createdAt`.
  Reads are guarded so a stranger guessing at the id space cannot give a board a
  database of its own.
- `board-room.ts` — `initialize()` and `exists()` as DO RPC, and the same
  existence question re-asked inside `fetch()`.

Client:
- `router.ts` — `resolveRoute`, `boardIdInPath`, `isBrokenBoardLink`. Query and
  fragment are stripped before a path is judged, because chat apps append
  `?utm_source=…` to a shared link and that is not a broken board.
- `api.ts` — `createBoard` / `checkBoard` behind a `fetchImpl` seam.
- `useBoardExists.ts` — loading / found / not_found, doubling backoff, no
  timeout.
- `pages/Home.tsx`, `pages/Board.tsx`, `pages/NotFound.tsx`, `Root.tsx`,
  `share/SharePanel.tsx`.

## Decisions and the reasons

1. **Creating is the only way a board comes into the world.** Story 3 let any
   well-formed id in a room address start a room; that is the bug this story
   exists to kill, so it is gone, and a mistyped link now says "Board not
   found". `tests/integration/worker.test.ts` changed from `400` to `404` in the
   three cases that exercised the old behaviour — the status changed because the
   behaviour did, not to make a test pass.
2. **Both `/b/<id>` and `/board/<id>` open a board.** Stories 3 and 4 put
   `/board/…` in screenshots and bookmarks; a person following one of those is
   not doing anything wrong. `/board` with no id is not a board, and neither is
   a `/board/` that does not name one.
3. **Existence is asked twice, and the second time is not redundant.** The edge
   check is what keeps a socket from ever opening on a wrong address; the check
   inside the object is what keeps a *direct* DO call from pretending a board
   exists. Neither one trusts the other.
4. **`createWithRetries` is in `src/shared/`, not `src/worker/`.** Not for
   tidiness: the unit test that covers the retry rule imports it, and from
   `src/worker/` that import drags `cloudflare:workers` types into the jsdom
   project, which fails `npm run typecheck`.
5. **An unreachable service is never "Board not found".** `useBoardExists`
   retries with a doubling backoff up to `RECONNECT_MAX_BACKOFF_MS` and has no
   deadline, because the alternative tells someone their board has been deleted
   on the strength of a laptop that slept through a handoff. `CREATE_BUDGET_MS`
   bounds *creation*, not this.
6. **The rate limit keys on the connecting address, and the test harness sets
   that header.** `wrangler dev` passes through a client-supplied
   `CF-Connecting-IP` (which is also how TC-13 fakes visitors), so each e2e test
   gets an address of its own derived from its title, its browser and its worker
   slot. It is deduped inside a process and shifted by the process id: three
   browsers run the same specs in parallel, and while the allocator cannot make
   two *machines* disagree, it can and did stop three browsers from quietly
   sharing one ten-a-minute allowance.
7. **One board per e2e test, created in a fixture, rather than one board per
   file.** A shared board means a sticky-note test's notes end up under another
   test's cursor, and one flaky test poisons everything after it in the file.
   The fixture costs about 40 ms a test; it buys independence.
8. **The clipboard is checked two ways.** A recorded `writeText` runs on all
   three browsers, and one Chromium test reads the real clipboard back. Firefox
   and WebKit in this harness have no `clipboard-read`, so a suite that only
   checked the real clipboard would have one browser under test and would say it
   had three.
9. **The legacy-board case (content, no creation marker) is split across two
   layers rather than run as one browser test.** Its storage half — updates rows
   without `created_at` must still read as a board that exists — is TC-08 in
   `tests/integration/board-api.test.ts`, where that state is built directly
   inside a real board's database. Its page half — a board that reports as
   existing opens in a browser and its content travels between two of them — is
   TC-26 in `share.spec.ts`. Running the combination would need a route that
   writes board storage from outside the app; the design suggested gating it
   behind test hooks, and it is true that `window.__vidi6` is stripped from a
   production build, but a write path whose only user is a test is still a write
   path, and the two layers above already say everything the combination would.
10. **`boardLink(boardId, origin)`, not the design's `boardLink(origin, id)`.** Same
    string either way. Kept board-first because the panel and the page both think
    in terms of "this board's link", and because a two-string signature where the
    order is a preference is exactly the kind of thing a caller gets backwards
    while the types stay happy. Recorded rather than changed under cover.
11. **The Share button had to be lifted out of the document flow.** `.board-area`
    is `position: fixed; inset: 0`, so the canvas painted over the whole top bar
    and every click on Share was intercepted. The component test could not see
    this, because jsdom has no pointer hit-testing, and it is the reason the
    panel is also tested in a real browser.

## Test inventory

- Unit: 17 new tests (93 tests in 7 files) — 8 for the create rule, 9 for the router.
- Component: 14 new — `share-pages.test.tsx` (8) and `share-panel.test.tsx` (6).
- Integration: 15 new in `board-api.test.ts`, 56 in the project. Coverage: 201
  and a usable id, 429 against the real limiter binding, 500, collision retry,
  a wrong verb, a malformed id, an unknown id, a legacy board (content, no
  creation marker), no storage written for a stranger's guess, existence for the
  two address shapes, the room that refuses an unknown board, and the room that
  refuses a board nobody could confirm.
- E2E: 39 runs added by `share.spec.ts` — 37 passing across three browsers, 2
  skipped (the real-clipboard case, Chromium only, see 8). Suite total 120 runs,
  115 passing, 5 skipped.
- Verification hazard, found the hard way: `reuseExistingServer` is on outside
  CI, so a `wrangler dev` left listening on 5178 makes the next run test *the
  previous build* and report everything green. Final runs here used `CI=1` and a
  killed server.

13. **A missing rate-limit binding stops board creation; it does not disable the
    limit.** `POST /api/boards` asks nothing for anything but a listener, so the
    counter is the only backstop on how many boards one address can start, and
    the file already said a limiter nobody can hear is not stopping anything —
    the code did not do what its own comment claimed. Absent now denies like an
    unreachable one does, and reports `create_failed` rather than `rate_limited`,
    because the page's copy for a rate limit tells people to wait a minute and
    here that would be a lie. Checked against the real binding too: `wrangler dev`
    resolves it, the whole e2e suite still creates boards through the endpoint,
    and the case that pins this behaviour fails the moment the guard is removed.

14. **A board that cannot be checked is refused, and that is deliberately not a
    `404`.** An existence read that throws propagates, which a same-origin client
    sees as a failure rather than an answer, and `checkBoard` reads failures as
    "couldn't reach vidi6" — so it retries and the board opens when storage comes
    back. Turning it into a tidy `404` would make the page say *Board not found*
    about a board that exists, and `not_found` is the one answer the client treats
    as final. The property is pinned by a test whose control half hands the same
    request to a room when the lookup *does* answer, so it is not passing because
    nothing could have reached the room; replacing the check with
    `catch { return true }` — the shape it would take if someone made outages
    comfortable — fails it.

## Verifying a change in this area

- `npm run typecheck` covers `src`, `tests/unit` and `tests/component`. The
  integration and e2e files are **outside that gate** — they are compiled when
  the suite runs, so a mistake in one surfaces as a suite failure and nothing
  else. A green typecheck says nothing about them; run the suites.
- When a check here is verified by breaking something first, note that
  `git checkout <file>` does not restore an **untracked** file — most of what
  story 5 added is untracked. Copy it aside first, or the sabotage stays in the
  tree looking like the original.
- Rate-limit tests take a visitor address per case. In the integration project
  they are counted out of `198.51.100.0/24`; before that they were drawn at
  random from a range that contained an address another case had already spent,
  which failed TC-13 about once in 200 runs for a reason unrelated to the code.
  The premise of the fix — one key, one budget, for the whole worker run, and a
  different address untouched by it — was checked rather than assumed.

## Left for later stories

- A link is a whole capability: anyone who has it can read and write the board,
  there is no way to take it back, and a board's id is the only secret. That is
  the story's design, not an oversight; it stops being acceptable when boards
  hold other people's work (stories 14 and 15).
- The per-address limit is an abuse guard with no account behind it: one laptop
  behind one NAT address is one visitor, and a VPN is unlimited.
- A board that cannot be reached keeps retrying and shows a sentence. Story 13
  wants a real offline story; there is no "this board could not be opened" state
  yet, and no ceiling on the retries.
- `/` is a page with one button. The board list, rename and search are story 15;
  nothing here predicts them beyond keeping `create` and `go` injected so the
  dashboard can reuse the pages.
- The Share panel copies a link. It does not open the OS share sheet, QR, or
  expiry, and it never will from a text field.

# Story 6 — see who else is on the board and where their cursors are

## What is in place

Presence is carried, stored and drawn in three places, and none of them is a new
protocol. The room tracks who it believes is connected; the browser turns that
into people; the overlay draws people as dots, arrows and outlines.

- `src/worker/awareness-tracker.ts` decodes an awareness update into
  `{clientId: clock}` and encodes a removal (the same layout with a JSON `null`
  state at the last seen clock, which is what `applyAwarenessUpdate` treats as
  "this person has gone"). Pure, and tested against real `Awareness` instances
  rather than hand-written bytes.
- `src/worker/board-room.ts` keeps those clocks in the WebSocket attachment, so
  they survive hibernation; relays awareness verbatim to every other socket
  including the sender; asks "who is here?" when a socket is accepted, which is
  what makes an *idle* crowd visible to a newcomer; and broadcasts removals when a
  socket closes or errors.
- `src/client/presence/` is `identity.ts` (a remembered "Adjective Animal" name
  and a colour preference, with a memory-only fallback when storage throws),
  `colors.ts` (a pure index assignment that converges without a server),
  `people.ts` (derivation: dedupe by person, self excluded), `transport.ts` (the
  one place that touches the wire), `usePresence.ts` (the hook), and
  `Presence.tsx` (avatar stack, overflow list, rename field, remote cursors,
  remote selection outlines).

## Decisions and the reasons

1. **No second socket.** Presence rides the document's own awareness channel. A
   separate presence connection would need its own reconnect logic, its own idea
   of "who is here", and its own way to be wrong, and it would buy nothing: the
   two facts people want — what changed, and who is looking at it — arrive on the
   same wire either way.
2. **The server keeps no presence states.** They would be lost on hibernation
   anyway, which is the whole reason the room is allowed to sleep. It keeps
   `{clientId: clock}` per socket in the attachment, used only to say "and this
   one has gone" when a socket closes.
3. **The stack never fades anybody.** An earlier cut dropped people after a
   thirty-second silence, and the first thing that did was delete a quiet reader
   and call it a departure. Presence is dropped when the *connection* goes; a
   person reading rather than clicking is on the board. Cursors do fade, because a
   place somebody looked at two seconds ago is a claim about where they are, and a
   stale one is a lie. A dot makes no such claim.
4. **The clock only runs while a cursor is on screen.** An occupied but still
   board repaints twice a second at most; an idle one runs no timers at all. That
   is also the cost constraint: presence traffic must not keep a board running
   when nobody is connected.
5. **Colours are per session, not per person.** The stored colour is a
   preference; the displayed colour is the lowest free palette index, and two
   clients that pick the same one resolve it by client id, so a board converges
   without anyone being in charge. Past the palette, indices repeat and names do
   the distinguishing — which is why a name is never optional next to a colour.
6. **A person with two windows is one person.** Deduped by person id, and the
   most recently updated window is the one drawn. This screen's own pointer and
   own selection are never drawn back at it, including from its other tab.
7. **A link that wobbles is not a room emptying.** `y-websocket` deletes every
   remote state the moment its socket closes, and the first version of this drew
   that: the stack and the cursors vanished for the length of a wobble and
   refilled, which on screen is indistinguishable from everybody leaving. Now the
   last-known crowd is held while the link is down, and when it comes back the
   board asks the room who is here and rebuilds from the answer after
   `PRESENCE_RECONNECT_RECONCILE_MS`, so a person who really did go stops being
   drawn. Held, not believed.

## Two ways this was checked by breaking it

Both of these were written to *fix* something and were caught by the suites after
they were already in the tree, which is worth writing down because neither was an
obvious mistake.

- **Origin is not a link state.** The wobble hold first keyed on the transaction
  origin of an awareness update, on the assumption that a local bookkeeping change
  and a message from the room could be told apart that way. They cannot:
  `y-websocket` applies *incoming* awareness with the provider as its origin too,
  so the guard swallowed all real presence and the headline feature went quiet.
  The unit suite stayed green throughout; twenty e2e tests went red. The rule is
  now "is the link up", read from the provider (`wsconnected` is switched off
  *before* those states are removed, and back on before anything from the room is
  applied to them again), and a test pins the half that broke — *an update that
  arrives over a live link is drawn, which is the whole point*. If you are tempted
  to sort awareness events by where they came from, that test is the reason not
  to.
- **Reading a crowd one board at a time measures the wrong thing.** The overflow
  test closed each board inside the loop that read them, so the first close
  removed a person from every board still being checked, and the six-person crowd
  it was meant to prove was there was down to five, then four. A board with five
  people has no `+1` to open, and the check spent ten seconds waiting for a button
  that had correctly disappeared. Every board is read before any is closed.

## Test inventory

- `tests/unit/awareness-tracker.test.ts` — decode and round-trip against real
  `Awareness`, removals, and malformed bytes answered with `null` rather than a
  throw.
- `tests/unit/presence-{identity,identity-contract,colors}.test.ts` — name
  generation and validation, storage that throws, and a seeded 500-run simulation
  of clients joining in random order that must always land on distinct colours
  within capacity.
- `tests/unit/presence-transport.test.ts` — throttling, self and same-person
  exclusion, and the link-wobble rules above.
- `tests/integration/presence-room.test.ts` — a real Durable Object and real
  WebSockets: removal on close, removal after hibernation via the attachment,
  query-on-join making idle people visible, and undecodable bytes relayed untouched
  with the socket still open.
- `tests/component/presence.test.tsx` — the stack, the overflow list, the rename
  field, off-screen cursors, and outlines that never block a click.
- `tests/e2e/presence.spec.ts` — cursor delivery across differing zoom, hide on
  pointer leave, full-room colours and overflow, remote outlines, rename
  persistence, leaving, and one person in two tabs. Runs in all three browsers.

## Verifying a change in this area

- The timing budgets in `config.ts` are product settings and the tests read them.
  Changing `CURSOR_LATENCY_BUDGET_MS` changes what the e2e suite demands; it is not
  a test constant dressed as one.
- The fake provider in the unit suite has no `wsconnected`, so it takes the
  fallback path. That is deliberate, but it means a unit test cannot tell you
  whether the real provider's link state is being read correctly — the e2e suite
  can, and it is the one that caught the mistake above.
- Presence is only observable through what is drawn. Read the overlay, not the
  document: a check on the document passes on a board that has already lost the
  person.

## Left for later stories

- `selection` on the wire holds one id today. Story 7's multi-select drops
  straight into it; nothing here assumes one.
- The wobble hold and the offline story are the same problem seen from two sides.
  Story 13 wants a board that keeps working with no link; this holds the last
  known crowd while there is no link, which is a rendering decision made for a
  different reason, and the two should be reconciled rather than left to drift.
- Signed-in names (story 14) reuse the `Identity` shape on purpose; the colour
  preference is expected to become the person's, not the session's, at that point.
- Presence tells everyone where your pointer is and what you have selected. That is
  the feature. It is also a decision about how much of a person's attention the
  board publishes, and it has not been revisited since.

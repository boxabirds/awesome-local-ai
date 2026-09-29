# Notes

## Story 1: Pan and zoom around an infinite board

### Decisions made

1. **jsdom PointerEvent polyfill**: jsdom does not implement `PointerEvent`, so we added a polyfill that extends `MouseEvent` in the test setup (`tests/component/setup.ts`).

2. **Native event handlers in tests**: Wheel and gesture events use `addEventListener` with `{ passive: false }` to call `preventDefault()`. In component tests, these are dispatched via `el.dispatchEvent()` wrapped in `act()` to ensure React state updates flush synchronously.

3. **Architecture**: The `useCamera` hook is lifted to the `Board` component in `App.tsx`, and `BoardViewport` receives `camera` and handler callbacks as props (slight deviation from the design's `BoardViewport({ children })` contract to enable testing). The `useCamera` hook manages camera state, `hasNavigated` latch, and all interaction handlers.

4. **Zoom step snapping**: `zoomStep` snaps the result to the nearest `ZOOM_STEP_FACTOR^n` when within `1e-9`, preventing float drift over many zoom in/out cycles.

5. **Playwright browsers**: Only Chromium is configured for e2e tests (design allows "Chromium is sufficient if other browsers are not installed"). Firefox and WebKit are not installed in the environment.

6. **E2e test build**: The `test:e2e` script runs `npm run build:test` (vite --mode test) before playwright, which exposes `window.__vidi6.setCamera` for tests that need to jump to distant positions.

7. **Origin marker**: Rendered as an SVG crosshair at world (0,0) inside the world layer, present in all builds. Gives e2e tests a stable pixel reference.

8. **Wrangler config**: Assets-only configuration (no `binding` field) to support `wrangler dev` for static file serving without a Worker script (Worker code arrives in story 3).

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions made

1. **Yjs from day one.** Notes live in a `Y.Doc` (`src/shared/board-model.ts`, framework-free so the story 4 Durable Object can import it). Schema: `meta: Y.Map {schemaVersion}`, `objects: Y.Map<id, Y.Map{type,x,y,color,z,createdAt,text: Y.Text}>`. Every successful mutation runs inside `doc.transact(fn, LOCAL_ORIGIN)`; rejections (stale id, unknown colour, non-finite coordinates, `bringToFront` on the top note) return `false` before a transaction opens, so an observer never sees a no-op update. Story 3 only has to attach a provider, story 4 only has to persist the same document.

2. **Snapshot reads are React-safe.** `useBoardDoc` observes `objects.observeDeep` and exposes an immutable snapshot through `useSyncExternalStore` with a cached snapshot compared field-by-field, so unrelated Yjs updates cannot cause an infinite render loop.

3. **Selection is local.** `useSelection` keeps `selectedId`/`editingId` outside the Y.Doc: another user's presence is a later story. `endEdit('unselected')` only clears the selection when it still points at the note that was edited, so clicking a second note while editing the first leaves the second note selected (blur arrives after the new `pointerdown`).

4. **Notes are stacked with CSS `z-index`, not DOM order.** The first implementation rendered notes in `(z, id)` order, but `bringToFront` then *moved the dragged element in the DOM*, which silently drops pointer capture mid-drag (found by the 200% zoom e2e test: the note stopped following the pointer). Notes now render in a stable order (by id) and the wrapper carries `zIndex: note.z`. Stacking semantics are unchanged; `snapshot()` still returns `(z, id)` order for anything that paints by array order.

5. **Drag is rAF-throttled and zoom-correct.** Pointer moves only record the latest point; one `requestAnimationFrame` per frame calls `moveObject` with the screen delta divided by the current camera zoom. `pointerup` applies the trailing point synchronously so the note ends exactly under the pointer. `bringToFront` is called once when the `DRAG_THRESHOLD_PX` is exceeded. Pointer down on a note calls `stopPropagation()` so the board never pans (asserted in e2e by watching `data-camera-x/y`).

6. **Text is written per keystroke with a minimal diff.** `applyTextDiff` computes the common prefix/suffix and issues one delete and/or one insert inside a single transaction (unit-tested by watching the `Y.Text` delta), so story 3's concurrent typing will not be clobbered. Surrogate pairs are never split, and input beyond `STICKY_TEXT_MAX_CHARS` is clamped with the caret restored — a 1,200 character paste yields exactly `1000/1000`.

7. **Auto-fit is measured, not estimated.** A hidden measuring element with the note's width/padding is binary-searched between `STICKY_FONT_MAX_PX` (24) and `STICKY_FONT_MIN_PX` (10) against `scrollHeight`; below the minimum the text layer keeps the last size, clips (`overflow: hidden`) and shows a bottom `.sticky-note-fade` gradient. Fit is recomputed on text change only, since zoom scales world units uniformly.

8. **IME safety.** `compositionstart`/`compositionend` gate the `input` handler; the commit happens on `compositionend` so composed words are inserted once.

9. **Deleting the note under an active interaction ends it silently.** While dragging or editing, if the note vanishes from the snapshot (or `moveObject` returns `false`), the interaction state is reset instead of throwing — the component tests cover both paths.

10. **Keyboard reachability.** Notes are `tabIndex=0` inside a `role="group"` with an accessible name; focusing selects, Enter edits (caret at end), Escape ends editing with the note still selected, Delete/Backspace deletes only when not editing. Toolbar buttons, swatches (`aria-label="<Colour> colour"` + `aria-pressed`) and the delete button all have names, so colour is not the only signal.

11. **Test hooks.** `window.__vidi6` (test build only) gained `getCamera` next to story 1's `setCamera`, used by the "pan far away" and zoomed-drag tests. Notes expose `data-note-id`, `data-x`, `data-y`, `data-z` so e2e can assert world positions and stacking.

12. **Test isolation gotcha.** Wrapping an async `act()` body in `expect(...).resolves.not.toThrow()` leaves React's act queue in a state where the *next* test's render is never flushed; capture errors inside the `act` body instead (see the "deleted while dragging" test).

13. **Scale check.** `tests/component/Scale.test.tsx` seeds 500 notes into a real `Y.Doc`, renders them and drags one — the whole file runs in well under a second in jsdom, which is the smoke test for the "500 notes stay responsive" constraint (not a hard gate in this story).

### Deviations from the design

- `StickyTextEditor` is rendered as an overlay `<textarea>` on top of the note's text layer instead of making the text layer `contenteditable`; this keeps the caret, IME and clipboard behaviour native while still writing through `applyTextDiff`.
- The note toolbar is positioned in world space and counter-scaled (`scale(1/zoom)`), which keeps it a constant pixel size above the note at any zoom without a portal or measuring pass.
- e2e runs in Chromium only (unchanged from story 1: Firefox/WebKit binaries are present but cannot launch in this environment).

## Story 3: See other people's edits appear live on the same board

### Decisions made

1. **Non-hibernating WebSockets in the Durable Object.** `BoardRoom` calls `server.accept()`
   once and holds the accepted sockets with ordinary `message`/`close` listeners rather than
   using `webSocketMessage` hibernation. Hibernation would let the DO evict while sockets stay
   open, dropping the in-memory `Y.Doc` and losing merge state between updates — the opposite of
   what a live relay needs. The cost (a warm isolate per active room) is the deliberate trade.

2. **Awareness is relayed to *every* socket, including the sender.** Re-broadcasting the
   30-second y-websocket keepalive/awareness frames to all peers is what stops an *idle* client's
   no-message watchdog from dropping its connection (nightly TC-29). Query-awareness frames are
   parsed and ignored; awareness bytes are forwarded verbatim.

3. **`disableBc: true` on the client provider.** The client never uses `BroadcastChannel`, so
   even two tabs on the same machine must round-trip through the server. This is what makes the
   integration tests (Node `SELF.fetch` upgrade) and the multi-context e2e tests exercise the real
   relay path instead of a same-origin shortcut.

4. **`errorHandler` rethrows so invalid Yjs updates close 1003.** A malformed update must sever
   only the offending socket (`close(1003, ...)`) and leave the room document and every other peer
   untouched — TC-15 asserts four malformed variants close just the sender.

5. **No participant cap is enforced.** `MAX_CONCURRENT_EDITORS` (5) is a soft design/test target;
   over-capacity joiners are never refused. TC-13 opens `MAX + 5` sockets and TC-26/TC-30 run at
   exactly `MAX` real browser contexts to prove convergence at the boundary and beyond.

6. **`isolatedStorage: false` + `singleWorker: true` for the worker test pool.** `BoardRoom` keeps
   an accepted WebSocket (and its SQLite object) alive across a test boundary, which per-test
   isolated storage cannot unwind; shared storage with a unique board id per test keeps rooms from
   colliding. `singleWorker` also avoids the "File name too long" DO storage-directory names that
   the deep benchmark working directory otherwise produces.

7. **Room routing = `idFromName(boardId)` per board.** `index.ts` routes `GET /api/rooms/:boardId`:
   invalid id → `400`, valid id without an `Upgrade: websocket` → `426`, otherwise hand to
   `env.BOARD_ROOM.get(idFromName(boardId)).fetch(req)`. Everything else falls through to
   `env.ASSETS` with SPA `not_found_handling`. Two rooms are provably isolated (TC-17).

8. **A single connection state machine drives the badge.** `createConnectionState()` maps the
   provider's `connecting`/`connected`/`disconnected` callbacks plus a "did we ever sync" flag into
   `connecting → connected → (idle 2 s) confirmed`, and to `reconnecting` on loss *after* the first
   sync. The badge is hidden in `connected`, so a healthy board never shows chrome; `role="status"`
   announces only genuine transitions. Board editing is never gated by connection state.

9. **`prune()` drops stale local selection on remote deletion.** App calls `prune(id => present)`
   whenever the note snapshot changes; if the selected or edited note vanished (a collaborator
   deleted it mid-edit) the selection and editor are cleared without a throw (e2e TC-25).

10. **Collaborative text now reflects remote edits in the open editor.** `StickyTextEditor` gained
    a `ytext.observe` handler that, on a non-`LOCAL_ORIGIN` change, writes the merged text back into
    the textarea and parks the caret at the end. Without this, a local commit's minimal diff would
    recompute against a value missing the remote characters and erase them — the whole point of
    `applyTextDiff`'s prefix/suffix design (story 2's forward-looking comment). Two users typing
    into one note now keep every character (e2e TC-23). The observer is a no-op in single-user
    jsdom tests (no remote origin), so the existing editor tests are unaffected.

### Nightly result record (run once through `test:e2e:nightly`, Chromium, one machine)

- **TC-29 idle stability:** PASS. Two contexts idle for 45 s; the mapped `ConnectionState` stayed
  in {connected, confirmed} and the `role="status"` badge never rendered "Reconnecting…".
- **TC-30 capacity soak:** PASS. `MAX_CONCURRENT_EDITORS` contexts, seeded continuous edits
  (create/move/type/recolour/delete through the real UI) for 60 s. **seed=1234567, ops=174,
  p50=2 ms, p95=3 ms, max=4 ms**, budget=1000 ms, 0 changes over budget, 0 badge violations, all
  final board snapshots identical.

Both are excluded from the default `test:e2e` (separate `nightly` Playwright project; `test:e2e`
runs `--project chromium` only). They are timing-sensitive and were previously flaky under
single-machine contention; the remaining flakiness was fixed in the *test harness* (non-waiting
`querySelector` DOM reads and a short `actionTimeout` so a momentarily-absent element can never
stall the soak loop), not by weakening the assertions.

### Deviations from the design

- e2e runs in Chromium only (as in stories 1–2; Firefox/WebKit cannot launch in this environment).
  TC-22/TC-23 are the cross-browser candidates but are covered in Chromium here.
- Integration tests are consolidated into two files (`worker-routing.test.ts`, `board-room.test.ts`)
  rather than one file per concern; they still cover TC-04…TC-18 and TC-31 end to end.
- `test:integration` runs `vite build` first so the `dist/client` assets exist for the SPA-fallback
  assertion (TC-14 checks `text/html` served from the `ASSETS` binding).
- e2e board ids are generated with the Web `crypto.getRandomValues` in the test helper (22-char
  base64url, matching `BOARD_ID_PATTERN`) rather than importing the client module, so Playwright
  specs need no source-path aliases.

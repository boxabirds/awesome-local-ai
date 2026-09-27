# Implementation notes

## Story 4 — Return to a board and find everything as it was left

SQLite-backed persistence for `BoardRoom` so a board survives the Durable Object being
evicted or the process restarting. See `spec/stories/004-…/design.md` and `tasks.md`.

### Layout

- `src/worker/board-store-chunks.ts` — pure, storage-free helpers: `chunkBytes`,
  `joinChunks`, `shouldCompact`.
- `src/worker/board-store.ts` — the `BoardStore` SQLite layer (`updates` log → chunked
  `snapshot`, quarantine table, compaction in a transaction, migration). Re-exports the
  chunk helpers.
- `src/worker/room-state.ts` — the full reference lifecycle state machine (pure).
- `src/worker/board-room.ts` — the persistent, **hibernating** room: reloads on construct
  via `ctx.blockConcurrencyWhile`, accepts sockets with `ctx.acceptWebSocket`, stores every
  update before broadcasting it (output gating), compacts after append, resets to a reload
  on a storage failure, and refuses to present an unloadable board as empty (close 4500).

### Deviations from the spec (with reasons)

1. **File names shortened to ≤10-char basenames for the DO-SQLite integration tests.**
   The design names `board-room-persistence.test.ts` / `board-store.test.ts`. On this
   benchmark's deep working directory the workers runtime names each DO's SQLite
   directory `<prefix>_<sha1>_<absolute-test-path>-<DOClass>`, and macOS caps a single
   path component at 255 bytes — long basenames make the runtime throw ENAMETOOLONG.
   The room integration suite therefore lives at `tests/integration/room.test.ts` and the
   store suite at `tests/integration/store.test.ts`. Only the *file name* differs; the
   cases are the designed TCs.

2. **TC-01/TC-02 chunk helpers live in `board-store-chunks.ts` (no DO types) and are
   unit-tested at `tests/unit/board-store.test.ts`.** `tsconfig.json` (the base DOM-lib
   project, which `npm run typecheck` runs first) includes `tests/unit` but NOT
   `src/worker`; importing the full `board-store.ts` from a unit test dragged the
   worker-typed `BoardStore` into the base program where the Workers ambient is absent.
   The pure helpers are split out so the unit test typechecks cleanly, and `board-store.ts`
   re-exports them (store integration tests import unchanged).

3. **`DurableStorage` is `DurableObjectState['storage']`, derived structurally** rather
   than naming a global `DurableObjectStorage` alias, for the same base-program reason.

4. **Room runtime state is a coarse `'loading' | 'ready' | 'load-failed' | 'storage-failed'`
   mirror**; the full design lifecycle (hibernation, compaction, quarantine transitions) is
   modelled and unit-tested purely in `room-state.ts` (TC-27).

5. **Integration tests read/write the SAME board storage as the live room** via
   `runInDurableObject(env.BOARD_ROOM.get(idFromName(boardId)), …)` (same DO id ⇒ same
   SQLite database, `isolatedStorage:false`), and force the room's real `load()` / rewind
   `loadFailedAt` through `(instance as …)` to drive the load-failure and retry-interval
   paths deterministically instead of waiting `LOAD_RETRY_MIN_INTERVAL_MS` of wall clock.
   A `RoomClient.connectWithDoc(boardId, existingDoc)` helper models a client that
   reconnects still holding an unsaved change (TC-14).

### Behaviours preserved from story 3

All story-3 sync / awareness / presence / close-code behaviours are unchanged — verified by
the existing `sync`, `edge`, and `worker` integration suites still passing unchanged after
the room was rewritten to hibernate and persist.

## Story 4 — client load-failure state & e2e

**`load_failed` client state (task 7).** `ConnectionStatus` (client) gained a `load_failed`
member whose label is the honest "This board couldn't be loaded. Retrying…". `connectBoard`
holds that state *sticky* through the y-websocket provider's retry churn: a `connection-close`
with `CLOSE_BOARD_LOAD_FAILED` (4500) sets it; every `status` event is suppressed while held
(otherwise each reconnect-before-refusal would flicker the badge back to Connected); the first
completed `sync` clears it (a repaired board re-enables editing with no page reload). Other
close codes (e.g. the storage-failure 1011) are NOT surfaced as `load_failed` — they map to the
existing "reconnecting" behaviour, because that board is readable and its changes are resent.

**Edit lock (task 7).** `App` exports `canEdit(status)` — false only for `load_failed`. It
disables the toolbar Sticky-note button, and guards every board-model mutation: create
(double-click and toolbar), Delete/Backspace, Enter-to-edit at the `App` level, plus an
`editable` prop threaded into `StickyNote` that refuses drag-move (`moveObject`/`bringToFront`),
recolour (`setStickyColor`), the note's own delete button, and opening the text editor. Selecting
a note is still allowed (a purely local, non-model action).

**Component tests (task 8).** `tests/component/load-failed.test.tsx` mocks `y-websocket` with a
controllable provider that fires `status` / `connection-close` / `sync`; everything else (status
machine, `canEdit`, `StickyNote`, model) is the real code. TC-22 asserts the badge text,
`role="status"` and the red (`#c62828`) colour; TC-23 drives a 4500 close and asserts the full
negative list — create, toolbar click, Delete, drag, double-click-to-edit, recolour and the
delete button all leave the model untouched — plus a repair case (a later `sync` re-enables
editing without a reload).

**E2E (tasks 5 & 9).** See `tests/e2e/NOTES.md` (Story 4 section) for `TC-19/20/21/24`, the
`createPersistedDevServer` helper, the `--var TEST_HOOKS` mechanism, and the documented TC-21
sandbox load allowance. The room's test-only `/__test/board/:id/{corrupt,repair}` endpoint writes
and removes an unreadable `snapshot_chunks` row (the `persist.load_failure` path) and is inert
unless the server runs with `--var TEST_HOOKS:1` (never in the production config).

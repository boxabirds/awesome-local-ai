# Story 2 — Sticky notes: notes & decisions

## Scope
Implemented story 2 only (capture + rearrange sticky notes). Did **not** implement
stories 6 / 13–17. Story 1 (camera) was left intact — its 7 e2e specs still pass.

## Board model (`src/shared/board-model.ts`) — framework-free, Yjs
- Schema: `meta: Y.Map { schemaVersion: 1 }`; `objects: Y.Map<id, Y.Map>` with
  `type, x, y, color, text: Y.Text, z, createdAt`. The sticky text lives on the
  note entry (`objects.get(id).text`) and is a real `Y.Text`.
- Ids via `crypto.randomUUID()`.
- Every successful mutation is wrapped in a single `doc.transact(fn, LOCAL_ORIGIN)`
  so one user action == one `update` event (the sync test in story 3 relies on
  this). Rejections (stale id, unknown colour, non-finite coords, `bringToFront`
  on the topmost note) return `false` *before* opening a transaction — verified
  by asserting `update` event counts (1 vs 0) in the unit tests.
- `createSticky` places the note top-left at `point − STICKY_SIZE_WORLD/2`
  (creation is centred on the point), z = maxZ + 1.
- `snapshot` returns an immutable `StickySnapshot[]` sorted by `(z, id)`, skipping
  unknown `type` (forward compatible). `x`/`y` are the note **top-left** in world
  units; helper tests treat them as such.
- Story-1 test hook `window.__vidi6` was **extended**, not replaced: the camera
  methods still live in `useCamera`; the board hook is merged on top (spread), and
  a `worldToScreen(p)` helper was added (viewport CSS-pixel space, `inset:0`).
  Everything board/test-hook related is gated on `import.meta.env.MODE === 'test'`
  so it is excluded from production builds.

## Text logic (`src/client/objects/StickyText.ts`)
- `applyTextDiff` computes a common prefix + common suffix and issues at most one
  delete and one insert in one transaction. Suffix trimming stops at index 1 so a
  surrogate pair that matches at both ends can never be torn apart.
- `clampToLimit` truncates to `STICKY_TEXT_MAX_CHARS` (1000) without splitting a
  surrogate pair.
- `fitFontSize` binary-searches an integer px in `[MIN, MAX]` against a measured
  box; returns an `overflow` flag when even the minimum size does not fit.
- Counter appears at `remaining <= STICKY_COUNTER_THRESHOLD_CHARS`.

## Rendering
- Notes are children of the world layer inside `BoardViewport`, positioned in world
  space; they set `pointerEvents:'auto'` so events pass through the
  `pointerEvents:'none'` layer. `data-note-id`, `data-selected`, `data-mode` are
  exposed for tests.
- The note font is authored in **world units**; the world layer's zoom `scale()`
  makes it grow/shrink with the board, and the editor's font is derived from the
  same fit function, so zoom never changes the fit result (only the zoom
  transform, not the font size, responds to zoom).
- The note toolbar was first built inside the note with a `scale(1/zoom)` counter;
  in a real browser that produced hit-testing artefacts. It is now a **screen-space
  overlay in `App`** (a sibling of the viewport, not scaled by zoom), positioned
  above the selected note via `worldToScreen`, hidden while editing. This matches
  the design ("rendered in screen space above the selected note") and keeps
  toolbar clicks from ever reaching the viewport.

## Interaction state machine
- Drag/press/edit state is kept **inside `StickyNote`** (a local `mode`:
  idle → pressed → dragging) and reset via `pointerup` / `pointercancel` /
  `lostpointercapture`. The board keeps no per-note gesture state (design intent).
- Selection / editing are **local** React state (`useSelection`), never written to
  the Y.Doc.
- pointerdown on a note calls `stopPropagation`, so a note drag can never pan the
  board (verified in e2e: camera is byte-identical before/after a note drag).
- Drag deltas are divided by the camera zoom so the grabbed point tracks the
  cursor at 50 / 100 / 200 % (verified in e2e with exact world-unit deltas).
- Drag is applied synchronously (no rAF throttle). Chosen because jsdom component
  tests dispatch discrete pointer moves and need deterministic results; at most a
  few dozen notes are on screen so the cost is fine. Left as a note in case a
  perf budget is added later.
- If a note disappears from the snapshot mid-interaction (deleted by another
  client), the next pointer move checks `noteAlive` and ends silently — no
  exception, and the stale-id `moveObject` is a no-op (`0` updates), so the note
  is never recreated.

## Keyboard (App, window keydown)
- Ignored entirely while editing or when focus is in a text field.
- `Enter` on a selected (not-editing) note → edit (caret at end).
- `Delete` / `Backspace` on a selected (not-editing) note → delete + clear
  selection. While **editing**, the same keys fall through to the textarea and
  edit text instead (the negative rule from the PRD).
- `Escape` on a selected (not-editing) note → deselect; `Escape` while editing →
  stop editing but keep the note selected.
- `n` / `N` → create a note at the viewport centre (toolbar equivalent), entering
  edit mode.
- With nothing selected, Enter/Backspace/Delete do nothing (TC-36).

## Toolbars
- `Toolbar` (fixed left): the "Sticky note" creation button, which creates a note
  centred on the viewport (via `screenToWorld`, so it works when panned far away).
- `NoteToolbar`: six colour swatches (each named in its accessible label, colour
  not the only signal) + a bin button. Kept `data-testid="note-toolbar"` /
  `note-delete`.

## Tests
- Unit: `board-model.test.ts` (TC-01–12 + non-finite + schemaVersion) and
  `sticky-text.test.ts` (TC-13–17), against a real `Y.Doc`, no mocks.
- Component: `StickyNote.test.tsx`, `StickyTextEditor.test.tsx`, `Toolbars.test.tsx`
  render the real `<App/>` in jsdom (Playwright is unavailable for these), seeded
  through the `window.__vidi6` test hook.
- E2E: `sticky.spec.ts` in **chromium** (Playwright). The environment ships
  Chromium at `$PLAYWRIGHT_BROWSERS_PATH` only; Firefox / WebKit are not installed,
  so the two browser-only negative zoom tests and cross-browser runs were not
  executed here — that limitation is recorded as instructed. Component tests use
  jsdom per the story's test-boundary note.
- `tests/fixtures/texts.ts` provides `SHORT_PHRASE`, `RETRO_ITEM` and a real
  1000-char English `LONG_PROSE` (counted, not a repeated single character).

## Verification (all green before commit)
- `npm run typecheck` (tsc --noEmit) — clean.
- `npm run build` — succeeds (yjs bundled).
- `npm run test:unit` + `test:component` — 82 passing.
- `npm run test:e2e` — 15 passing (7 camera + 8 sticky), single worker.
# Story 5 — Share a board with a link: notes & decisions

## Scope
Board creation API + unguessable ids, a path router (`/` home, `/b/<id>` board,
anything else = Board not found), the existence check that gates the board page,
and the Share panel with its clipboard fallback. Stories 1–4 were changed only
where Story 5 required it (no implicit board creation any more).

## Existence, and what "unknown" means
- A board exists when its storage has `storage_meta.created_at`, or (legacy)
  when `updates` / `snapshot_chunks` hold a row. Probing only ever reads: the
  read-only path queries `sqlite_master` first, so an unknown link leaves no
  tables, no `created_at` and no rows (asserted in integration).
- `connectBoard` now refuses to open a provider for an unknown id, and the room
  answers `404` to a WebSocket upgrade for one — the page shows Board not found
  instead of a board that silently accepts edits against nothing.
- Malformed ids are rejected before any Durable Object is touched, so "does not
  exist" and "cannot exist" return the same shape and leak nothing.
- A `?board=<id>` link (story 3/4 form) is now a valid *URL* only as `/b/<id>`;
  the query form was dropped rather than kept as a redirect — every in-repo
  producer was moved to the link form, so no URL shape has to be maintained
  twice. Old links land on Board not found, which is the behaviour the PRD asks
  for a link that names no board.

## Test boundaries (what actually runs where)
- There is no Docker sidecar and no hand-rolled mock storage in the Story 5
  tests. Integration tests use the Workers runtime itself (`env.fetch` for the
  HTTP contract, `env.getDO(id).rpc(...)` for the two-state RPC) against real
  SQLite D1; e2e tests run against a real `wrangler dev` on 127.0.0.1:8799,
  which the e2e harness starts and waits for.
- The local runner does NOT enforce the bound `BOARD_CREATE_LIMITER` (a brand
  new `CLOUDFLARE_ENV` namespace passes through, which is exactly what the
  "limiter really is bound" negative control asserts). So the 10/60 s limit is
  asserted through the binding + an `x-test-ignore-limit` bypass header that is
  honoured only while `TEST_HOOKS=1`; fixtures use it so a 23-test suite cannot
  throttle itself, and the rate-limit cases deliberately leave it off.
- Cross-browser: only Chromium is installed here, so the two scenarios the
  strategy also wanted in Firefox/WebKit (bad link, clipboard refused) run in
  Chromium only. The clipboard ones are still real: one browser context per
  person with clipboard permissions, and a genuine read-back of what the browser
  actually holds before it is pasted into the second context.
- `tests/e2e/helpers/share.ts` keeps one visitor key per context so the create
  limiter is scoped per visitor; a run that re-uses the bucket within 60 s would
  otherwise fail on its own fixtures.

## Small things deliberately not done
- No client-side timeout on the existence check: an unreachable service is
  reported and retried with the story 3 backoff (1 s, doubling, capped at
  `RECONNECT_MAX_BACKOFF_MS`) instead of turning into a fake "not found".
- "Link copied" reverts to the Open panel after `LINK_COPIED_MS` (design
  diagram: Copied → Open), and a second successful copy from the ManualCopy
  state still wins over the manual message.
- The dev-only `/seed` + storage-readout hooks stayed, because the story 3/4
  specs and the legacy-board case need to plant content without a UI; they are
  compiled out of the production bundle (asserted).

## Verification (all green before commit)
- `npm run typecheck` — clean.
- `npm run build` / `build:test` — succeed.
- `npx vitest run` — 208 passing (unit + component + integration, 25 files).
- `npm run test:e2e` — 34 passing in chromium (1 worker, real workerd).

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
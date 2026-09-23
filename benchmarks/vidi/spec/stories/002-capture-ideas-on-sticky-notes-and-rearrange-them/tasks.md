# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Write board model unit tests first against a real Y.Doc (TC-01 to TC-12) | proposed | test:unit | board.model |
| 2 | Implement Yjs board model and useBoardDoc snapshot hook | proposed | implementation | board.model |
| 3 | Write sticky text logic unit tests first (TC-13 to TC-17) | proposed | test:unit | sticky.text |
| 4 | Implement sticky text editing: start/end editing, minimal Y.Text diff, length limit, auto-fit font | proposed | implementation | sticky.text |
| 5 | Implement sticky note interaction: select, drag to move, double-click create, keyboard delete | proposed | implementation | sticky.interaction |
| 6 | Implement toolbars: Sticky note button, colour swatches and delete button | proposed | implementation | sticky.toolbar |
| 7 | Component tests for sticky interaction, text editor and toolbars | proposed | test:ui-component | sticky.interaction, sticky.text, sticky.toolbar |
| 8 | E2E sticky note workflows (create, move at zoom, recolour, delete, long text) | proposed | test:e2e | sticky.interaction, sticky.text, sticky.toolbar |

## Details

### 1. Write board model unit tests first against a real Y.Doc (TC-01 to TC-12)

## Goal
Test-first suite for `src/shared/board-model.ts` (board.model contract) using a real `Y.Doc` (no mocks), plus the sticky named settings in `config.ts`.

## Setup
- Add `yjs` dependency.
- Add to `config.ts`: STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, DRAG_THRESHOLD_PX, STICKY_COLORS, DEFAULT_STICKY_COLOR.
- Stub `board-model.ts` exports (`initDoc, createSticky, moveObject, bringToFront, setStickyColor, deleteObject, getStickyText, snapshot, LOCAL_ORIGIN`) throwing `not implemented`.

## Cases (each mutation also asserts the count of `update` events: 1 on success, 0 on rejection)
- TC-01 create on empty doc: 1 object, type sticky, colour DEFAULT_STICKY_COLOR, empty text, z 1; creation centred (x,y = point − STICKY_SIZE_WORLD/2).
- TC-02 create with existing z 1,2 → new z 3.
- TC-03 moveObject → x,y updated, other fields unchanged.
- TC-04 moveObject stale id → false, 0 updates (negative).
- TC-05 setStickyColor green → applied.
- TC-06 setStickyColor 'teal' → false, unchanged, 0 updates (negative).
- TC-07 deleteObject → removed.
- TC-08 deleteObject stale id → false, 0 updates (negative).
- TC-09 bringToFront z1 of 3 → z 4.
- TC-10 bringToFront on topmost → no update (negative).
- TC-11 equal z → snapshot sorted by id tie-break, stable.
- TC-12 unknown object type in doc → skipped by snapshot, no throw.
- Extra: non-finite coordinates rejected with 0 updates; `initDoc` sets `meta.schemaVersion` once.

## Done when
Suite compiles and fails only on "not implemented"; committed.

### 2. Implement Yjs board model and useBoardDoc snapshot hook

## Goal
Implement board.model so task 2.1 passes, and expose it to React.

## Approach
- Schema: `meta: Y.Map {schemaVersion: 1}`; `objects: Y.Map<id, Y.Map>` with `type, x, y, color, text: Y.Text, z, createdAt`.
- Ids via `crypto.randomUUID()`.
- Every successful mutation is one `doc.transact(fn, LOCAL_ORIGIN)`; rejections (stale id, unknown colour, non-finite numbers, bringToFront on topmost) return false before opening a transaction.
- `createSticky` places top-left at point − STICKY_SIZE_WORLD/2, z = maxZ + 1.
- `snapshot` returns immutable `StickySnapshot[]` sorted by `(z, id)`, skipping unknown `type`.
- Framework-free module (the Durable Object imports it in story 4).
- `useBoardDoc()` creates one `Y.Doc`, calls `initDoc`, subscribes `objects.observeDeep`, memoises `snapshot` and exposes it with `useSyncExternalStore` (story 3 adds the provider).

## Done when
All board-model unit tests pass; typecheck passes.

### 3. Write sticky text logic unit tests first (TC-13 to TC-17)

## Goal
Test-first unit coverage for the pure parts of sticky.text: `clampToLimit`, `applyTextDiff`, `counterVisible`.

## Cases
- TC-13 `applyTextDiff` 'abc' → 'abXc' produces a single insert of 'X' at index 2 (observe Y.Text delta events; must NOT be delete-all + insert-all, which would break concurrent typing in story 3). Also: pure deletion in middle, replacement of a selection, emoji surrogate pairs kept intact.
- TC-14 paste of 1,200 chars into empty → 1,000 (STICKY_TEXT_MAX_CHARS) kept.
- TC-15 999 + 1 → 1,000 accepted (boundary).
- TC-16 1,000 + 1 → rejected, still 1,000 (negative/boundary).
- TC-17 `counterVisible` at 949 / 950 / 951 chars → false / true / true (STICKY_COUNTER_THRESHOLD_CHARS boundary).
Use realistic English text fixtures, not repeated single characters.

## Done when
Suite compiles against stub exports and fails with "not implemented"; committed.

### 4. Implement sticky text editing: start/end editing, minimal Y.Text diff, length limit, auto-fit font

## Goal
Implement sticky.text per its contract.

## Approach
- `clampToLimit(next, max = STICKY_TEXT_MAX_CHARS)`; `counterVisible(len)` = remaining ≤ STICKY_COUNTER_THRESHOLD_CHARS.
- `applyTextDiff(ytext, next, origin)`: common prefix + common suffix, one delete and/or one insert inside one transaction; surrogate-pair safe.
- `StickyTextEditor`: textarea with the note's font size and padding; on mount set value from Y.Text, `focus()`, caret at end (`setSelectionRange(len,len)`) — covers edit start. On `input` (skipped while composing; handled on `compositionend`): clamp, restore caret if truncated, `applyTextDiff`. Escape → `preventDefault`, `onEnd('selected')`. Outside pointerdown → `onEnd('unselected')`. Because every input is already written, ending editing performs no extra write; blur flushes any pending value defensively. Enter inserts a newline. Shows `n/1000` counter when `counterVisible`.
- `fitFontSize(el, box)`: binary search integer px in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] with `scrollHeight <= box`; returns overflow flag; run on text change and mount only (zoom scales uniformly).
- Display mode: `white-space: pre-wrap`, bottom fade class when overflow.

## Done when
Task 2.3 unit tests pass; manual check: long text shrinks then fades; IME input (e.g. macOS Japanese input) does not duplicate characters.

### 5. Implement sticky note interaction: select, drag to move, double-click create, keyboard delete

## Goal
Implement sticky.interaction per its contract and the per-note interaction state diagram (Unselected, Pressed, Selected, Dragging, Editing).

## Approach
- `useSelection`: local `selectedId`, `editingId` (never written to the Y.Doc).
- `StickyNote`: absolutely positioned `div[role=group][aria-label="Sticky note"]` in the world layer at (x,y), size STICKY_SIZE_WORLD, colour from STICKY_COLORS, `data-selected`, blue outline when selected; `tabIndex=0`.
  - pointerdown: `stopPropagation` (board must not pan), pointer capture, Pressed.
  - move < DRAG_THRESHOLD_PX stays Pressed; ≥ threshold → `bringToFront` once, then rAF-throttled `moveObject` with delta divided by camera zoom.
  - pointerup → Selected; pointercancel/lostpointercapture → Selected at last position.
  - dblclick → `stopPropagation`, start editing.
  - If the note disappears from the snapshot mid-drag/edit (stale id), end interaction silently.
- `BoardViewport`: `dblclick` on empty space → `createSticky` at `screenToWorld(point)`, select + edit; empty-space click without drag → clear selection.
- `App.tsx` window keydown: Enter on selected (not editing, focus not in input) → edit; Delete/Backspace on selected and not editing → `deleteObject`; ignored while editing.

## Done when
Manual check at 50%/100%/200% zoom: drag keeps grabbed point under pointer, board never pans on note drag, Backspace while typing edits text; tasks 2.7 and 2.8 pass.

### 6. Implement toolbars: Sticky note button, colour swatches and delete button

## Goal
Implement sticky.toolbar per its contract.

## Approach
- `Toolbar` (fixed left): `button[aria-label="Sticky note"]` with tooltip "Sticky note – or double-click the board". `onCreateSticky` computes the world centre of the viewport via `screenToWorld`, calls `createSticky`, then selects and starts editing the new id (works when panned far away).
- `NoteToolbar`: rendered in screen space above the selected note (not scaled by zoom), hidden while Dragging or Editing; six `button[aria-label="<Colour> colour"][aria-pressed]` swatches from STICKY_COLORS → `setStickyColor` keeping selection; `button[aria-label="Delete note"]` → `deleteObject` and clear selection.
- Both toolbars stop pointer propagation so clicks never reach the viewport (which would clear selection).

## Done when
Colour change keeps text/position/selection; bin deletes; button creates centred note in edit mode; tasks 2.7 and 2.8 pass.

### 7. Component tests for sticky interaction, text editor and toolbars

## Goal
jsdom component tests with a real `Y.Doc` covering story 2 ui-component cases.

## sticky.interaction (`StickyNote.test.tsx`)
- TC-18 press+release without move → Selected, outline and NoteToolbar shown.
- TC-19 move 2px (< DRAG_THRESHOLD_PX) → still Selected, no moveObject (boundary).
- TC-20 move 3px (= threshold) → Dragging; board camera unchanged (negative: no pan).
- TC-21 pointercancel during drag → Selected at last position.
- TC-22 click empty board → Unselected, toolbar gone.
- TC-25 Delete and Backspace (separate runs) on selected → removed.
- TC-35 dblclick on existing note → no new note, edits existing (negative).
- TC-36 Enter with nothing selected → nothing happens (negative).
- TC-37 note deleted via model while Dragging and while Editing → interaction ends, no exception, note not recreated (error path).

## sticky.text (`StickyTextEditor.test.tsx`)
- TC-23 Enter on selected → Editing, textarea focused, caret at end.
- TC-24 Escape → Selected, text preserved.
- TC-26 Backspace while editing 'ab' → note present, text 'a' (negative).
- TC-38 type 'abc' then click outside → editor unmounted, Y.Text 'abc', Unselected.

## sticky.toolbar (`Toolbars.test.tsx`)
- TC-27 Pink swatch → model colour pink, selection kept.
- TC-28 Sticky note button → one note centred on viewport centre, Editing.
- TC-29 bin button → note removed, selection cleared.

## Done when
All pass in `npm run test:component`.

### 8. E2E sticky note workflows (create, move at zoom, recolour, delete, long text)

## Goal
Playwright tests for story 2 e2e cases in all three browsers.

## Cases
- Workflow "Brainstorm golden path": TC-30 real dblclick at (400,300) then type "Hello" → note centred at (400,300) ±1px with text; TC-31 at 50% zoom drag by (100,50) → grabbed point stays under pointer ±1px, world position +200,+100; recolour via swatch; delete via Delete key → board has expected remaining notes.
- TC-32 at 200% zoom drag (100,50) → world +50,+25 and dragged note drawn above an overlapped note (stacking).
- TC-33 long text: type one word → computed font-size = STICKY_FONT_MAX_PX; paste 1,000-char prose fixture → font-size ≥ STICKY_FONT_MIN_PX, overflow fade class present, nothing rendered outside the note box.
- TC-34 pan far away (test hook), click Sticky note → note visible at screen centre.

## Fixtures
`tests/fixtures/texts.ts`: short phrase, 3-line retro item, 1,000-char English paragraph.

## Done when
All cases pass in chromium, firefox, webkit.


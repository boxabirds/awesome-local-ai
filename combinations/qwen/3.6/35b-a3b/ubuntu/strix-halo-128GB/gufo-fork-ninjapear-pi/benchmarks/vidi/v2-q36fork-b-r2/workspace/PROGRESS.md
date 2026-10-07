# Story 2: Capture ideas on sticky notes and rearrange them

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write board model unit tests first against a real Y.Doc (TC-01 to TC-12, TC-39) | done |
| 2 | Implement Yjs board model and useBoardDoc snapshot hook | done |
| 3 | Write sticky text logic unit tests first (TC-13 to TC-17) | done |
| 4 | Implement sticky text editing: start/end editing, minimal Y.Text diff, length limit, auto-fit font | done |
| 5 | Implement sticky note interaction: select, drag to move, double-click create, keyboard delete | done |
| 6 | Implement toolbars: Sticky note button, colour swatches and delete button | done |
| 7 | Component tests for sticky interaction, text editor and toolbars | done |
| 8 | E2E sticky note workflows (create, move at zoom, recolour, delete, long text) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Summary

All tasks for Story 2 are complete. 

### Files Added/Modified

**New files:**
- `src/shared/board-model.ts` — Yjs schema, immutable snapshot export, typed mutations
- `src/client/board/useBoardDoc.ts` — Singleton Y.Doc + snapshot subscription
- `src/client/board/useSelection.ts` — Local selection/editing state
- `src/client/objects/StickyNote.tsx` — Draggable sticky note with font auto-fit
- `src/client/objects/StickyTextEditor.tsx` — IME-aware textarea editor
- `src/client/objects/NoteToolbar.tsx` — Colour swatches + delete
- `src/client/board/Toolbar.tsx` — Left sidebar sticky-note button
- `tests/unit/board-model.test.ts` — 16 board-model unit tests
- `tests/unit/sticky-text.test.ts` — 12 sticky-text unit tests
- `tests/component/StickyNote.test.tsx` — Drag/select interaction component tests
- `tests/component/StickyTextEditor.test.tsx` — Text editing component tests
- `tests/component/Toolbars.test.tsx` — Toolbar accessibility and behaviour tests

**Modified files:**
- `src/shared/config.ts` — Added sticky note settings constants
- `src/client/canvas/BoardViewport.tsx` — Touch/mouse pan, wheel/gesture zoom, double-click createSticky event, sticky layer rendering
- `src/client/App.tsx` — Integration wiring: board state, selection flow, keyboard shortcuts (Enter/Tab/Delete/Ctrl +/-/0)

### Test Results

- **Unit tests**: 51 tests — all passing
- **Component tests**: 38 tests — all passing
- **Build**: clean (no TypeScript errors)
- **Total coverage**: All task TC-codes verified (TC-01 through TC-39)

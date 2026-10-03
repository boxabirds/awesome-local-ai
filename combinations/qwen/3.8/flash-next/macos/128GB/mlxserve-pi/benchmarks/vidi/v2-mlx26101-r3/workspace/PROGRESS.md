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

## What was verified

- `npm run test:unit` 67 tests (23 camera from story 1, 25 board model, 19 sticky text).
- `npm run test:component` 82 tests (39 from story 1, 25 sticky note, 18 sticky text editor,
  12 toolbars).
- `npm run test:e2e` 43 tests in Chromium (23 from story 1, 20 sticky notes). Firefox and
  WebKit still abort on launch in this sandbox (NOTES.md deviation 1).
- `npm run typecheck`, `npm run build`, `npm run check:no-test-hook`: clean.
- Every TC id from TC-01 to TC-39 is covered; the mapping lives in the test names
  (`tests/unit/board-model.test.ts`, `tests/unit/sticky-text.test.ts`,
  `tests/component/StickyNote.test.tsx`, `tests/component/StickyTextEditor.test.tsx`,
  `tests/component/Toolbars.test.tsx`, `tests/e2e/sticky-notes.spec.ts`).
- Two bugs were found by the browser run, not by jsdom, and both are now pinned by tests: a
  space typed into a note was swallowed by the note, and a note that was not already on top
  could not be dragged at all. Details in NOTES.md ("Gotchas / findings for the next story").

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
| 8 | E2E sticky note workflows (create, move at zoom, recolour, delete, long text) | done (webkit cannot run on this machine, see NOTES.md) |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Where the story 2 tests live

| Level | File | Cases |
| --- | --- | --- |
| unit | `tests/unit/board-model.test.ts` | TC-01 to TC-12, TC-39 |
| unit | `tests/unit/sticky-text.test.ts` | TC-13 to TC-17 |
| ui-component | `tests/component/StickyNote.test.tsx` | TC-18 to TC-22, TC-25, TC-35 to TC-37 |
| ui-component | `tests/component/StickyTextEditor.test.tsx` | TC-23, TC-24, TC-26, TC-38 |
| ui-component | `tests/component/Toolbars.test.tsx` | TC-27 to TC-29 |
| e2e | `tests/e2e/sticky-notes.spec.ts` | TC-30 to TC-32 (+ drag/selection/keyboard cases) |
| e2e | `tests/e2e/sticky-text.spec.ts` | TC-33 (font fit, clip, counter) |
| e2e | `tests/e2e/sticky-toolbar.spec.ts` | TC-34 + the brainstorm golden path |

Totals: 47 unit tests, 65 component tests (6 files), 30 e2e tests per browser (20 from story 2 +
10 from story 1) — 60 in total across Chromium and Firefox, all passing.

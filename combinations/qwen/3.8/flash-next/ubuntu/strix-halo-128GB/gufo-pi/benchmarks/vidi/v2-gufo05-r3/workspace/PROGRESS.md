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

## Verification (all commands run from the repo root)

- `npm run build` ✓ · `npm run typecheck` ✓
- `npm run test:unit` ✓ — 67 tests (story 2: board-model 31, sticky-text 22; story 1: camera 14)
- `npm run test:component` ✓ — 62 tests (story 2: StickyNote 14, StickyTextEditor 14, Toolbars 12, StickyNoteRemote 5; story 1: 17)
- `npm run test:e2e` ✓ — 27 tests in Chromium (story 1 regression 7, story 2 20)
- Story 1 behaviour re-verified unchanged: `tests/e2e/navigation.spec.ts` and the story 1
  component tests still pass.

## Notes / deviations

Recorded in `NOTES.md` under "Story 2". The one deliberate gap: the two-tab
`sticky.two_users` e2e case cannot run because story 3 has not shipped a sync
provider, so collaborative requirements (cross-tab updates, remote delete of the note
being edited, concurrent typing with a caret that stays put) are verified with two real
Y.Doc replicas at model level (`tests/unit/board-model.test.ts` TC-19–TC-23, TC-40) and
with a real peer document at component level
(`tests/component/StickyNoteRemote.test.tsx`).

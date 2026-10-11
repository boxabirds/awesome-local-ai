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

## Verification

- `npm run build` — clean. `npm run typecheck` (`tsc --noEmit`) — clean.
- `npm run test:unit` — 60 passed in 3 files (`tests/unit/board-model.test.ts`,
  `tests/unit/sticky-text.test.ts`, story 1's `camera.test.ts`).
- `npm run test:component` — 65 passed in 6 files (`StickyNote`, `StickyTextEditor`,
  `Toolbars`, plus story 1's three).
- `npm run test:e2e` — 68 passed (18 story 1 + 50 story 2 = 25 tests × Chromium, Firefox, WebKit).
- `tests/e2e/sticky-notes.spec.ts` covers TC-30 to TC-34, TC-39, TC-40 and the golden-path workflow.

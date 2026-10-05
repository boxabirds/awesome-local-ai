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

## Verification (story 2 complete)

Commands run from a clean tree (no wrangler left listening on 27840, so Playwright rebuilds `dist-test` through `serve:e2e`):

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run build` | client + worker bundles built |
| `npm run test:unit` | 57 passed (board model TC-01 to TC-12, TC-39; sticky text TC-13 to TC-17) |
| `npm run test:component` | 67 passed (story 1 viewport tests plus story 2 TC-18 to TC-29, TC-35 to TC-38) |
| `npm run test:e2e` | 36 passed on Chromium and Firefox (story 1's 20 plus story 2's TC-30 to TC-34 and the three e2e workflows) |

Task commits: `story 2 task 1` … `story 2 task 8` (see `git log`), one per finished task, each with the suites green.

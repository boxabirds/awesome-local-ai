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

## Test totals (all green)

| Suite | Command | Files | Tests |
|---|---|---|---|
| Unit | `npm run test:unit` | 3 | 70 |
| UI component | `npm run test:component` | 6 | 67 |
| E2E | `npm run test:e2e` | 2 specs × chromium + firefox | 74 |

`npm run typecheck` passes. Every TC from `design.md` (TC-01 … TC-39) is covered by at
least one test; the mapping is in the test file headers and test titles.

## Ports

| Purpose | Port |
|---|---|
| `npm run dev` (vite dev server) | 27072 |
| `npm run serve:e2e` (`wrangler dev`, e2e target) | 27073 |
| wrangler inspector (`--inspector-port`) | 27074 |
| `npx wrangler dev` preview/inspection | 27075 (`wrangler.jsonc` `dev.port`) |

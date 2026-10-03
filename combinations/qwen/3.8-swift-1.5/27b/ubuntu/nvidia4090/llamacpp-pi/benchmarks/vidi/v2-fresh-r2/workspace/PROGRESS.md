# Story 10: Draw shapes and connect them with arrows that follow when moved

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 7 | Write shape model unit tests first (TC-01 to TC-06) | done |
| 8 | Implement shape model: create by drag/click/Shift, style validation, label Y.Text | done |
| 9 | Write connector model and geometry unit tests first (TC-07 to TC-14, TC-29) | done |
| 10 | Implement connector model, geometry and detach-on-delete in board-model | done |
| 11 | Implement active tool hook with shortcuts and return-to-Select | done |
| 12 | Implement Shape tool, ShapeObject with centred label, and ShapeToolbar | done |
| 13 | Implement Connector tool with hover dots, ConnectorObject with arrowhead and re-attach handles | done |
| 14 | Component tests for shape tool/object/toolbar, connector tool/object and active tool (TC-15 to TC-22, TC-28) | done |
| 15 | E2E: draw a flow, collaborative rearrange, delete race (TC-23 to TC-27) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Completion

All tasks 7–15 done. Validation: `npm run typecheck` clean; `npm run build` OK;
168/168 unit + 103/103 component tests pass; all 10 story-10 e2e tests pass on
chromium and firefox. Remaining full-suite e2e failures are pre-existing flaky
stories 3/8 tests (verified against the pre-story-10 commit; see NOTES.md).

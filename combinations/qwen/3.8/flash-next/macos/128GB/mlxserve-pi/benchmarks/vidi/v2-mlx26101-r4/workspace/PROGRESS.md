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

Where the work ended up, and why: `NOTES.md`, section "Story 10".

- 308 unit (67 new), 258 component (49 new), 66 integration (untouched), 158 e2e passing in Chromium and
  WebKit (7 new). `npm run typecheck` and `npm run build` are clean.
- TC-19 (`@persist`) still fails on this machine at the same place it failed before this story was started —
  a spawned runtime this sandbox will not let anyone stop — and TC-20 and TC-21 sit behind it. Checked by
  stashing the whole story and running it against the clean tree. Firefox still does not start here.

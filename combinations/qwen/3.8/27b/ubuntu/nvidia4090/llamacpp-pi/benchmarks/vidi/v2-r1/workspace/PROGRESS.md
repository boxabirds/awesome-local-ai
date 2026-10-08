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

## Notes
- Shape/connector tools use window-capture pointer listeners and mount/unmount
  from BoardPage on tool change; unmount drops an unfinished drag (no create).
- Connector selection uses a zoom-aware hit test: the registry `hitTest`
  signature gained a third `zoom` argument (screen-pixel tolerances). Existing
  sticky/text specs are 2-arg (compatible).
- `ObjectSnapshot` gained `kind/fill/stroke/label` (shapes) and
  `from/to/fromPoint/toPoint` (connectors); the connector bbox and endpoint
  points are derived in `objectsSnapshot`'s second pass from the current rects.
- `useSelection` gained a `selectOnly` action (no presence check) so a
  tool-created object is the only selection in the same tick it enters the doc.
- `newObjectId()` and `objectRectsMap()` are exported from board-model.
- The story 9 `useTool` hook is replaced by `tools/useActiveTool` (V/T/N and
  the new S/L shortcuts; Escape from shape/connector returns to Select).
- E2E (`playwright.shapes.config.ts`, script `test:e2e:shapes`): chromium +
  firefox, one worker, no parallelism, 240 s timeout, no shared webServer (each
  test starts its own wrangler on `WRANGLER_PORT`). The main config's
  `testIgnore` now also excludes `shapes.spec.ts` and `connectors.spec.ts`.
  TC-23 runs in chromium + firefox; TC-24 and the collaborative connector tests
  (TC-25 to TC-27) are chromium-only. WebKit is unavailable on this host (no
  `libavif13`, no root) — see NOTES.md.
- **Re-attach drag uses live refs (TC-27).** The handle-drag window listeners
  are registered once on pointerdown, but a remote delete can land mid-drag. If
  `finish` read the pointerdown-time snapshot it would re-attach to an already
  deleted object. `ConnectorObject` now keeps `latestSnapshot/Camera/Rects/Obj`
  refs (updated every render) and reads them at release, so a deleted target
  resolves to `objectAtPoint -> null` and the end detaches to a free point.
- **Seeding + camera pinning in e2e.** Boards are seeded through the in-page
  `__vidi6` hooks (`seedCheckoutFlow`), which run the real model functions. The
  hooks are only present in test-mode builds; `openBoard` now waits for
  `window.__vidi6` so `page.evaluate` never races the install. The camera is
  local per client, so every test that drives the pointer pins it to the
  origin (world == screen) before acting.

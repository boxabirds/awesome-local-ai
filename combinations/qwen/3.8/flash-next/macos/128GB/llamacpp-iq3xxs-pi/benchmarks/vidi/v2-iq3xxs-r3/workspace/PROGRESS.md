# Story 9: Write free text anywhere on the board

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write text model unit tests first (TC-01 to TC-06) | done |
| 2 | Implement text object model and shared text-edit helpers | done |
| 3 | Write text layout unit tests first with a fake measurer (TC-07 to TC-11, TC-32) | done |
| 4 | Implement text layout and local-only box sync | done |
| 5 | Component tests: box sync writes only after local changes (TC-12, TC-13) | done |
| 6 | Implement tool mode with Select and Text tools and V/T/N/Escape shortcuts | done |
| 7 | Component tests for tool mode and Text tool (TC-14 to TC-18) | done |
| 8 | Implement TextObject, generalised TextEditor, TextToolbar and horizontal-only handles | done |
| 9 | Component tests for text objects: editing, empty removal, sizes, handles, remote delete, undo (TC-19 to TC-25) | done |
| 10 | E2E text workflows: headings, long annotations, abandoned text, concurrent editing (TC-26 to TC-31) | todo |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Running notes

- Tasks 1-5: committed as `8a8fcb5`, `1456926`, `505f97e`. Gates at `505f97e`:
  typecheck clean, 418 tests (unit + component + integration), build clean.
- Tasks 6-7 (tool mode) are in the commit after `505f97e`. New files:
  `src/client/board/useTool.ts`, `src/client/sessionId.ts`,
  `tests/component/ToolMode.test.tsx`. Gates: typecheck clean, 433 tests
  (222 unit / 151 component / 60 integration), build clean.
- Behaviour decided while doing task 6, all of it visible in `ToolMode.test.tsx`:
  - A Text-tool press places the text at the point it *started* at, on release,
    and only if the press did not travel past `DRAG_THRESHOLD_PX` — the same rule
    that tells a pan from a click everywhere else on this board. A press that
    travelled, or one that was cancelled, writes nothing.
  - A placement also swallows the double-click that the same press produced
    (`.board-viewport` keeps the placed point): pressing T and double-clicking
    would otherwise drop a sticky note under the heading.
  - Objects are made transparent to the pointer while Text is held by
    `.board-world[data-tool="text"] * { pointer-events: none }`, which is how a
    heading gets placed on top of the notes it belongs to, without the viewport
    knowing anything about object types.
  - `useBoardKeys` still returns early while an object is being typed into, so
    Escape/V/T/N do nothing during an edit. Escape returning the tool to Select
    therefore only applies when nothing is being typed in — story 2's rule won.
  - `useTool(canEdit)` refuses `setTool('text')` where writing does not work, and
    pulls the tool back to Select when `canEdit` goes false, so a read-only board
    never leaves a writing tool open.
  - `createdBy` on a text made by the tool comes from `sessionId()`: one random id
    per tab, no story 6 identity, no `useIdentity` anywhere.
- Tasks 8-9 (the object itself) are in the commit after the tool-mode one. New
  files: `src/client/objects/TextEditor.tsx`, `TextObject.tsx`, `TextToolbar.tsx`,
  `icons.tsx`, `tests/component/TextObject.test.tsx`. `StickyTextEditor` is now a
  thin wrapper over `TextEditor`, so story 2's editor behaviour is written once.
  Gates: typecheck clean, 443 tests (222 unit / 161 component / 60 integration),
  build clean.

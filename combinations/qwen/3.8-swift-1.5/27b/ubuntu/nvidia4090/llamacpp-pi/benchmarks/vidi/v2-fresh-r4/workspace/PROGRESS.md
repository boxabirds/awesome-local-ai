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
| 10 | E2E text workflows: headings, long annotations, abandoned text, concurrent editing (TC-26 to TC-31) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Done (commit dea5eb6)

- All 10 tasks complete. 161 unit tests, 94 component tests passing (13 pre-existing
  component failures unchanged: BoardViewport 8, NavigationHint 1, load-failure 4).
- E2E: all 6 text tests (TC-26 to TC-31) pass on chromium and firefox; full suite has
  only the 7 pre-existing failures (verified against the story-8 baseline). Webkit
  cannot launch on this machine (missing system libs) — the official runner skips it.
- TC-29 (concurrent typing) required a fix in TextEditor: the local buffer must sync
  from remote Y.Text updates synchronously (DOM value + caret), otherwise a stale
  buffer clobbers remote characters in the next applyTextDiff.

# Leave comments on board content for teammates

| Field | Value |
|-------|-------|
| ID | 16 |
| Status | proposed |
| Priority | 16 |
| Epic | boards-sharing |
| Created | 2026-09-17T08:07:43.865Z |
| Updated | 2026-09-17T08:07:43.865Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| comment.create_on_item | Comment on an object | comments.board_ui |
| comment.create_on_board | Comment on an empty spot | comments.board_ui |
| comment.post | Post a comment | comments.board_ui |
| comment.blank | Blank comments are not posted | comments.model |
| comment.length | Message length limit | comments.model |
| comment.reply | Reply to a thread | comments.board_ui |
| comment.follow_item | Comments follow their object | comments.model |
| comment.item_deleted | Attached object deleted | comments.board_ui |
| comment.resolve | Resolve a thread | comments.board_ui |
| comment.reopen | Reopen a thread | comments.board_ui |
| comment.panel | Comments panel lists threads | comments.panel_ui |
| comment.navigate | Jump to a thread | comments.panel_ui |
| comment.edit_own | Edit my own message | comments.model |
| comment.delete_own | Delete my own message | comments.model |
| comment.not_others | Others' messages are protected in the interface | comments.board_ui |
| comment.author_name | Names as written | comments.model |
| comment.persist | Comments are kept with the board | comments.sync_persist |
| comment.undo | Undo my comment actions | comments.undo |
| comment.marker_size | Markers stay readable at any zoom | comments.board_ui |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| comments.model | #2 (proposed) | #1 unit (proposed) | unit | unit |
| comments.sync_persist | #6 (proposed) | #7 integration (proposed) | integration | integration |
| comments.undo | #9 (proposed) | #8 unit (proposed), #11 ui-component (proposed) | unit, ui-component | unit, ui-component |
| comments.board_ui | #3 (proposed) | #4 ui-component (proposed), #5 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| comments.panel_ui | #10 (proposed) | #11 ui-component (proposed), #12 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


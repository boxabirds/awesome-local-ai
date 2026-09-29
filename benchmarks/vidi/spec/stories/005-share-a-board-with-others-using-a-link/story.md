# Share a board with others using a link

| Field | Value |
|-------|-------|
| ID | 5 |
| Status | proposed |
| Priority | 5 |
| Epic | boards-sharing |
| Created | 2026-09-17T08:07:25.609Z |
| Updated | 2026-09-17T08:07:52.898Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| share.create | Create a board | share.board_api, share.pages |
| share.open_link | Open a shared link | share.board_api, share.pages |
| share.copy | Copy the link | share.share_panel |
| share.copy_fallback | Manual copy when clipboard is blocked | share.share_panel |
| share.unguessable | Links cannot be guessed | share.board_api |
| share.not_found | Board not found | share.board_api, share.pages |
| share.create_failure | Creation failure is explained | share.pages |
| share.unreachable | Service unreachable while opening a link | share.pages |
| share.legacy_boards | Existing boards keep working | share.board_api |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| share.board_api | #2 (proposed) | #1 unit (proposed), #3 integration (proposed), #7 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| share.pages | #4 (proposed) | #6 ui-component (proposed), #7 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| share.share_panel | #5 (proposed) | #6 ui-component (proposed), #7 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


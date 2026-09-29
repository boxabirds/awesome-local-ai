# See who else is on the board and where their cursors are

| Field | Value |
|-------|-------|
| ID | 6 |
| Status | proposed |
| Priority | 6 |
| Epic | realtime-collab |
| Created | 2026-09-17T08:07:27.355Z |
| Updated | 2026-09-17T08:07:27.355Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| presence.avatars | See who is present | presence.ui |
| presence.join | Newcomers see everyone quickly | presence.room_tracking |
| presence.cursors | Live cursors at the right board location | presence.awareness_client |
| presence.cursor_hide | Cursor hidden when pointer leaves | presence.awareness_client |
| presence.selection | Other people's selections are visible | presence.ui |
| presence.names | Friendly, remembered, renamable names | presence.identity |
| presence.name_validation | Invalid names are rejected | presence.identity |
| presence.colors | Distinct colours up to capacity | presence.colors |
| presence.overflow | Avatar overflow | presence.ui |
| presence.leave | People who leave disappear | presence.room_tracking |
| presence.dedupe | One avatar per person | presence.awareness_client |
| presence.self | Own presence not drawn as remote | presence.awareness_client |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| presence.room_tracking | #8 (proposed) | #5 integration (proposed), #7 unit (proposed) | unit, integration | integration, unit |
| presence.identity | #10 (proposed) | #9 unit (proposed), #15 ui-component (proposed), #16 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| presence.colors | #11 (proposed) | #9 unit (proposed) | unit | unit |
| presence.awareness_client | #13 (proposed) | #12 unit (proposed), #16 e2e (proposed) | unit, e2e | unit, e2e |
| presence.ui | #14 (proposed) | #15 ui-component (proposed), #16 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


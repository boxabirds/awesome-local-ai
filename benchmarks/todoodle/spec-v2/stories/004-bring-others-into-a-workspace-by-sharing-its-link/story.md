# Bring others into a workspace by sharing its link

| Field | Value |
|-------|-------|
| ID | 4 |
| Status | proposed |
| Priority | 4 |
| Epic | workspaces |
| Created | 2026-09-25T18:29:17.936Z |
| Updated | 2026-09-25T18:29:17.936Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| prd.share_panel | Share action explains consequences | share.panel |
| prd.join_via_link | Opening a shared link joins instantly | share.join |
| prd.live_updates | Others' changes appear without reload | live.broadcast, live.room, live.client_sync, live.connection_status |
| prd.announce_remote | Screen-reader users hear about others' changes | live.client_sync |
| prd.conflict_notice | Concurrent edits are never silently lost | live.conflict_notice |
| prd.conflict_choice | User chooses whose version to keep | live.conflict_notice |
| prd.offline_indicator | Offline is visible and edits are held back | live.connection_status |
| prd.live_paused | Interrupted live updates don't stop work | live.connection_status |
| prd.live_access | Only link holders receive live changes | live.room |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| share.panel | #4 (proposed) | #10 integration (proposed), #11 ui-component (proposed), #12 e2e (proposed) | integration, ui-component, e2e | integration, ui-component, e2e |
| share.join | #5 (proposed) | #10 integration (proposed), #12 e2e (proposed) | integration, e2e | integration, e2e |
| live.broadcast | #1 (proposed), #3 (proposed) | #9 unit (proposed), #10 integration (proposed) | unit, integration | unit, integration |
| live.room | #2 (proposed) | #9 unit (proposed), #10 integration (proposed) | unit, integration | unit, integration |
| live.client_sync | #6 (proposed) | #9 unit (proposed), #11 ui-component (proposed), #12 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| live.connection_status | #7 (proposed) | #9 unit (proposed), #11 ui-component (proposed), #12 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| live.conflict_notice | #8 (proposed) | #9 unit (proposed), #11 ui-component (proposed), #12 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |

### Gaps

No gaps found.


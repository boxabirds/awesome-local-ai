# Keep working through a dropped connection without losing edits

| Field | Value |
|-------|-------|
| ID | 13 |
| Status | proposed |
| Priority | 13 |
| Epic | realtime-collab |
| Created | 2026-09-17T08:07:39.207Z |
| Updated | 2026-09-17T08:07:39.207Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| offline.survive_reload | Offline changes survive reload, closure and restart | offline.app_shell, offline.local_store |
| offline.sync_after_reopen | Offline changes reach others after reconnection | offline.sync_ack, offline.board_open |
| offline.open_offline | Open previously used boards offline | offline.app_shell, offline.local_store |
| offline.no_copy_offline | No empty board without a device copy | offline.app_shell, offline.board_open |
| offline.status_offline | Offline status | offline.status_ui |
| offline.status_syncing | Syncing status until confirmed | offline.sync_ack, offline.status_ui |
| offline.storage_unavailable | Warning when the device cannot store changes | offline.local_store, offline.status_ui |
| offline.leave_guard | Close protection when changes are at risk | offline.sync_ack, offline.status_ui |
| offline.cache_limit | Bounded device copies | offline.cache_manager |
| offline.orphaned_copy | Orphaned copies are read-only and never re-uploaded | offline.board_open |
| offline.discard | Discard confirmation for unsynced copies | offline.local_store, offline.board_open |
| offline.merge | Offline work from several people and tabs merges | offline.local_store, offline.sync_ack |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| offline.app_shell | #2 (proposed) | #1 unit (proposed), #13 e2e (proposed) | unit, e2e | unit, e2e |
| offline.local_store | #4 (proposed) | #3 unit (proposed), #6 integration (proposed), #13 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| offline.cache_manager | #5 (proposed) | #3 unit (proposed), #6 integration (proposed) | unit, integration | unit, integration |
| offline.sync_ack | #8 (proposed) | #7 unit (proposed), #9 integration (proposed) | unit, integration | unit, integration |
| offline.board_open | #10 (proposed) | #12 ui-component (proposed), #13 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| offline.status_ui | #11 (proposed) | #12 ui-component (proposed), #13 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


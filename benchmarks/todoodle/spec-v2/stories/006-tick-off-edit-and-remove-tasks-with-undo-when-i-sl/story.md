# Tick off, edit, and remove tasks — with undo when I slip

| Field | Value |
|-------|-------|
| ID | 6 |
| Status | proposed |
| Priority | 6 |
| Epic | tasks |
| Created | 2026-09-25T18:29:22.873Z |
| Updated | 2026-09-25T18:29:22.873Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| prd.complete | Complete a task | tasks.complete |
| prd.complete_feedback | Completion is visibly acknowledged | tasks.complete, ui.task_actions |
| prd.counts_follow | Counts follow task changes at once | tasks.complete, tasks.reopen, tasks.delete, tasks.restore |
| prd.reopen | Reopen a completed task | tasks.reopen |
| prd.show_completed | View completed tasks | tasks.list_completed, ui.task_actions |
| prd.remember_show_completed | Show-completed choice is remembered | tasks.list_completed |
| prd.edit | Edit task name and description | tasks.edit, ui.task_detail |
| prd.edit_blank_name | Name cannot be blanked | tasks.edit, ui.task_detail |
| prd.delete | Delete immediately, with Undo instead of confirmation | tasks.delete |
| prd.undo | Undo completion and deletion | tasks.reopen, tasks.restore, ui.undo |
| prd.undo_pause | Undo waits while the user is attending to it | ui.undo |
| prd.undo_shortcut | Undo from the keyboard | ui.undo |
| prd.retain_deleted | Deleted data is retained internally | tasks.delete |
| prd.failed_action_rollback | Failed actions return the task to its prior state | tasks.complete, tasks.reopen, tasks.edit, tasks.delete, tasks.restore |
| prd.keyboard_actions | Task actions work from the keyboard | ui.task_actions, ui.task_detail |
| prd.focus_after_action | Focus lands on the next task after an action | ui.focus_management |
| prd.focus_return | Closing the detail panel returns focus | ui.task_detail, ui.focus_management |
| prd.mobile_detail | Task detail and actions work on small touch screens | ui.task_actions, ui.task_detail |
| prd.action_announcements | Outcomes are announced to assistive technology | tasks.complete, ui.undo, ui.task_actions |
| prd.offline_task_actions | Offline: read-only detail, no task changes | tasks.list_completed, ui.undo, ui.task_actions, ui.task_detail |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| tasks.complete | #1 (proposed), #2 (proposed), #4 (proposed) | #8 unit (proposed), #9 integration (proposed), #12 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| tasks.reopen | #1 (proposed), #2 (proposed), #4 (proposed) | #8 unit (proposed), #9 integration (proposed), #12 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| tasks.list_completed | #1 (proposed), #3 (proposed), #4 (proposed) | #8 unit (proposed), #10 integration (proposed), #12 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| tasks.edit | #1 (proposed), #3 (proposed), #4 (proposed) | #8 unit (proposed), #10 integration (proposed), #12 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| tasks.delete | #2 (proposed), #4 (proposed) | #8 unit (proposed), #9 integration (proposed), #12 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| tasks.restore | #2 (proposed), #4 (proposed) | #8 unit (proposed), #9 integration (proposed), #12 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| ui.undo | #5 (proposed) | #8 unit (proposed), #11 ui-component (proposed), #12 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| ui.task_actions | #6 (proposed) | #8 unit (proposed), #11 ui-component (proposed), #12 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| ui.task_detail | #7 (proposed) | #11 ui-component (proposed), #12 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| ui.focus_management | #13 (proposed) | #8 unit (proposed), #11 ui-component (proposed), #12 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |

### Gaps

No gaps found.


# Capture a task into my Inbox in seconds

| Field | Value |
|-------|-------|
| ID | 5 |
| Status | proposed |
| Priority | 5 |
| Epic | tasks |
| Created | 2026-09-25T18:29:20.536Z |
| Updated | 2026-09-25T18:29:20.536Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| prd.inbox_exists | Every workspace has an Inbox | tasks.store, tasks.list_api, shell.sidebar, tasks.list_view |
| prd.quick_add | Quick add saves a task | tasks.create_api, tasks.quick_add, tasks.client_cache |
| prd.quick_add_shortcut | Keyboard shortcut opens quick add | shell.shortcuts, tasks.quick_add |
| prd.reject_blank | Blank tasks are rejected | tasks.create_api, tasks.quick_add |
| prd.failed_save_recovery | Failed saves never lose text | tasks.client_cache |
| prd.task_order | New tasks go to the end | tasks.store, tasks.create_api, tasks.list_api, tasks.test_seed, tasks.list_view |
| prd.length_limits | Over-long tasks are never saved | tasks.create_api, tasks.quick_add |
| prd.retry_no_duplicate | Retrying never creates duplicates | tasks.store, tasks.create_api, tasks.client_cache |
| prd.no_automatic_retry | No automatic retry after a failure | tasks.client_cache |
| prd.offline_quick_add | Offline: keep typing, add later, discard still works | shell.shortcuts, tasks.quick_add, tasks.client_cache |
| prd.quick_add_stays_open | Quick add stays ready for the next task | tasks.quick_add |
| prd.quick_add_escape | Escape closes quick add | tasks.quick_add |
| prd.empty_inbox | Empty Inbox explains what to do | tasks.list_view |
| prd.color_scheme | Follows light or dark appearance | shell.mobile |
| prd.save_status_accessible | Saving status reaches screen readers | tasks.client_cache |
| prd.load_failure_retry | Failed load offers Try again | tasks.list_view |
| prd.loading_placeholder | Placeholder rows while loading | shell.sidebar, tasks.list_view |
| prd.touch_targets | Touch targets are fingertip-sized | shell.mobile |
| prd.mobile_add_button | Floating add button on phones | shell.mobile |
| prd.mobile_drawer | Sidebar becomes a drawer on phones | shell.mobile |
| prd.shortcut_help | ? lists all keyboard shortcuts | shell.shortcuts |
| prd.list_single_tab_stop | Task list is one tab stop | tasks.list_view |
| prd.list_keyboard_nav | Arrow keys move between tasks | tasks.test_seed, tasks.list_view |
| prd.list_cell_nav | Left and Right move within a task row | tasks.list_view |
| prd.list_screen_reader | Screen-reader users can navigate and operate the task list | tasks.list_view |
| prd.destination_chip | Quick add shows where the task will go | tasks.quick_add |
| prd.modifier_enter_submit | Command/Ctrl+Enter adds from anywhere in quick add | tasks.quick_add |
| prd.description_newline | Enter in description starts a new line | tasks.quick_add |
| prd.length_counter | Remaining characters shown near the limit | tasks.quick_add |
| prd.no_truncation | Typed text is never cut off | tasks.quick_add |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| tasks.store | #1 (proposed) | #8 unit (proposed), #9 integration (proposed) | unit, integration | unit, integration |
| tasks.create_api | #2 (proposed) | #8 unit (proposed), #9 integration (proposed), #14 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| tasks.list_api | #3 (proposed) | #8 unit (proposed), #10 integration (proposed), #14 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| tasks.test_seed | #19 (proposed) | #20 integration (proposed) | integration | integration |
| shell.sidebar | #4 (proposed) | #12 ui-component (proposed), #14 e2e (proposed), #18 ui-component (proposed) | ui-component, e2e | ui-component, e2e |
| shell.shortcuts | #15 (proposed) | #14 e2e (proposed), #17 unit (proposed), #18 ui-component (proposed) | e2e | e2e, unit, ui-component |
| shell.mobile | #16 (proposed) | #14 e2e (proposed), #17 unit (proposed), #18 ui-component (proposed) | e2e | e2e, unit, ui-component |
| tasks.list_view | #5 (proposed) | #12 ui-component (proposed), #14 e2e (proposed), #17 unit (proposed), #18 ui-component (proposed) | ui-component, e2e | ui-component, e2e, unit |
| tasks.quick_add | #6 (proposed) | #13 ui-component (proposed), #14 e2e (proposed), #17 unit (proposed) | unit, ui-component, e2e | ui-component, e2e, unit |
| tasks.client_cache | #7 (proposed) | #11 unit (proposed), #13 ui-component (proposed), #14 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |

### Gaps

No gaps found.


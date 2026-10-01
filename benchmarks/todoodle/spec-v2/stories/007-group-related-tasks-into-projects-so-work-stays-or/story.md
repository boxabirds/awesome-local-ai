# Group related tasks into projects so work stays organised

| Field | Value |
|-------|-------|
| ID | 7 |
| Status | proposed |
| Priority | 7 |
| Epic | tasks |
| Created | 2026-09-25T18:29:25.617Z |
| Updated | 2026-09-25T18:29:34.586Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| prd.create_project | Create project | projects.schema, projects.api_crud, projects.ui_sidebar |
| prd.view_project | View a project | tasks.project_scope_api, projects.ui_project_view |
| prd.move_task | Move tasks between lists | projects.schema, tasks.project_scope_api, tasks.ui_move_menu, tasks.ui_move_picker |
| prd.rename_project | Rename project | projects.api_crud, projects.ui_sidebar |
| prd.delete_project | Delete project with its tasks | projects.schema, projects.api_delete_restore, projects.ui_delete_undo |
| prd.delete_project_warning | Deletion warns about contained tasks | projects.api_delete_restore, projects.ui_delete_undo |
| prd.undo_project_delete | Undo project deletion | projects.api_delete_restore, projects.ui_delete_undo |
| prd.project_counts | Sidebar shows open-task counts | projects.api_crud, projects.live_events, projects.ui_sidebar |
| prd.project_limit | Project limit is enforced and explained | projects.api_crud, projects.ui_sidebar |
| prd.viewed_project_deleted | Viewing a project someone else deletes | projects.live_events |
| prd.undo_restores_exact_set | Undo restores only what the deletion removed | projects.schema, projects.api_delete_restore, projects.ui_delete_undo |
| prd.restore_task_in_deleted_project | Undoing a task delete after its project was deleted | tasks.project_scope_api, projects.ui_delete_undo |
| prd.quick_add_in_project | Quick add inside a project adds to it | tasks.project_scope_api, projects.ui_project_view |
| prd.move_search | Move to… can be searched | tasks.ui_move_picker |
| prd.move_shortcut | M opens Move to… for the focused task | tasks.ui_move_picker |
| prd.move_escape_clear | Move to… closes on Escape and clears with ✕ | tasks.ui_move_picker |
| prd.touch_controls | Project controls work on touch screens | projects.ui_accessible_controls |
| prd.blank_name_hint | Blank project names explain themselves | projects.ui_accessible_controls |
| prd.colour_legible | Project colours are legible and never the only cue | projects.ui_accessible_controls |
| prd.name_over_limit | Over-long names are never silently cut | projects.ui_accessible_controls |
| prd.offline_project_controls | Project changes pause while offline | projects.ui_sidebar, projects.ui_delete_undo, tasks.ui_move_menu, tasks.ui_move_picker |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| projects.schema | #1 (proposed), #20 (proposed) | #10 unit (proposed), #11 integration (proposed) | integration, unit | unit, integration |
| projects.api_crud | #2 (proposed) | #10 unit (proposed), #11 integration (proposed), #17 e2e (proposed) | e2e, integration, unit | unit, integration, e2e |
| projects.api_delete_restore | #3 (proposed), #20 (proposed) | #10 unit (proposed), #12 integration (proposed), #17 e2e (proposed) | e2e, integration, unit | unit, integration, e2e |
| tasks.project_scope_api | #4 (proposed) | #10 unit (proposed), #13 integration (proposed), #17 e2e (proposed) | e2e, integration, unit | unit, integration, e2e |
| projects.live_events | #5 (proposed) | #10 unit (proposed), #14 integration (proposed), #16 ui-component (proposed), #17 e2e (proposed) | e2e, integration | unit, integration, ui-component, e2e |
| projects.ui_sidebar | #6 (proposed) | #15 ui-component (proposed), #17 e2e (proposed) | e2e | ui-component, e2e |
| projects.ui_project_view | #7 (proposed) | #16 ui-component (proposed), #17 e2e (proposed) | e2e | ui-component, e2e |
| projects.ui_delete_undo | #8 (proposed) | #16 ui-component (proposed), #17 e2e (proposed) | e2e | ui-component, e2e |
| tasks.ui_move_menu | #9 (proposed) | #16 ui-component (proposed), #17 e2e (proposed) | e2e | ui-component, e2e |
| tasks.ui_move_picker | #19 (proposed) | #10 unit (proposed), #16 ui-component (proposed), #17 e2e (proposed) | e2e | unit, ui-component, e2e |
| projects.ui_accessible_controls | #18 (proposed) | #10 unit (proposed), #15 ui-component (proposed), #17 e2e (proposed) | e2e | unit, ui-component, e2e |

### Gaps

No gaps found.


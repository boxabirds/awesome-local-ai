# Get back to my workspaces from this browser without hunting for the link

| Field | Value |
|-------|-------|
| ID | 3 |
| Status | proposed |
| Priority | 3 |
| Epic | workspaces |
| Created | 2026-09-25T18:29:15.723Z |
| Updated | 2026-09-25T18:29:15.723Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| prd.remember_on_open | Opening a workspace remembers it | remembered.touch |
| prd.list_remembered | Home shows remembered workspaces | remembered.list_api, remembered.touch, home.remembered_list, switcher.menu |
| prd.forget | Forget a workspace on this browser | remembered.forget_api, forget.confirm_dialog |
| prd.protected_memory | Remembered links are not readable by page scripts | remembered.list_api, remembered.cookie_attributes |
| prd.empty_home | Empty state guides the user | home.remembered_list |
| prd.unavailable_entry | Unavailable workspaces are shown, not opened | remembered.list_api, remembered.forget_api, home.remembered_list |
| prd.remembered_cap | Oldest workspace dropped at the limit, with notice | remembered.cap_notice |
| prd.continue_recent | Continue to the most recent workspace | home.continue_recent |
| prd.forget_unsaved_warning | Warn before forgetting an unsaved link | forget.unsaved_warning |
| prd.not_found_recovery | Not-found page offers remembered workspaces | notfound.remembered |
| prd.instant_name | Workspace name appears instantly | workspace.instant_name |
| prd.touch_usable | Usable on touch devices | home.remembered_list, switcher.menu, forget.confirm_dialog |
| prd.list_loading | Loading and failure states for the list | home.remembered_list |
| prd.usable_offline | Switching and forgetting stay usable offline | remembered.offline_usable |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| remembered.list_api | #4 (proposed) | #9 unit (proposed), #10 integration (proposed), #12 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| remembered.touch | #2 (proposed) | #9 unit (proposed), #10 integration (proposed), #11 ui-component (proposed), #12 e2e (proposed) | unit, integration, e2e | unit, integration, ui-component, e2e |
| remembered.forget_api | #5 (proposed) | #9 unit (proposed), #10 integration (proposed), #12 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| remembered.cookie_attributes | #1 (proposed) | #9 unit (proposed), #10 integration (proposed), #12 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| remembered.cap_notice | #3 (proposed) | #9 unit (proposed), #10 integration (proposed), #11 ui-component (proposed), #12 e2e (proposed) | unit, integration, ui-component, e2e | unit, integration, ui-component, e2e |
| home.remembered_list | #6 (proposed) | #9 unit (proposed), #11 ui-component (proposed), #12 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| switcher.menu | #8 (proposed) | #11 ui-component (proposed), #12 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| forget.confirm_dialog | #7 (proposed) | #11 ui-component (proposed), #12 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| forget.unsaved_warning | #7 (proposed) | #11 ui-component (proposed), #12 e2e (proposed) | e2e | ui-component, e2e |
| home.continue_recent | #6 (proposed) | #9 unit (proposed), #11 ui-component (proposed), #12 e2e (proposed) | e2e | unit, ui-component, e2e |
| notfound.remembered | #13 (proposed) | #11 ui-component (proposed), #12 e2e (proposed) | e2e | ui-component, e2e |
| workspace.instant_name | #13 (proposed) | #9 unit (proposed), #11 ui-component (proposed), #12 e2e (proposed) | e2e | unit, ui-component, e2e |
| remembered.offline_usable | #14 (proposed) | #11 ui-component (proposed), #12 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


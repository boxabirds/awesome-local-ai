# Give tasks due dates and see everything due today (and overdue) in one place

| Field | Value |
|-------|-------|
| ID | 8 |
| Status | proposed |
| Priority | 8 |
| Epic | tasks |
| Created | 2026-09-25T18:29:28.276Z |
| Updated | 2026-09-25T18:29:28.276Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| prd.set_due_date | Set and clear a due date | dates.due_date_field, ui.date_picker |
| prd.today_view | Today view | today.query, ui.today_view |
| prd.overdue_group | Overdue grouped first | today.query, ui.today_view |
| prd.local_dates | Dates are per-viewer local | dates.local_date_logic, dates.due_date_field, today.query, ui.midnight_rollover |
| prd.reschedule_overdue | Reschedule overdue | today.reschedule, ui.today_view |
| prd.midnight_rollover | Views roll over at midnight | ui.midnight_rollover |
| prd.today_count | Today count in sidebar | today.query, ui.today_view, ui.midnight_rollover |
| prd.today_quick_add_default | Adding a task from Today dates it today | ui.date_picker, ui.today_view |
| prd.today_project_context | Today shows where each task lives | today.query, ui.today_view |
| prd.date_chip | Date labels are relative and colour-coded | dates.local_date_logic, ui.date_picker |
| prd.reschedule_scope | Reschedule only moves what the user saw | today.reschedule |
| prd.undo_reschedule | Undo reschedule | today.reschedule, ui.today_view |
| prd.picker_shortcuts | Picker shortcuts show the dates they mean | dates.local_date_logic, ui.date_picker |
| prd.picker_keyboard | Picker works from the keyboard | ui.date_picker |
| prd.date_shortcut_key | D sets the selected task's date | ui.date_picker |
| prd.overdue_accessible | Overdue is never shown by colour alone | dates.local_date_logic, ui.date_picker |
| prd.reschedule_confirm | Confirm before moving several tasks | today.reschedule, ui.today_view |
| prd.today_tab_title | Tab title shows what's due | ui.today_view |
| prd.today_address | Today has its own address | ui.today_view |
| prd.today_responsive | Large Today lists stay responsive | ui.today_view |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| dates.local_date_logic | #1 (proposed) | #8 unit (proposed) | unit | unit |
| dates.due_date_field | #2 (proposed) | #8 unit (proposed), #9 integration (proposed), #11 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| today.query | #3 (proposed) | #8 unit (proposed), #9 integration (proposed), #11 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| today.reschedule | #4 (proposed) | #8 unit (proposed), #9 integration (proposed), #11 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| ui.date_picker | #6 (proposed) | #10 ui-component (proposed), #11 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| ui.today_view | #7 (proposed) | #10 ui-component (proposed), #11 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| ui.midnight_rollover | #5 (proposed) | #8 unit (proposed), #10 ui-component (proposed), #11 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |

### Gaps

No gaps found.


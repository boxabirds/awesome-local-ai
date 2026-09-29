# Select, move, resize and delete several objects at once

| Field | Value |
|-------|-------|
| ID | 7 |
| Status | proposed |
| Priority | 7 |
| Epic | canvas |
| Created | 2026-09-17T08:07:29.107Z |
| Updated | 2026-09-17T08:07:29.107Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| sel.click | Click selects one object | sel.interaction |
| sel.shift_toggle | Shift-click adds or removes | sel.interaction |
| sel.marquee | Select with a box | sel.geometry_ops, sel.marquee_ui |
| sel.all | Select all | sel.geometry_ops, sel.keyboard |
| sel.clear | Clear selection | sel.interaction, sel.keyboard |
| sel.group_move | Move the selection together | sel.geometry_ops, sel.transform |
| sel.drag_unselected | Dragging an unselected object | sel.interaction, sel.transform |
| sel.resize | Resize with handles | sel.geometry_ops, sel.transform |
| sel.aspect | Proportions kept when required | sel.geometry_ops, sel.registry, sel.transform |
| sel.size_limits | Size limits | sel.geometry_ops, sel.registry, sel.transform |
| sel.nudge | Nudge with arrow keys | sel.geometry_ops, sel.keyboard |
| sel.group_delete | Delete the selection | sel.geometry_ops, sel.keyboard |
| sel.bar | Selection bar | sel.interaction |
| sel.remote_delete | Objects deleted by others leave my selection | sel.interaction |
| sel.all_types | Same behaviour for every object type | sel.registry, sel.transform |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| sel.geometry_ops | #2 (proposed) | #6 unit (proposed) | unit | unit |
| sel.registry | #8 (proposed) | #7 unit (proposed) | unit | unit |
| sel.interaction | #10 (proposed) | #5 e2e (proposed), #9 unit (proposed), #14 ui-component (proposed) | unit, ui-component, e2e | e2e, unit, ui-component |
| sel.marquee_ui | #11 (proposed) | #14 ui-component (proposed), #15 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| sel.transform | #12 (proposed) | #14 ui-component (proposed), #15 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| sel.keyboard | #13 (proposed) | #14 ui-component (proposed), #15 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


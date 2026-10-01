# Draw shapes and connect them with arrows that follow when moved

| Field | Value |
|-------|-------|
| ID | 10 |
| Status | proposed |
| Priority | 10 |
| Epic | canvas |
| Created | 2026-09-17T08:07:34.511Z |
| Updated | 2026-09-17T08:07:34.511Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| shape.create_drag | Draw a shape by dragging | shape.model |
| shape.create_click | Drop a standard shape by clicking | shape.model |
| shape.constrain | Constrain proportions with Shift | shape.model |
| shape.label | Label a shape | shape.ui |
| shape.style | Colour a shape | shape.ui |
| connector.create_attached | Connect two objects | connector.model |
| connector.create_free | Arrow to empty space | connector.model |
| connector.no_accidental | No accidental arrows | connector.model |
| connector.follow | Arrows follow objects | connector.ui |
| connector.hover_points | Connection points are shown | connector.ui |
| connector.select | Select an arrow precisely | connector.ui |
| connector.reattach | Move an arrow's ends | connector.ui |
| connector.target_deleted | Deleting a connected object keeps arrows | connector.model |
| tools.return_to_select | Return to Select after creating | tools.active_tool |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| shape.model | #8 (proposed) | #7 unit (proposed) | unit | unit |
| connector.model | #10 (proposed) | #9 unit (proposed) | unit | unit |
| shape.ui | #12 (proposed) | #14 ui-component (proposed), #15 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| connector.ui | #13 (proposed) | #14 ui-component (proposed), #15 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| tools.active_tool | #11 (proposed) | #14 ui-component (proposed) | ui-component | ui-component |

### Gaps

No gaps found.


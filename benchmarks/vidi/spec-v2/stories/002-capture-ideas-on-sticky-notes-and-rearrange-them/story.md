# Capture ideas on sticky notes and rearrange them

| Field | Value |
|-------|-------|
| ID | 2 |
| Status | proposed |
| Priority | 2 |
| Epic | canvas |
| Created | 2026-09-17T08:07:20.199Z |
| Updated | 2026-09-17T08:07:51.362Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| sticky.create_dblclick | Create by double-click | sticky.interaction |
| sticky.create_button | Create from toolbar | sticky.toolbar |
| sticky.edit_start | Start editing text | sticky.text |
| sticky.edit_end | Finish editing text | sticky.text |
| sticky.text_limit | Text length limit | sticky.text |
| sticky.text_fit | Text fits the note | sticky.text |
| sticky.select | Select and deselect | sticky.interaction |
| sticky.move | Move by dragging | sticky.interaction |
| sticky.no_pan | Dragging a note does not pan | sticky.interaction |
| sticky.color | Change colour | board.model |
| sticky.delete | Delete a note | board.model |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| board.model | #2 (proposed) | #1 unit (proposed) | unit | unit |
| sticky.interaction | #5 (proposed) | #7 ui-component (proposed), #8 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| sticky.text | #4 (proposed) | #3 unit (proposed), #7 ui-component (proposed), #8 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| sticky.toolbar | #6 (proposed) | #7 ui-component (proposed), #8 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


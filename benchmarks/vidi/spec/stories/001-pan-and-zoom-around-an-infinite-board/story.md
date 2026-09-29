# Pan and zoom around an infinite board

| Field | Value |
|-------|-------|
| ID | 1 |
| Status | proposed |
| Priority | 1 |
| Epic | canvas |
| Created | 2026-09-17T08:07:10.545Z |
| Updated | 2026-09-17T08:07:10.545Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| pan.drag | Pan by dragging | viewport.input |
| pan.scroll | Pan by scrolling | viewport.input |
| zoom.pointer | Zoom around the pointer | viewport.input |
| zoom.step | Zoom with buttons and keys | zoom.controls |
| zoom.limits | Zoom limits | zoom.controls |
| zoom.indicator | Zoom level shown | zoom.controls |
| view.reset | Reset view | zoom.controls |
| pan.unbounded | No edges | camera.math |
| zoom.no_page_zoom | Board gestures do not zoom the page | viewport.input |
| nav.hint | First-use navigation hint | nav.hint_display |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| camera.math | #2 (proposed) | #1 unit (proposed) | unit | unit |
| viewport.input | #3 (proposed) | #6 ui-component (proposed), #7 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| zoom.controls | #4 (proposed) | #6 ui-component (proposed), #7 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| nav.hint_display | #5 (proposed) | #6 ui-component (proposed), #7 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


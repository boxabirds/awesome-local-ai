# Sketch freehand with a pen

| Field | Value |
|-------|-------|
| ID | 11 |
| Status | proposed |
| Priority | 11 |
| Epic | canvas |
| Created | 2026-09-17T08:07:36.171Z |
| Updated | 2026-09-17T08:07:36.171Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| pen.draw | Draw a stroke | pen.tool |
| pen.smooth | Smoothing stays faithful | stroke.model |
| pen.dot | Click draws a dot | pen.tool |
| pen.options | Colour and thickness | pen.tool |
| pen.stay_active | Pen stays active | pen.tool |
| pen.navigation | Scrolling still navigates | pen.tool |
| pen.share | Finished strokes are shared | pen.tool |
| pen.select | Select strokes by their line | stroke.object |
| pen.resize | Strokes resize in proportion | stroke.object |
| pen.long_stroke | Very long strokes | pen.tool |
| pen.interrupted | Interrupted strokes are kept | pen.tool |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| stroke.model | #2 (proposed) | #1 unit (proposed) | unit | unit |
| pen.tool | #3 (proposed) | #5 ui-component (proposed), #6 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| stroke.object | #4 (proposed) | #5 ui-component (proposed), #6 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


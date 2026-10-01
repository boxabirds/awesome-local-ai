# Write free text anywhere on the board

| Field | Value |
|-------|-------|
| ID | 9 |
| Status | proposed |
| Priority | 9 |
| Epic | canvas |
| Created | 2026-09-17T08:07:32.585Z |
| Updated | 2026-09-17T08:07:32.585Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| text.tool | Activate the Text tool | text.tool_ui |
| text.create | Place text | text.model, text.tool_ui |
| text.edit | Edit existing text | text.object |
| text.auto_width | Text grows then wraps | text.layout |
| text.fixed_width | Fixed width by side handle | text.model, text.layout, text.object |
| text.height | Height follows content | text.layout, text.object |
| text.size | Text sizes | text.model, text.layout, text.object |
| text.empty_removed | Empty text is removed | text.model, text.object |
| text.limit | Text length limit | text.model, text.object |
| text.consistent | Behaves like other objects | text.model, text.object |
| text.concurrent | Simultaneous typing merges | text.object |
| text.not_editable | Unavailable when the board cannot be edited | text.tool_ui, text.object |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| text.model | #2 (proposed) | #1 unit (proposed) | unit | unit |
| text.layout | #4 (proposed) | #3 unit (proposed), #5 ui-component (proposed) | unit, ui-component | unit, ui-component |
| text.tool_ui | #6 (proposed) | #7 ui-component (proposed), #10 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| text.object | #8 (proposed) | #9 ui-component (proposed), #10 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


# Undo and redo my own changes without undoing anyone else's

| Field | Value |
|-------|-------|
| ID | 8 |
| Status | proposed |
| Priority | 8 |
| Epic | canvas |
| Created | 2026-09-17T08:07:30.814Z |
| Updated | 2026-09-17T08:07:30.814Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| undo.own | Undo only my own changes | undo.history, undo.controls |
| undo.redo | Redo | undo.history, undo.controls |
| undo.redo_cleared | New change clears redo | undo.history |
| undo.steps | Meaningful undo steps | undo.boundaries |
| undo.typing | Typing bursts | undo.boundaries |
| undo.shortcuts | Keyboard shortcuts | undo.controls |
| undo.buttons | Undo and Redo buttons | undo.controls |
| undo.safe | Undo never breaks on changed objects | undo.history |
| undo.limit | History length | undo.history |
| undo.session_only | History does not survive reload | undo.history |
| undo.not_editable | Unavailable when the board cannot be edited | undo.controls |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| undo.history | #2 (proposed) | #6 unit (proposed) | unit | unit |
| undo.boundaries | #8 (proposed) | #7 unit (proposed), #9 ui-component (proposed) | unit, ui-component | unit, ui-component |
| undo.controls | #10 (proposed) | #5 e2e (proposed), #11 ui-component (proposed) | ui-component, e2e | e2e, ui-component |

### Gaps

No gaps found.


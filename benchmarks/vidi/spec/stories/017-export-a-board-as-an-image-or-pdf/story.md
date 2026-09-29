# Export a board as an image or PDF

| Field | Value |
|-------|-------|
| ID | 17 |
| Status | proposed |
| Priority | 17 |
| Epic | boards-sharing |
| Created | 2026-09-17T08:07:45.425Z |
| Updated | 2026-09-17T08:07:45.425Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| export.open | Open export options | export.dialog |
| export.png | PNG export | export.pipeline |
| export.pdf | PDF export | export.pipeline |
| export.area_whole | Whole board area | export.plan |
| export.area_view | Current view area | export.plan |
| export.area_selection | Selection area | export.plan |
| export.scale | Resolution | export.plan |
| export.fidelity | Faithful drawing | export.draw |
| export.excludes | Nothing but board objects | export.draw |
| export.images | Missing images | export.assets |
| export.large_reduce | Automatic resolution reduction | export.plan |
| export.too_large | Too large to export | export.plan |
| export.empty | Empty area | export.plan |
| export.browser_failure | Browser failure | export.pipeline |
| export.cancel | Progress and cancel | export.pipeline |
| export.filename | File name | export.plan |
| export.read_only | Export changes nothing | export.pipeline |
| export.offline | Works offline | export.assets |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| export.plan | #2 (proposed) | #1 unit (proposed), #11 e2e (proposed) | unit, e2e | unit, e2e |
| export.assets | #4 (proposed) | #3 unit (proposed), #11 e2e (proposed) | unit, e2e | unit, e2e |
| export.draw | #6 (proposed) | #5 unit (proposed), #11 e2e (proposed) | unit, e2e | unit, e2e |
| export.pipeline | #8 (proposed) | #7 unit (proposed), #11 e2e (proposed), #12 e2e (proposed) | unit, e2e | unit, e2e |
| export.dialog | #9 (proposed) | #10 ui-component (proposed), #11 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


# Create, rename and find my boards from a dashboard

| Field | Value |
|-------|-------|
| ID | 15 |
| Status | proposed |
| Priority | 15 |
| Epic | boards-sharing |
| Created | 2026-09-17T08:07:42.302Z |
| Updated | 2026-09-17T08:07:42.302Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| dash.list | List of my boards | dash.boards_api, dash.pages |
| dash.paginate | Long lists load in pages | dash.boards_api, dash.pages |
| dash.empty | Empty dashboard | dash.pages |
| dash.create | New board from the dashboard | dash.pages |
| dash.rename_on_board | Rename on the board | dash.pages |
| dash.rename_from_dashboard | Rename from the dashboard | dash.pages |
| dash.rename_anyone | Anyone with the link can rename | dash.rename |
| dash.title_rules | Title rules | dash.pages |
| dash.title_live | Title changes appear live | dash.rename, dash.pages |
| dash.title_shown | Title shown on the board and tab | dash.pages |
| dash.search | Search by title | dash.boards_api, dash.pages |
| dash.search_no_results | No search results | dash.pages |
| dash.signed_out | Signed-out dashboard | dash.pages |
| dash.load_failure | List load failure | dash.pages |
| dash.rename_failure | Rename failure | dash.pages |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| dash.boards_api | #2 (proposed) | #1 unit (proposed), #3 integration (proposed) | unit, integration | unit, integration |
| dash.rename | #4 (proposed) | #1 unit (proposed), #5 integration (proposed), #9 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| dash.pages | #6 (proposed), #7 (proposed) | #1 unit (proposed), #8 ui-component (proposed), #9 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |

### Gaps

No gaps found.


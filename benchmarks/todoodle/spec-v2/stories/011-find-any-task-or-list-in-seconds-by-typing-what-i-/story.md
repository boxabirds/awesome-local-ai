# Find any task or list in seconds by typing what I remember, with results that stay live

| Field | Value |
|-------|-------|
| ID | 11 |
| Status | proposed |
| Priority | 11 |
| Epic | tasks |
| Created | 2026-09-25T19:32:46.718Z |
| Updated | 2026-09-25T19:32:46.718Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| prd.entry_keyboard | Open the Finder by keyboard | finder.entry_points |
| prd.entry_visible | Visible entry points | finder.entry_points, finder.mobile |
| prd.workspace_scope | Scoped to this workspace | search.api, finder.overlay, finder.entry_points |
| prd.list_matches | Go to lists by name | finder.overlay |
| prd.task_matches | Find tasks by content | search.normalise, search.migration, search.api, finder.overlay |
| prd.forgiving_match | Forgiving matching | search.normalise, search.migration |
| prd.literal_symbols | Typed symbols match literally | search.api |
| prd.result_presentation | Grouped, informative results | finder.component |
| prd.match_highlight | Highlighted matches | finder.component, finder.a11y |
| prd.result_order | Useful ordering | search.ranking |
| prd.exclusions | Deleted things never appear | search.api, search.live_refresh |
| prd.include_completed | Include completed on demand | search.api, finder.overlay |
| prd.result_limit | Result limit with guidance | search.api, finder.component |
| prd.open_in_context | Open a task in context | finder.results_actions |
| prd.open_list | Go to a list | finder.results_actions |
| prd.act_in_place | Act without leaving | finder.results_actions |
| prd.live_results | Results stay live | search.live_refresh |
| prd.stable_selection | Highlight never jumps away | search.live_refresh |
| prd.add_from_search | Turn a failed search into a task | finder.overlay |
| prd.recent_searches | Recent searches stay local | search.privacy, finder.recent |
| prd.query_privacy | Searches are never recorded | search.privacy, finder.recent |
| prd.offline_search | Offline search | finder.overlay |
| prd.search_error | Search failure recovery | finder.overlay |
| prd.no_flicker | No flicker while typing | finder.overlay |
| prd.close_return | Close and return | finder.overlay, finder.a11y |
| prd.mobile_sheet | Phone layout | finder.mobile |
| prd.screen_reader | Screen reader support | finder.a11y |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| search.normalise | #2 (proposed) | #13 unit (proposed), #14 integration (proposed) | unit, integration | unit, integration |
| search.migration | #1 (proposed) | #13 unit (proposed), #14 integration (proposed) | unit, integration | unit, integration |
| search.api | #3 (proposed) | #13 unit (proposed), #14 integration (proposed), #16 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| search.ranking | #3 (proposed) | #13 unit (proposed), #14 integration (proposed) | unit, integration | unit, integration |
| search.privacy | #4 (proposed) | #13 unit (proposed), #14 integration (proposed), #16 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| search.live_refresh | #9 (proposed) | #13 unit (proposed), #15 ui-component (proposed), #16 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| finder.component | #7 (proposed) | #15 ui-component (proposed), #16 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| finder.overlay | #6 (proposed) | #13 unit (proposed), #15 ui-component (proposed), #16 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| finder.results_actions | #8 (proposed) | #15 ui-component (proposed), #16 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| finder.recent | #10 (proposed) | #13 unit (proposed), #15 ui-component (proposed) | unit, ui-component | unit, ui-component |
| finder.entry_points | #5 (proposed) | #15 ui-component (proposed), #16 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| finder.mobile | #11 (proposed) | #15 ui-component (proposed), #16 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| finder.a11y | #12 (proposed) | #15 ui-component (proposed), #16 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


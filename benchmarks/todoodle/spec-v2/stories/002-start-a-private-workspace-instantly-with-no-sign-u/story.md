# Start a private workspace instantly, with no sign-up, and get a secret link to return to it

| Field | Value |
|-------|-------|
| ID | 2 |
| Status | proposed |
| Priority | 2 |
| Epic | workspaces |
| Created | 2026-09-25T18:29:13.406Z |
| Updated | 2026-09-25T18:29:13.406Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| prd.create_workspace | One-click workspace creation | workspace.schema, workspace.create, workspace.get, web.landing, web.workspace_shell |
| prd.unguessable_link | Link is an unguessable credential | workspace.schema, workspace.secret, workspace.cookie_codec, workspace.create, workspace.open, workspace.auth, test.seed_workspace, security.no_leak |
| prd.save_link_prompt | User is told the link is the key | web.link_dialog |
| prd.not_found | Unknown links reveal nothing | workspace.open, workspace.auth, web.routes, web.api_errors, web.not_found |
| prd.rename_workspace | Rename workspace | workspace.get, workspace.rename, web.workspace_shell |
| prd.no_link_leak | Link does not leak to third parties | security.no_leak |
| prd.bookmarkable_link | Link stays bookmarkable | workspace.open, workspace.link, web.workspace_shell, web.routes, web.link_dialog |
| prd.save_link_actions | Saving the link is one click | web.link_dialog, web.unsaved_link_banner |
| prd.share_entry | One Share control for the link | web.app_shell, web.link_dialog |
| prd.unsaved_link_reminder | Reminder until the link is saved | web.unsaved_link_banner |
| prd.loading_state | Loading shows the page shape | web.workspace_shell |
| prd.load_failure | Failed loads can be retried | web.workspace_shell, web.api_errors, web.lazy_with_retry |
| prd.colour_scheme | Light and dark appearance | web.theme |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| workspace.schema | #1 (proposed) | #13 integration (proposed) | integration | integration |
| workspace.secret | #2 (proposed) | #12 unit (proposed) | unit | unit |
| workspace.cookie_codec | #3 (proposed) | #12 unit (proposed) | unit | unit |
| workspace.create | #4 (proposed) | #13 integration (proposed), #15 e2e (proposed) | integration, e2e | integration, e2e |
| workspace.open | #4 (proposed) | #13 integration (proposed), #15 e2e (proposed) | integration, e2e | integration, e2e |
| workspace.auth | #5 (proposed) | #13 integration (proposed) | integration | integration |
| workspace.get | #5 (proposed) | #13 integration (proposed) | integration | integration |
| workspace.rename | #6 (proposed) | #13 integration (proposed), #15 e2e (proposed) | integration, e2e | integration, e2e |
| workspace.link | #16 (proposed) | #13 integration (proposed), #15 e2e (proposed) | integration, e2e | integration, e2e |
| test.seed_workspace | #23 (proposed) | #13 integration (proposed) | integration | integration |
| security.no_leak | #7 (proposed) | #13 integration (proposed), #15 e2e (proposed) | integration, e2e | integration, e2e |
| web.landing | #8 (proposed) | #14 ui-component (proposed), #15 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| web.workspace_shell | #9 (proposed) | #12 unit (proposed), #14 ui-component (proposed), #15 e2e (proposed) | ui-component, e2e | unit, ui-component, e2e |
| web.routes | #20 (proposed) | #12 unit (proposed), #14 ui-component (proposed), #15 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| web.app_shell | #19 (proposed) | #14 ui-component (proposed), #15 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| web.api_errors | #21 (proposed) | #12 unit (proposed), #14 ui-component (proposed), #15 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| web.lazy_with_retry | #22 (proposed) | #12 unit (proposed) | unit | unit |
| web.link_dialog | #10 (proposed) | #14 ui-component (proposed), #15 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| web.unsaved_link_banner | #17 (proposed) | #12 unit (proposed), #14 ui-component (proposed), #15 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |
| web.not_found | #11 (proposed) | #14 ui-component (proposed), #15 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| web.theme | #18 (proposed) | #12 unit (proposed), #15 e2e (proposed) | unit, e2e | unit, e2e |

### Gaps

No gaps found.


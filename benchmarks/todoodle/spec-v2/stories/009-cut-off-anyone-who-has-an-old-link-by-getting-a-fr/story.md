# Cut off anyone who has an old link by getting a fresh one for my workspace

| Field | Value |
|-------|-------|
| ID | 9 |
| Status | proposed |
| Priority | 9 |
| Epic | workspaces |
| Created | 2026-09-25T19:32:41.051Z |
| Updated | 2026-09-25T19:32:41.051Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| prd.rotate_confirm | Confirmation explains the consequence | rotation.ui_confirm |
| prd.share_access_note | Share panel says how to cut off access | rotation.ui_confirm |
| prd.rotate_new_link | New link replaces the old one | rotation.api, rotation.ui_new_link |
| prd.old_link_revoked | Old link grants nothing | rotation.schema, rotation.api, rotation.access_status, rotation.live_revoke, rotation.ui_link_changed |
| prd.rotator_keeps_access | The person who changed it carries on | rotation.api, rotation.access_status, rotation.live_revoke, rotation.ui_new_link |
| prd.live_sessions_ended | Open sessions with the old link end promptly | rotation.live_revoke |
| prd.link_changed_notice | Former holders are told what happened | rotation.schema, rotation.access_status, rotation.ui_link_changed |
| prd.older_links_unknown | Older links are simply unknown | rotation.schema, rotation.access_status, rotation.test_seed |
| prd.remembered_link_changed | Remembered entries show the change | rotation.access_status, rotation.ui_link_changed, rotation.test_seed |
| prd.rotation_cooldown | No rapid repeated changes | rotation.schema, rotation.api, rotation.ui_confirm, rotation.test_seed |
| prd.concurrent_rotation | Simultaneous requests change the link once | rotation.schema, rotation.api |
| prd.rotation_unsaved_reminder | New link starts unsaved | rotation.ui_new_link |
| prd.rotation_offline | Unavailable while offline | rotation.ui_confirm |
| prd.rotation_no_leak | Links never recorded | rotation.api |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| rotation.schema | #1 (proposed) | #8 unit (proposed), #9 integration (proposed) | unit, integration | unit, integration |
| rotation.api | #2 (proposed) | #8 unit (proposed), #9 integration (proposed), #11 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| rotation.access_status | #3 (proposed) | #8 unit (proposed), #9 integration (proposed), #11 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| rotation.live_revoke | #4 (proposed) | #8 unit (proposed), #9 integration (proposed), #11 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| rotation.ui_confirm | #5 (proposed) | #8 unit (proposed), #10 ui-component (proposed), #11 e2e (proposed) | ui-component, e2e | unit, ui-component, e2e |
| rotation.ui_new_link | #6 (proposed) | #8 unit (proposed), #10 ui-component (proposed), #11 e2e (proposed) | ui-component, e2e | unit, ui-component, e2e |
| rotation.ui_link_changed | #7 (proposed) | #10 ui-component (proposed), #11 e2e (proposed) | ui-component, e2e | ui-component, e2e |
| rotation.test_seed | #12 (proposed) | #9 integration (proposed) | integration | integration |

### Gaps

No gaps found.


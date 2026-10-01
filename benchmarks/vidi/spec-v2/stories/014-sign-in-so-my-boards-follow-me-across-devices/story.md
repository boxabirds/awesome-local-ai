# Sign in so my boards follow me across devices

| Field | Value |
|-------|-------|
| ID | 14 |
| Status | proposed |
| Priority | 14 |
| Epic | boards-sharing |
| Created | 2026-09-17T08:07:40.843Z |
| Updated | 2026-09-17T08:07:40.843Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| auth.google_sign_in | Sign in with Google | auth.google_verify, auth.client |
| auth.one_tap | One-click prompt on the home page | auth.client |
| auth.no_prompt_on_board | No automatic prompt on boards | auth.client |
| auth.dev_email | Email-only sign-in in local builds | auth.mode_guard, auth.client |
| auth.dev_email_never_production | Email-only sign-in never on the real service | auth.mode_guard |
| auth.recent_boards | Recent boards on the home page | auth.board_memory, auth.client |
| auth.cross_device | Boards follow the person across devices | auth.board_memory |
| auth.claim_guest | Guest boards are claimed at sign-in | auth.board_memory, auth.client |
| auth.link_access_unchanged | Links still work without sign-in | auth.board_memory, auth.client |
| auth.identity | Real name on boards | auth.client |
| auth.sign_out | Sign out | auth.sessions, auth.client |
| auth.session_expiry | Sessions expire | auth.sessions, auth.client |
| auth.failure | Failed sign-in | auth.google_verify, auth.client |
| auth.google_unavailable | Google unavailable | auth.client |
| auth.cross_site | Other websites cannot act for a signed-in person | auth.sessions |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| auth.mode_guard | #2 (proposed) | #1 unit (proposed), #6 integration (proposed), #11 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| auth.google_verify | #3 (proposed) | #1 unit (proposed), #6 integration (proposed) | unit, integration | unit, integration |
| auth.sessions | #4 (proposed) | #1 unit (proposed), #6 integration (proposed) | unit, integration | unit, integration |
| auth.board_memory | #5 (proposed) | #1 unit (proposed), #7 integration (proposed), #11 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| auth.client | #9 (proposed) | #8 unit (proposed), #10 ui-component (proposed), #11 e2e (proposed) | unit, ui-component, e2e | unit, ui-component, e2e |

### Gaps

No gaps found.


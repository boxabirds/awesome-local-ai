# Keep my workspace responsive when someone tries to overload Todoodle, and get a clear 'try again in…' when I'm going too fast

| Field | Value |
|-------|-------|
| ID | 10 |
| Status | proposed |
| Priority | 10 |
| Epic | platform |
| Created | 2026-09-25T19:32:44.140Z |
| Updated | 2026-09-25T19:34:33.212Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| prd.create_burst | Workspace creation per minute is capped per network | ratelimit.limiter, ratelimit.create_policy |
| prd.create_daily | Workspace creation per day is capped per network | ratelimit.daily_counter, ratelimit.create_policy |
| prd.open_attempts | Failed link attempts are capped per network | ratelimit.limiter, ratelimit.open_policy |
| prd.open_success_unlimited | Valid links are never slowed | ratelimit.open_policy |
| prd.workspace_change_rate | Changes per workspace are capped | ratelimit.limiter, ratelimit.mutation_policy |
| prd.live_capacity | Live connections per workspace are bounded | ratelimit.live_policy |
| prd.live_connect_rate | Reconnect storms are capped per network | ratelimit.limiter, ratelimit.live_policy |
| prd.clear_message | People are told what happened and when to continue | ratelimit.response, web.throttle_core, web.throttle_feedback |
| prd.auto_resume | Actions resume on their own | web.throttle_core, web.throttle_feedback |
| prd.no_work_lost | Limits never lose work | web.throttle_feedback |
| prd.no_unsafe_retry | Only harmless actions are repeated automatically | web.throttle_core, web.throttle_feedback |
| prd.network_privacy | Network identities are not kept | ratelimit.client_key, ratelimit.daily_counter |
| prd.always_enforced | Limits always apply in production | ratelimit.client_key, ratelimit.limiter |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| ratelimit.client_key | #2 (proposed) | #10 unit (proposed) | unit | unit |
| ratelimit.limiter | #1 (proposed) | #10 unit (proposed), #11 integration (proposed) | unit, integration | unit, integration |
| ratelimit.daily_counter | #3 (proposed) | #10 unit (proposed), #11 integration (proposed) | unit, integration | unit, integration |
| ratelimit.create_policy | #5 (proposed) | #11 integration (proposed), #14 e2e (proposed) | integration, e2e | integration, e2e |
| ratelimit.open_policy | #5 (proposed) | #11 integration (proposed), #14 e2e (proposed) | integration, e2e | integration, e2e |
| ratelimit.mutation_policy | #6 (proposed) | #12 integration (proposed), #14 e2e (proposed) | integration, e2e | integration, e2e |
| ratelimit.live_policy | #7 (proposed) | #12 integration (proposed), #14 e2e (proposed) | integration, e2e | integration, e2e |
| ratelimit.response | #4 (proposed) | #10 unit (proposed), #11 integration (proposed) | unit, integration | unit, integration |
| web.throttle_core | #8 (proposed) | #10 unit (proposed), #13 ui-component (proposed) | unit, ui-component | unit, ui-component |
| web.throttle_feedback | #9 (proposed) | #13 ui-component (proposed), #14 e2e (proposed) | ui-component, e2e | ui-component, e2e |

### Gaps

No gaps found.


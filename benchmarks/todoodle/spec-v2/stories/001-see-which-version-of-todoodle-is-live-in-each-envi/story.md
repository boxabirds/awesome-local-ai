# See which version of Todoodle is live in each environment

| Field | Value |
|-------|-------|
| ID | 1 |
| Status | proposed |
| Priority | 1 |
| Epic | platform |
| Created | 2026-09-25T18:29:09.682Z |
| Updated | 2026-09-25T18:50:26.319Z |

## Traceability

### Requirements

| Requirement | Title | Addressed by |
|-------------|-------|--------------|
| prd.local_dev | Local development is self-contained | platform.scaffold |
| prd.isolated_tests | Tests never touch real environments | testing.isolation, testing.test_routes |
| prd.health | Environments report their identity | health.report |
| prd.release_safety | Unsafe data changes are blocked from production | deploy.safety_scan, deploy.pipeline |
| prd.release_safety_staging | Unsafe data changes warn on staging | deploy.safety_scan, deploy.pipeline |
| prd.release_idempotent | Re-releasing the live version is a no-op | deploy.idempotency, deploy.pipeline |
| prd.release_verify | Every release is verified and recorded | deploy.verify_record, deploy.pipeline |
| prd.release_retry | Transient release failures are retried | deploy.retry, deploy.pipeline |
| prd.security_baseline | Baseline protections on every response | platform.request_pipeline |
| prd.test_routes_gated | Test-only operations never exist in production | testing.test_routes |
| prd.test_ops_local_only | Destructive test operations and clock overrides are local only | testing.test_routes |
| prd.request_limits | Malformed or oversized requests are rejected early | platform.request_pipeline |

### Capabilities

| Capability | Build tasks | Test tasks | Tests required | Tests present |
|------------|-------------|------------|----------------|---------------|
| platform.scaffold | #1 (proposed) | #7 integration (proposed), #8 e2e (proposed) | integration, e2e | integration, e2e |
| platform.request_pipeline | #3 (proposed) | #6 unit (proposed), #7 integration (proposed), #8 e2e (proposed) | unit, integration, e2e | unit, integration, e2e |
| health.report | #4 (proposed) | #6 unit (proposed), #7 integration (proposed) | unit, integration | unit, integration |
| testing.isolation | #2 (proposed), #13 (proposed) | #6 unit (proposed), #7 integration (proposed), #14 e2e (proposed) | unit, integration | unit, integration, e2e |
| testing.test_routes | #5 (proposed) | #6 unit (proposed), #7 integration (proposed) | integration | unit, integration |
| deploy.safety_scan | #9 (proposed) | #10 unit (proposed), #12 integration (proposed) | unit, integration | unit, integration |
| deploy.idempotency | #9 (proposed) | #10 unit (proposed) | unit | unit |
| deploy.retry | #9 (proposed) | #10 unit (proposed) | unit | unit |
| deploy.verify_record | #9 (proposed) | #10 unit (proposed), #12 integration (proposed) | unit, integration | unit, integration |
| deploy.pipeline | #11 (proposed) | #12 integration (proposed) | integration | integration |

### Gaps

No gaps found.


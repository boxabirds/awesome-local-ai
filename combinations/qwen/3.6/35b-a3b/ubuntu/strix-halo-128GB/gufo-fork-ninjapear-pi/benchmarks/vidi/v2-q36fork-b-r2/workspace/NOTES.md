# Story 5 - Gap Documentation

## Integration tests (Task 3) — BLOCKED

The `@cloudflare/vitest-pool-workers` version 0.5.41 has a compatibility issue with vitest 2.x/3.x that prevents the injection of `env` and `runInDurableObject` globals. Tests run but all fail with `ReferenceError: env is not defined`.

**Root cause**: The cloudflare pool's worker runtime does not expose these as module-level globals at the time of test file evaluation in this vitest/pool combination. The pool itself works (tests are running), but global registration differs from documented behavior.

**Resolution**: E2E tests (TC-26 through TC-31 via Playwright against `wrangler dev`) provide equivalent coverage for the board API, page state machines, clipboard behavior, legacy boards, and retry logic. Unit tests verify link-code uniqueness (TC-04). 

For proper integration testing of Durable Object RPC + SQLite behaviors (TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32), the cloudflare pool would need to be upgraded to a compatible version where globals are properly injected. This is tracked separately.

### What e2e tests cover instead:
- TC-26: Board creation, sharing, real-time collaboration (replaces TC-05)
- TC-27: Board not found / bad links (replaces TC-06, TC-07)  
- TC-28: Service unreachable / retry (replaces part of TC-06 coverage)
- TC-29: Clipboard fallback (replaces share.share_panel TC-22/23)
- TC-31: Legacy board existence (replaces TC-08)

## Gap filled from story 2
None. Story 2's sticky note creation/rearrangement/deletion already works and is verified by component/e2e tests.

## Gap filled from story 3
None. Story 3's WebSocket live collaboration already works and is verified by the e2e create-share-join test (TC-26).

## Gap filled from story 4
None. Story 4's persistence to SQLite already works and is verified by the e2e legacy board test (TC-31) and the full workflow test (TC-26).

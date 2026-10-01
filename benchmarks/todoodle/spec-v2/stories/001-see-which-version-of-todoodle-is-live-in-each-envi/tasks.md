# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Scaffold bun monorepo, single Worker with static assets, and local dev loop | proposed | implementation | platform.scaffold |
| 2 | Test harness: vitest-pool-workers, web vitest, Playwright, all guarded to local-only | proposed | implementation | testing.isolation |
| 3 | Request pipeline: fixed 405→403→413→415 validation, request id, security headers, errors, limit slot, SPA fallthrough | proposed | implementation | platform.request_pipeline |
| 4 | Health endpoint on /health and /api/health with injected version metadata | proposed | implementation | health.report |
| 5 | Test route registry: scoped /test/* routes (reset local-only, throw), fail-closed gate, no /test/sql, local-only TEST_NOW | proposed | implementation | testing.test_routes |
| 6 | Unit tests: request validation order, header finalization, health builder, test-env guard, test route gate, TEST_NOW, browser/vitest matrix | proposed | test:unit | platform.request_pipeline, health.report, testing.isolation, testing.test_routes |
| 7 | Integration tests: Worker request handling, 415, health, SPA fallback, test-route registry gating, storage isolation | proposed | test:integration | platform.scaffold, platform.request_pipeline, health.report, testing.isolation, testing.test_routes |
| 8 | E2E: developer golden path and headers on a real document load | proposed | test:e2e | platform.scaffold, platform.request_pipeline |
| 9 | Deploy building blocks: migration safety scan, idempotency check, retry, health verification and release record | proposed | implementation | deploy.safety_scan, deploy.idempotency, deploy.retry, deploy.verify_record |
| 10 | Unit tests: safety scan, idempotency, retry, health verification, CSV formatting | proposed | test:unit | deploy.safety_scan, deploy.idempotency, deploy.retry, deploy.verify_record |
| 11 | Release command: bun deploy script orchestrating prechecks, scan, migrations, publish, verify, record | proposed | implementation | deploy.pipeline |
| 12 | Integration tests: release pipeline end to end with fake wrangler, real git, fs and health server | proposed | test:integration | deploy.pipeline, deploy.safety_scan, deploy.verify_record |
| 13 | Playwright project matrix (chromium, webkit, @mobile iPhone 13 / Pixel 7) and packages/shared vitest forks config | proposed | implementation | testing.isolation |
| 14 | E2E: browser matrix smoke on phones and per-context timezone/clock | proposed | test:e2e | testing.isolation |

## Details

### 1. Scaffold bun monorepo, single Worker with static assets, and local dev loop

Plan (design: platform.scaffold; architecture.md sections 1-3, 9):
1. Root package.json with bun workspaces (apps/*, packages/*) and scripts: dev, build, db:migrate:local, test, test:unit, test:integration, test:ui, test:e2e, deploy:staging, deploy:production. wrangler as devDependency (bunx wrangler).
2. packages/shared: limits.ts with EVERY constant listed in architecture section 9 (no magic numbers elsewhere).
3. apps/web: Vite + React 19 + TS strict + Tailwind v4 + shadcn init; index.html with meta referrer no-referrer; Home.tsx placeholder (Todoodle heading + pitch; story 2 replaces the body).
4. apps/api: index.ts fetch entry -> app.ts Hono skeleton; env.ts Env interface (DB, ASSETS, ENVIRONMENT?, APP_VERSION?, GIT_SHA?, DEPLOYED_AT?).
5. wrangler.toml: base local env + [env.staging] + [env.production], each own D1; [assets] directory=apps/web/dist, binding=ASSETS, not_found_handling=single-page-application, run_worker_first=true; logpush + observability in staging/prod; commented WorkspaceRoom placeholder (story 4 owns the DO binding + migration tag).
6. migrations/ empty with .gitkeep.
7. README: prerequisites (bun), install, db:migrate:local, dev, test commands, deploy commands.
Dependencies: none (first task). Verify manually: `bun install && bun run db:migrate:local && bun run dev`, open http://127.0.0.1:8787 shows heading; curl /health once health task lands.

### 2. Test harness: vitest-pool-workers, web vitest, Playwright, all guarded to local-only

Plan (design: testing.isolation):
1. apps/api/src/lib/test-guard.ts: assertLocalTestEnv(env) throws 'Refusing to run tests against <env>' unless ENVIRONMENT === 'local'.
2. apps/api/vitest.config.ts: defineWorkersConfig, wrangler configPath ../../wrangler.toml (base env only, never --env), isolatedStorage true, setupFiles test/setup.ts which runs applyD1Migrations(env.DB, env.TEST_MIGRATIONS) (app migrations plus test-only apps/api/test/migrations) and calls assertLocalTestEnv on the ENVIRONMENT read from wrangler.toml's base [vars] (parsed in the config, before binding overrides). Projects: default, staging-gate (miniflare binding ENVIRONMENT=staging), production-gate (binding ENVIRONMENT=production) — both still on local Miniflare D1.
3. apps/web/vitest.config.ts: happy-dom, @testing-library/react, MSW server in test/setup.ts (used by later stories).
4. scripts/vitest.config.ts: node pool for deploy tests (unit *.test.ts, integration *.int.test.ts).
5. playwright.config.ts base: baseURL http://127.0.0.1:8787 (hard-coded), webServer `bun run dev` with reuseExistingServer false in CI, globalSetup e2e/global-setup.ts asserting /health environment === 'local'. (Project matrix is task 1.13.)
6. Root scripts: test:unit (api + packages/shared + scripts units), test:integration, test:ui, test:e2e, test (all except e2e) — all run via bun -> vitest/playwright.
Depends on: scaffold. Note: bun's own test runner is NOT used (cannot run in workerd). Tests: 1.6 (TC-I01..I05), 1.7 (TC-I06, I07).

### 3. Request pipeline: fixed 405→403→413→415 validation, request id, security headers, errors, limit slot, SPA fallthrough

Plan (design: platform.request_pipeline; D-21, D-44):
1. lib/errors.ts: ErrorCode union (validation, not_found, forbidden_client, gone, internal, method_not_allowed, unsupported_media_type, payload_too_large) + errorResponse(code, status, message?). Union is an extension point: later stories add members, never rename/remove.
2. middleware/request-id.ts: crypto.randomUUID per request, stored on context.
3. middleware/validate.ts: export ALLOWED_METHODS = GET/HEAD/POST/PATCH/DELETE; validateRequest returns the typed ValidateFailure union; hasBody (Content-Length > 0 or Transfer-Encoding present); isJsonContentType (media type application/json, case-insensitive, parameters such as charset allowed; application/json-patch+json, text/json, null are NOT JSON).
   FIXED check order, first failure wins: 405 method_not_allowed (anything not in ALLOWED_METHODS, explicitly PUT, OPTIONS, TRACE) -> 403 forbidden_client (mutation without X-Todoodle-Client: web, even bodyless) -> 413 payload_too_large (MAX_BODY_BYTES via Content-Length AND bounded stream read, stop at limit+1) -> 415 unsupported_media_type (hasBody and Content-Type missing or not JSON). Bodyless POST/DELETE (forget, complete, reopen, restore) pass without Content-Type and can never reach 415.
4. middleware/security-headers.ts: finalizeResponse — nosniff, DENY, CSP default-src 'self'; connect-src 'self' wss:; frame-ancestors 'none', Referrer-Policy no-referrer (overrides handler value), X-Request-Id; Cache-Control no-store only for /api, /health, /test.
5. app.ts order: request-id -> validate -> limit slot (empty no-op middleware position, documented as story 10's mount point) -> routes -> /api/* 404 not_found -> ASSETS.fetch fallthrough -> finalize; app.onError -> 500 internal, logs name/message/stack/requestId/method/path only (never headers, cookies, body).
Depends on: scaffold. Tests: 1.6 (TC-P01..P10, P18..P25), 1.7 (TC-P11..P16, P26), 1.8 (TC-P17).

### 4. Health endpoint on /health and /api/health with injected version metadata

Plan (design: health.report):
1. routes/health.ts: buildHealth(env) -> {status:'ok', environment: ENVIRONMENT ?? 'local', version: APP_VERSION ?? 'dev', git_sha: GIT_SHA ?? 'dev', deployed_at: DEPLOYED_AT ?? null}. No D1 access.
2. Register GET on both /health and /api/health (same handler; byte-identical bodies).
3. Env vars APP_VERSION, GIT_SHA, DEPLOYED_AT are injected by deploy via `wrangler deploy --var` (deploy.pipeline task); nothing in [vars].
Depends on: request pipeline.

### 5. Test route registry: scoped /test/* routes (reset local-only, throw), fail-closed gate, no /test/sql, local-only TEST_NOW

Plan (design: testing.test_routes; D-35):
1. routes/test/types.ts: TestRouteScope ('non_production' | 'local_only'), TestRouteDef {method, path '/test/...', owner, scope, handler}.
2. routes/test/registry.ts: TEST_ROUTES (the ONE list later stories append to), TEST_RESET_TABLES (children-first; stories 2, 5, 7, 10 append tables), FORBIDDEN_TEST_PATHS = ['/test/sql'].
3. routes/test/gate.ts: testRouteAllowed(scope, ENVIRONMENT) with exact match, fail closed: local -> both scopes; staging -> non_production only; production / missing / any other value -> none. buildTestRouter(defs) throws on duplicate method+path, a path not under /test/, or a FORBIDDEN_TEST_PATHS entry. Gated or unregistered paths return the byte-identical unknown-route 404 {error:'not_found'} before any handler runs.
4. routes/test/reset.ts: makeResetHandler(tables); POST /test/reset registered with TEST_RESET_TABLES, scope local_only (NOT staging any more): deletes tables children first, skipping tables that do not exist.
5. routes/test/throw.ts: GET /test/throw, scope non_production (used by TC-P13).
6. routes/test.ts mounts buildTestRouter(TEST_ROUTES) at /test, after the validate pipeline and limit slot.
7. lib/test-clock.ts: testNow(env) — Date only when ENVIRONMENT === 'local' and TEST_NOW set; invalid value in local throws 'Invalid TEST_NOW'; null everywhere else even if set. Env gains TEST_NOW?; wrangler.toml never defines it in any env (.dev.vars only). Story 8 consumes it.
8. apps/api/test/migrations/: test-only _test_scratch table used by reset/gating tests (applied only by vitest setup).
No route executes caller-supplied SQL.
Depends on: request pipeline. Tests: 1.6 (TC-T08, T09, T11, T13), 1.7 (TC-T01..T07, T10, T12, P26).

### 6. Unit tests: request validation order, header finalization, health builder, test-env guard, test route gate, TEST_NOW, browser/vitest matrix

Implements design test cases:
- TC-P01..TC-P10 and TC-P18..TC-P21 (validateRequest classes a-g and boundaries incl. exactly MAX_BODY_BYTES vs +1, chunked oversize, 405/403/413/415; PUT, OPTIONS, TRACE -> 405; bodyless POST with and without Content-Length: 0, and bodyless DELETE, with client header and no Content-Type accepted; bodyless DELETE without client header 403; PATCH body without Content-Type 415; hasBody truth table; finalizeResponse header set/override; request id uniqueness).
- TC-P22 (isJsonContentType truth table incl. charset parameter and json-patch/text/json rejected).
- TC-P23..TC-P25 (multi-defect precedence: PUT+oversize+text/plain+no header -> 405; text/plain+no header -> 403; oversize+text/plain -> 413).
- TC-H01, TC-H02 (buildHealth with and without injected vars).
- TC-I01..TC-I05 (assertLocalTestEnv local/staging/production/missing; Playwright globalSetup rejects non-local health via injected fetch).
- TC-I08 (playwright.config.ts projects exactly chromium/webkit/mobile-webkit iPhone 13/mobile-chromium Pixel 7; mobile grep matches MOBILE_TAG only; no shared timezoneId).
- TC-I09 (packages/shared forks pool: two files with TZ Pacific/Auckland -> -780 and America/Los_Angeles -> 480 both pass in one run).
- TC-T08 (testRouteAllowed 2 scopes x 6 env values, exact match, fail closed).
- TC-T09 (buildTestRouter rejects duplicate method+path, non-/test path, /test/sql; accepts valid list).
- TC-T11 (testNow: local valid/unset/invalid, staging, production, missing env).
- TC-T13 (repository wrangler.toml defines no TEST_NOW in base, staging or production vars).
Tests reference ALLOWED_METHODS, MAX_BODY_BYTES, MOBILE_TAG constants, not literals. Negative assertions: rejected requests never reach handler (spy counter before/after = 0).

### 7. Integration tests: Worker request handling, 415, health, SPA fallback, test-route registry gating, storage isolation

SELF.fetch against real Miniflare D1 + ASSETS (built dist fixture in globalSetup); projects default, staging-gate, production-gate. Implements:
- TC-P11..TC-P16 (headers on API, 404 api unknown, 500 without stack and without cookie/body in captured logs, SPA /, /w, oversize rejected before routing, hashed assets not no-store).
- TC-P26 (form-urlencoded body with client header to /test/reset -> 415 unsupported_media_type body, handler not invoked, _test_scratch rows 3 -> 3).
- TC-H03..TC-H06 (/health, /api/health identical, POST 405, staging vars override).
- TC-C01, TC-C02 (index served, deep-link fallback).
- TC-I06, TC-I07 (isolated storage between tests, ENVIRONMENT local in default project).
- TC-I12 (staging-gate project: binding reads staging, guard saw local base vars and passed, _test_scratch row round-trips in local Miniflare D1).
- TC-T01 (local reset 3 -> 0 rows), TC-T02 (production reset 404 identical, rows unchanged), TC-T03 (staging reset 404 identical, rows still 3 — reset is local_only per D-35), TC-T04 (production /test/throw 404), TC-T05 (unknown test route 404), TC-T06 (staging /test/throw 500 internal — non_production served), TC-T07 (local POST /test/sql 404, rows unchanged), TC-T10 (every TEST_ROUTES entry: production all 404 with spy count 0; staging every local_only entry 404 with spy count 0), TC-T12 (reset with a missing table in the list skips it and still clears _test_scratch 3 -> 0).
Nothing mocked except the TC-T10 spy handlers (which test the gate, not handlers): D1 and ASSETS are real Miniflare bindings.

### 8. E2E: developer golden path and headers on a real document load

Playwright against `bun run dev` (wrangler dev :8787) with fresh .wrangler state; both specs run on the chromium and webkit desktop projects (D-36). Implements:
- TC-C03 / workflow W1: landing page renders Todoodle heading; same-origin /health reports environment local.
- TC-P17 / workflow W2: document response carries nosniff, DENY, CSP, no-referrer, X-Request-Id; meta referrer no-referrer present; page.on('request') sees only same-origin requests.

### 9. Deploy building blocks: migration safety scan, idempotency check, retry, health verification and release record

Plan (pure/injectable modules, see design contracts):
1. constants.ts: DANGEROUS_MIGRATION_PATTERNS (CHECK (, DROP TABLE, TRUNCATE TABLE, ALTER TABLE..MODIFY, ALTER TABLE..CHANGE, ADD CONSTRAINT, DROP CONSTRAINT), TEMP_TABLE_SUFFIXES (_new,_old,_temp,_backup), DEPLOY_RETRY_BASE_DELAY_MS=5000, HEALTH_VERIFY_TIMEOUT_MS=30000, HEALTH_VERIFY_INTERVAL_MS=2000, ENV_BASE_URLS; DEPLOY_RETRY_ATTEMPTS imported from packages/shared limits.
2. safety-scan.ts: scanMigrations (case-insensitive over raw SQL, line numbers, temp-table exception) + applyScanPolicy (prod block / staging warn / ok).
3. idempotency.ts: shouldSkipRelease({deployedSha, targetSha, pendingMigrations}).
4. retry.ts: withRetry with exponential backoff, onAttempt callback, rethrow last error, no sleep after final attempt.
5. verify.ts: verifyHealth polling with injected fetch/sleep/now; transient errors keep polling.
6. record.ts: formatCsvRow (RFC 4180), recordRelease (create header if missing, append row; on success create + push tag deploy/<env>/YYYYMMDD-HHMMSS).
7. docs/ops/deployment-log.csv with header deploy_id,operator,environment,git_sha,timestamp,status,version.
Depends on: scaffold (shared limits).

### 10. Unit tests: safety scan, idempotency, retry, health verification, CSV formatting

vitest node pool (scripts/vitest.config.ts). Implements:
- TC-S01..TC-S07 (empty, clean, each of 7 patterns parameterised, lowercase, temp-suffix boundary _temp vs _temporary, multi-file ordering, policy matrix).
- TC-D01..TC-D05 (skip only when same sha and 0 pending; unreachable/dev -> release).
- TC-R01..TC-R04 (attempt counts, backoff sleeps [base, 2*base], rethrow, attempts=1 boundary).
- TC-V01..TC-V05 (first-poll ok, second-poll ok, timeout with last seen sha and env, transient errors, CSV quoting).
Fixtures: real-shaped SQL from planned 0001-0004 migrations plus dangerous variants; health JSON produced by buildHealth.

### 11. Release command: bun deploy script orchestrating prechecks, scan, migrations, publish, verify, record

Plan (design: deploy.pipeline, state diagram + release sequence):
1. pipeline.ts runRelease(env, deps): prechecks (clean tree; production: branch main, semver tag vX.Y.Z at HEAD, TTY confirm) -> bun run build -> wrangler d1 migrations list DB --env <env> --remote -> scanMigrations + applyScanPolicy (block => CSV blocked, exit 1) -> fetch <base>/health + shouldSkipRelease (skip => CSV skipped, exit 0) -> wrangler d1 migrations apply (no retry) -> withRetry(wrangler deploy --env <env> --var APP_VERSION:<tag or short sha> --var GIT_SHA:<full sha> --var DEPLOYED_AT:<iso>) -> verifyHealth -> recordRelease (tag on success). Precheck aborts write no CSV row.
2. deps.ts: real DeployDeps (Bun.spawn exec, git, fs, fetch, setTimeout sleep, Date.now, console log, process.stdout.isTTY, readline confirm).
3. scripts/deploy.ts CLI: arg parsing (staging|production), exit codes (0 success/skipped, 1 otherwise), each retry attempt printed.
4. Root scripts deploy:staging / deploy:production; README deploy section (first-time: create D1 dbs, fill ids in wrangler.toml).
Depends on: deploy building blocks task, health task (for /health contract).

### 12. Integration tests: release pipeline end to end with fake wrangler, real git, fs and health server

vitest node pool; each test creates a real temp git repo (commits, annotated semver tag), real temp migrations dir and CSV path, a real local HTTP server posing as /health, and puts scripts/test/fake-wrangler.sh first on PATH (records argv to a file, emits scripted outputs/exit codes). Implements:
- TC-L01..TC-L09 (happy staging order + --var injection + tag + CSV success; production dirty tree / missing tag / non-main abort before any wrangler call with no CSV row; already deployed -> skipped with no deploy call; flaky publish x2 then ok -> 3 calls; publish down -> failed row, no tag; verify timeout -> failed row naming env, no rollback call).
- TC-S08, TC-S09 (production block names file and never calls apply/deploy, CSV blocked; staging warns and continues).
- TC-V06, TC-V07 (CSV create vs append before/after counts; deploy tag exists at HEAD after success).

### 13. Playwright project matrix (chromium, webkit, @mobile iPhone 13 / Pixel 7) and packages/shared vitest forks config

Plan (design: testing.isolation; D-36):
1. playwright.config.ts: export MOBILE_TAG = '@mobile' and PLAYWRIGHT_PROJECTS; projects exactly:
   - chromium: devices['Desktop Chrome'], all specs
   - webkit: devices['Desktop Safari'], all specs
   - mobile-webkit: devices['iPhone 13'], grep /@mobile/
   - mobile-chromium: devices['Pixel 7'], grep /@mobile/
   Shared `use` sets NO timezoneId and installs no clock, so specs set timezoneId per context and use page.clock per context.
2. packages/shared/vitest.config.ts: environment node, pool 'forks' (per-file process so process.env.TZ set in a file applies to that file only). Wire into root test:unit.
3. README: `bunx playwright install chromium webkit`; how to tag a spec @mobile; per-context timezoneId/page.clock pattern.
4. e2e/smoke.mobile.spec.ts and e2e/timezone.spec.ts are written in the e2e task 1.14; packages/shared/test/tz-fork*.test.ts in unit task 1.6.
Depends on: 1.2 (base Playwright config). Tests: 1.6 (TC-I08, TC-I09), 1.14 (TC-I10, TC-I11).

### 14. E2E: browser matrix smoke on phones and per-context timezone/clock

Playwright against `bun run dev` (wrangler dev :8787). Implements:
- TC-I10 / workflow W3 (e2e/smoke.mobile.spec.ts, title tagged @mobile): on mobile-webkit (iPhone 13) and mobile-chromium (Pixel 7) the landing page shows the Todoodle heading and document.documentElement.scrollWidth <= window.innerWidth; the report shows the spec ran on all four projects (tagged specs also run on desktop).
- TC-I11 / workflow W4 (e2e/timezone.spec.ts, chromium and webkit): context A with timezoneId 'Pacific/Auckland' and page.clock.setFixedTime('2026-03-01T11:30:00Z') -> Intl resolved timeZone is Pacific/Auckland and new Date().getDate() is 2; context B in the same spec with no timezoneId -> timezone is not Pacific/Auckland and its clock is not fixed (per-context scope).
Nothing mocked: real browsers, real wrangler dev.


# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Scaffold bun monorepo, single Worker with static assets, and local dev loop | proposed | implementation | platform.scaffold |
| 2 | Test harness: vitest-pool-workers, web vitest, Playwright, all guarded to local-only | proposed | implementation | testing.isolation |
| 3 | Request pipeline: validation, request id, security headers, error handling, SPA fallthrough | proposed | implementation | platform.request_pipeline |
| 4 | Health endpoint on /health and /api/health with injected version metadata | proposed | implementation | health.report |
| 5 | Test-only /test/* routes (reset, throw) gated off in production | proposed | implementation | testing.test_routes |
| 6 | Unit tests: request validation, header finalization, health builder, test-env guard | proposed | test:unit | platform.request_pipeline, health.report, testing.isolation |
| 7 | Integration tests: Worker request handling, health, SPA fallback, test-route gating, storage isolation | proposed | test:integration | platform.scaffold, platform.request_pipeline, health.report, testing.isolation, testing.test_routes |
| 8 | E2E: developer golden path and headers on a real document load | proposed | test:e2e | platform.scaffold, platform.request_pipeline |
| 9 | Deploy building blocks: migration safety scan, idempotency check, retry, health verification and release record | proposed | implementation | deploy.safety_scan, deploy.idempotency, deploy.retry, deploy.verify_record |
| 10 | Unit tests: safety scan, idempotency, retry, health verification, CSV formatting | proposed | test:unit | deploy.safety_scan, deploy.idempotency, deploy.retry, deploy.verify_record |
| 11 | Release command: bun deploy script orchestrating prechecks, scan, migrations, publish, verify, record | proposed | implementation | deploy.pipeline |
| 12 | Integration tests: release pipeline end to end with fake wrangler, real git, fs and health server | proposed | test:integration | deploy.pipeline, deploy.safety_scan, deploy.verify_record |

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
2. apps/api/vitest.config.ts: defineWorkersConfig, wrangler configPath ../../wrangler.toml (base env only), isolatedStorage true, setupFiles test/setup.ts which runs applyD1Migrations(env.DB, env.TEST_MIGRATIONS) and assertLocalTestEnv(env). Add a second project 'production-gate' with miniflare binding ENVIRONMENT=production for test-route gating tests.
3. apps/web/vitest.config.ts: happy-dom, @testing-library/react, MSW server in test/setup.ts (used by later stories).
4. scripts/vitest.config.ts: node pool for deploy tests (unit *.test.ts, integration *.int.test.ts).
5. playwright.config.ts: baseURL http://127.0.0.1:8787 (hard-coded), webServer `bun run dev` with reuseExistingServer false in CI, globalSetup e2e/global-setup.ts asserting /health environment === 'local'.
6. Root scripts: test:unit, test:integration, test:ui, test:e2e, test (all except e2e) — all run via bun -> vitest/playwright.
Depends on: scaffold task. Note: bun's own test runner is NOT used (cannot run in workerd).

### 3. Request pipeline: validation, request id, security headers, error handling, SPA fallthrough

Plan (design: platform.request_pipeline):
1. lib/errors.ts: ErrorCode union (validation, not_found, forbidden_client, gone, internal, method_not_allowed, unsupported_media_type, payload_too_large) + errorResponse(code, status, message?).
2. middleware/request-id.ts: crypto.randomUUID per request, stored on context.
3. middleware/validate.ts: validateRequest + hasBody (Content-Length > 0 or Transfer-Encoding present). Check order: method (GET/HEAD/POST/PATCH/DELETE else 405) -> mutations ALWAYS need X-Todoodle-Client: web (else 403, even bodyless) -> body cap MAX_BODY_BYTES via Content-Length AND bounded stream read (413) -> Content-Type application/json required ONLY when hasBody (else 415). Bodyless POST/DELETE (forget, complete, reopen, restore) must pass without Content-Type.
4. middleware/security-headers.ts: finalizeResponse — nosniff, DENY, CSP default-src 'self'; connect-src 'self' wss:; frame-ancestors 'none', Referrer-Policy no-referrer (overrides handler value), X-Request-Id; Cache-Control no-store only for /api, /health, /test.
5. app.ts order: request-id -> validate -> routes -> /api/* 404 not_found -> ASSETS.fetch fallthrough -> finalize; app.onError -> 500 internal, logs name/message/stack/requestId/method/path only (never headers, cookies, body).
Depends on: scaffold.

### 4. Health endpoint on /health and /api/health with injected version metadata

Plan (design: health.report):
1. routes/health.ts: buildHealth(env) -> {status:'ok', environment: ENVIRONMENT ?? 'local', version: APP_VERSION ?? 'dev', git_sha: GIT_SHA ?? 'dev', deployed_at: DEPLOYED_AT ?? null}. No D1 access.
2. Register GET on both /health and /api/health (same handler; byte-identical bodies).
3. Env vars APP_VERSION, GIT_SHA, DEPLOYED_AT are injected by deploy via `wrangler deploy --var` (deploy.pipeline task); nothing in [vars].
Depends on: request pipeline.

### 5. Test-only /test/* routes (reset, throw) gated off in production

Plan (design: testing.test_routes):
1. routes/test.ts: Hono sub-app mounted at /test with a gate middleware — if ENVIRONMENT === 'production' return the exact same 404 {error:'not_found'} as an unknown API route, before any handler.
2. POST /test/reset: deletes rows from tables in exported TEST_RESET_TABLES (ordered children-first; empty in story 1; stories 2/5/7 append workspaces/tasks/projects).
3. GET /test/throw: throws (used by TC-P13 to prove error bodies/logs contain no secrets).
Depends on: request pipeline. Later stories add seed routes here.

### 6. Unit tests: request validation, header finalization, health builder, test-env guard

Implements design test cases:
- TC-P01..TC-P10 and TC-P18..TC-P21 (validateRequest classes a-g and boundaries incl. exactly MAX_BODY_BYTES vs +1, chunked oversize, 405/403/413/415; bodyless POST/DELETE with client header and no Content-Type accepted; bodyless DELETE without client header 403; PATCH body without Content-Type 415; hasBody truth table; finalizeResponse header set/override; request id uniqueness).
- TC-H01, TC-H02 (buildHealth with and without injected vars).
- TC-I01..TC-I05 (assertLocalTestEnv local/staging/production/missing; Playwright globalSetup rejects non-local health via injected fetch).
Negative assertions: rejected requests never reach handler (spy counter before/after = 0).

### 7. Integration tests: Worker request handling, health, SPA fallback, test-route gating, storage isolation

SELF.fetch against real Miniflare D1 + ASSETS (built dist fixture in globalSetup). Implements:
- TC-P11..TC-P16 (headers on API, 404 api unknown, 500 without stack and without cookie/body in captured logs, SPA /, /w, oversize rejected before routing, hashed assets not no-store).
- TC-H03..TC-H06 (/health, /api/health identical, POST 405, staging vars override).
- TC-C01, TC-C02 (index served, deep-link fallback).
- TC-I06, TC-I07 (isolated storage between tests, ENVIRONMENT local).
- TC-T01..TC-T05 (reset local/staging clears scratch table before 3 -> after 0; production 404 identical to unknown route with rows unchanged; production /test/throw 404; unknown test route 404).
Nothing mocked: D1 and ASSETS are real Miniflare bindings.

### 8. E2E: developer golden path and headers on a real document load

Playwright against `bun run dev` (wrangler dev :8787) with fresh .wrangler state. Implements:
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


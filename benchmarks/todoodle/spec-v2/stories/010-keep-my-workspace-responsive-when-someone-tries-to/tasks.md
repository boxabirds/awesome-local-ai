# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Verify binding support locally, configure rate-limit bindings per environment, and build the RateLimiter wrapper | proposed | implementation | ratelimit.limiter |
| 2 | Derive hashed, daily-rotating network keys and guard the rate-limit secret at deploy | proposed | implementation | ratelimit.client_key |
| 3 | Add daily creation counter (migration 0006), cron cleanup and the seed-rate-counter test route | proposed | implementation | ratelimit.daily_counter |
| 4 | Define the one 429 rate_limited contract (D-23), shared schema and privacy-safe logging | proposed | implementation | ratelimit.response |
| 5 | Enforce creation limits and failed-open limits on the workspace endpoints | proposed | implementation | ratelimit.create_policy, ratelimit.open_policy |
| 6 | Cap changes per workspace with middleware after workspace-auth | proposed | implementation | ratelimit.mutation_policy |
| 7 | Limit live connection attempts per network, cap sockets per room (accept then close 4429), and add the live force-close test route | proposed | implementation | ratelimit.live_policy |
| 8 | SPA: RateLimitedError (by body.error), useCountdown, formatWait, retry predicate and throttle copy | proposed | implementation | web.throttle_core |
| 9 | SPA: self-resolving throttle experience for create, open (ApiErrorBoundary state) and saving changes (waiting status, allowlisted retries) | proposed | implementation | web.throttle_feedback |
| 10 | Unit tests: network keys, limiter wrapper, config parity, 429 contract, SPA error and countdown | proposed | test:unit | ratelimit.client_key, ratelimit.limiter, ratelimit.daily_counter, ratelimit.response, web.throttle_core |
| 11 | Integration tests: creation limits, daily counter (0006), cleanup, failed-open limits incl. previous secret, test routes and 429 contract | proposed | test:integration | ratelimit.limiter, ratelimit.daily_counter, ratelimit.create_policy, ratelimit.open_policy, ratelimit.response |
| 12 | Integration tests: per-workspace change limits (scope mutations, PUT 405) and live connection limits (accept then close 4429, force-close route) | proposed | test:integration | ratelimit.mutation_policy, ratelimit.live_policy |
| 13 | UI component tests: create/open cooldowns, TooManyAttempts boundary state, waiting rows and toast, and proof that rotation/reschedule/non-429 are never retried | proposed | test:ui-component | web.throttle_core, web.throttle_feedback |
| 14 | E2E tests: create cooldown, daily limit, bad-link throttling, throttled saves and live 4429 recovery | proposed | test:e2e | ratelimit.create_policy, ratelimit.open_policy, ratelimit.mutation_policy, ratelimit.live_policy, web.throttle_feedback |

## Details

### 1. Verify binding support locally, configure rate-limit bindings per environment, and build the RateLimiter wrapper

Depends on story 1 (scaffold, wrangler.toml, test harness).

1. **Spike first (half day max).** Pin wrangler to 4.36.0 or later. Add one `[[ratelimits]]` binding and check whether (a) `wrangler dev` and (b) vitest-pool-workers simulate `limit()`, and whether per-key counting works. Record the result in the task feedback.
   - If supported: integration tests use the real simulation.
   - If not: add `apps/api/test/helpers/fakeRateLimiter.ts`, an in-memory implementation of the same `{limit({key}) -> {success}}` shape, injected through the vitest `miniflare` bindings override for tests only.
2. **Bindings.** Add four bindings for each env: CREATE_LIMITER, OPEN_FAIL_LIMITER, CHANGE_LIMITER and LIVE_CONNECT_LIMITER. Use namespace ids 1001–1004 for local, 2001–2004 for staging and 3001–3004 for production. Ids must not be shared, because counters are shared across Workers on the same account. Limits and periods must equal the constants.
3. **Constants.** Add them to `packages/shared/src/limits.ts`: RATE_BURST_PERIOD_S, WORKSPACE_CREATE_BURST_LIMIT, WORKSPACE_CREATE_DAILY_LIMIT, OPEN_FAIL_BURST_LIMIT, WORKSPACE_CHANGE_BURST_LIMIT, LIVE_CONNECT_BURST_LIMIT, LIVE_MAX_CONNECTIONS_PER_WORKSPACE, LIVE_ROOM_FULL_RETRY_S, RATE_COUNTER_RETENTION_DAYS, IPV6_KEY_PREFIX_HEXTETS, RATE_KEY_LENGTH, THROTTLED_SAVE_MAX_RETRIES, SECONDS_PER_MINUTE and MS_PER_SECOND (unless an earlier story already defines them). `LIVE_CLOSE_RATE_LIMITED` (4429) is story 4's close-code constant (D-22): import it, do not redefine it.
4. **Wrapper.** `rateLimiter.ts` provides `limiterFor(env, name)`. It returns allowed / refused (retryAfterSeconds = RATE_BURST_PERIOD_S) / degraded. If the binding throws or is missing it fails open and logs `ratelimit_unavailable`.
5. Add the optional bindings to `Env`.

### 2. Derive hashed, daily-rotating network keys and guard the rate-limit secret at deploy

Implement `clientKey(req, env, scope, now)` in `apps/api/src/lib/rateKey.ts` with Web Crypto HMAC-SHA256:
- **Where the address comes from:** the `CF-Connecting-IP` header. If it's absent, use the literal `unknown`.
- **IPv4-mapped IPv6** is converted to IPv4.
- **IPv6** is truncated to its first `IPV6_KEY_PREFIX_HEXTETS` hextets, after expanding `::`.
- **Salt:** daily salt = HMAC(RATE_LIMIT_SECRET, UTC YYYY-MM-DD). Key = base64url(HMAC(salt, `${scope}:${prefix}`)), truncated to `RATE_KEY_LENGTH`.
- **Test header:** outside production, the `X-Test-Rate-Key` header gives the key `test:<value>`. Production ignores the header.
- **Missing secret in production:** fall back to the environment name as key material and log `rate_secret_missing` once per isolate.

Add `RATE_LIMIT_SECRET` to `Env`, set via `wrangler secret put`.

Extend story 1's `scripts/deploy.ts` prechecks. For staging and production, `wrangler secret list --env X` must include `RATE_LIMIT_SECRET`, otherwise production deploys are blocked and staging deploys warn.

Document secret setup in the README.

Never log the IP or the secret.

### 3. Add daily creation counter (migration 0006), cron cleanup and the seed-rate-counter test route

- **Migration** `0006_rate_counters.sql` (numbered by build order, D-32: 0005 is story 9's rotation, 0007 is story 11's search text):
  - table `rate_counters(scope, key_hash, window, count, created_at)`, primary key `(scope, key_hash, window)`, plus an index on `window`;
  - no CHECK constraints, so it passes story 1's safety scan.
- **`rateCounters.ts`:**
  - `incrementDaily`: a single `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`. `window` is the UTC date from the pure helper `utcWindow(now)` in `apps/api/src/lib/rateWindow.ts`. A D1 error returns `{degraded: true}` and logs.
  - `cleanupRateCounters(db, now)` deletes windows older than `RATE_COUNTER_RETENTION_DAYS`.
- **Cron:** `scheduled.ts` is exported from `index.ts`. `wrangler.toml` gets `[triggers] crons = ["17 3 * * *"]` in every env. Errors are logged and swallowed.
- **Test route (D-35):** `/test/seed-rate-counter {scope, testKey, count, window?}` registered in story 1's `/test/*` registry (`apps/api/src/routes/test.ts`), owner story 10; 404 in production through story 1's gating. It writes the row for the key `clientKey` derives from `X-Test-Rate-Key: <testKey>`.
- **Architecture doc:** §5 already lists `0006_rate_counters.sql`; no repo doc change needed.
- **Depends on:** story 1 (migrations, test routes registry, scheduled export), story 9 (migration 0005 precedes this one).

### 4. Define the one 429 rate_limited contract (D-23), shared schema and privacy-safe logging

**Build order (§13 rule 4):** story 9 is built before story 10. Story 9 CREATES `rateLimitedResponse` and `rateLimitedSchema` to this contract, with the `rotation_cooldown` scope only. This task EXTENDS them: it adds the remaining scopes, the daily-reset helper and refusal logging. Extend the existing code; don't recreate it. Story 10 still owns the contract below.

This is the single 429 shape for all of Todoodle (owner story 10, D-23).

`rateLimitedResponse(c, scope, retryAfterSeconds, logKey?)`:
- status 429
- `Retry-After` header, whole seconds, equal to the body value
- body `{error: 'rate_limited', scope, retryAfterSeconds, message}`, validated by the zod `rateLimitedSchema` in shared. There is no `resetAt`; clients derive clock times as `now + retryAfterSeconds`.

Scopes (`RATE_LIMIT_SCOPES` in `packages/shared/src/schemas.ts`): `create_burst`, `create_daily`, `open_attempts`, `mutations`, `live_connect` (close-code transport only, never an HTTP 429), `rotation_cooldown` (added by story 9).

- **Daily reset:** pure helper `secondsUntilNextUtcMidnight(now)` in `apps/api/src/lib/rateWindow.ts` gives `retryAfterSeconds` for `create_daily`.
- **Headers:** the response goes through story 1's `finalizeResponse`.
- **Logging:** one structured log line per refusal, `{event, scope, keyPrefix(6), requestId}`. Never log the IP, secret, cookie, body or query.
- Every 429 produced anywhere (stories 9 and 10) must be built by this function; no other 429 shape exists.

### 5. Enforce creation limits and failed-open limits on the workspace endpoints

Depends on story 2 (create and open endpoints), story 9 (the 410 previous-secret branch of open) and tasks 10.1–10.4.

**`enforceCreateLimits(c)`:**
- CREATE burst limiter on `clientKey('create')` → on refusal, 429 `create_burst` (retryAfterSeconds = RATE_BURST_PERIOD_S);
- then `incrementDaily` → if count exceeds `WORKSPACE_CREATE_DAILY_LIMIT`, 429 `create_daily` with retryAfterSeconds = seconds until the next UTC midnight (no `resetAt` field);
- if a limiter degrades, continue.

Call it after story 1's validate pipeline and before any workspace is created, so a refused request creates no row and sets no cookie.

**`onOpenFailure(c, outcome: 'miss' | 'previous_secret')`:**
- called on a lookup miss **and** on story 9's previous-secret match (410 `link_changed`), which counts as a failed attempt (D-34); both share one OPEN_FAIL budget on `clientKey('open_fail')`;
- if refused, return 429 `open_attempts`;
- otherwise return the unchanged 404 or 410.

A hit on the current secret never calls the limiter.

The 429 body carries no workspace information (only `error`, `scope`, `retryAfterSeconds`, `message`). All 429s are built with `rateLimitedResponse`.

### 6. Cap changes per workspace with middleware after workspace-auth

Depends on story 1 (validate pipeline), story 2 (workspace-auth) and task 10.1.

- **What it does:** the `changeLimit` middleware covers **POST, PATCH and DELETE** under `/api/w/:workspaceId/*`. PUT is deliberately not listed: story 1 rejects it with 405 before auth (D-44). It calls the CHANGE_LIMITER keyed `ws:<id>`, and refuses with 429 scope `mutations` (D-23, via `rateLimitedResponse`) before the handler runs, so nothing is written or broadcast.
- **Placement:** register it in `app.ts` after workspace-auth, so unauthenticated calls can't spend a workspace's budget.
- **Not counted:** GET requests and the live upgrade.
- **Bulk operations:** each bulk endpoint counts as one change.
- **Stories 5–9** inherit the middleware and need no route changes (story 9's rotation POST is counted too; its own cooldown is story 9's `rotation_cooldown` 429).

### 7. Limit live connection attempts per network, cap sockets per room (accept then close 4429), and add the live force-close test route

Depends on story 4 (the live route, WorkspaceRoom, `LiveConnection.ts` and the close-code constants incl. `LIVE_CLOSE_RATE_LIMITED`), story 1 (test route registry) and task 10.1.

Conform to story 4's `/live` rejection contract (D-22): the server **always accepts, then closes**; `/live` never answers with HTTP 429, and story 10 adds no pre-upgrade status.

**Live route** (after story 4's accept, origin 4403, auth 4404 and story 9's 4410 checks):
- apply the LIVE_CONNECT limiter on `clientKey('live_connect')`;
- if refused, close the accepted socket with 4429 and reason `String(RATE_BURST_PERIOD_S)`;
- the request never reaches the Durable Object.

**WorkspaceRoom:**
- if `ctx.getWebSockets().length >= LIVE_MAX_CONNECTIONS_PER_WORKSPACE`, accept then close with 4429 and reason `String(LIVE_ROOM_FULL_RETRY_S)`;
- existing sockets are left alone;
- add a test-only `forceClose(code, reason)`.

**Test route (D-35):** `/test/live/force-close {workspaceId, code}` in story 1's `apps/api/src/routes/test.ts` registry, owner story 10; 404 in production. Closes every socket in the room with `code` (4000–4999 only, else 400 `validation`).

**Client:** story 4's `features/live/LiveConnection.ts` owns the 4429 branch (live paused, wait ≥ reason seconds plus jitter, editing on). Do not edit it here; verify it end to end in TC-E05 and raise a story-4 defect if it does not behave.

Architecture §7 already lists 4429; no repo doc change needed.

### 8. SPA: RateLimitedError (by body.error), useCountdown, formatWait, retry predicate and throttle copy

Depends on story 2 (`lib/errors.ts` map), story 9 and task 10.4 (`rateLimitedSchema`).

**Build order (§13 rule 4):** story 9 is built before story 10 and CREATES these, to this contract:
- the `rate_limited` → `RateLimitedError` registration;
- `useCountdown`;
- `formatWait`.

This task EXTENDS them: it adds `retryAfterMs`, the retry predicate, the `waiting` derivation and `THROTTLE_COPY` for every scope. Extend the existing code; don't recreate it. Story 10 still owns the contract.

- **`lib/errors.ts` (story 2's map, D-20):** register `rate_limited` → `RateLimitedError{scope, retryAfterSeconds, retryAfterMs}` **by `body.error === 'rate_limited'` only**, parsing with the shared `rateLimitedSchema`.
  - Never map by status 429 alone: a 429 with another, empty or non-JSON body stays `ApiError`.
  - `retryAfterSeconds` = the Retry-After header if it is a positive integer, else the body value.
  - It is not a network or offline error, so story 4's `useCanEdit()` is unaffected.
- **`useCountdown(untilMs)`:** a single `setTimeout` chain aligned to whole seconds, cleaned up on unmount, returning `{secondsLeft, done}`.
- **`formatWait(seconds)`:** "N second(s)" under `SECONDS_PER_MINUTE`, otherwise minutes rounded up, "N minute(s)".
- **`rateLimitRetry.ts` (D-24):**
  - `RetryableOp` union and `RATE_LIMIT_RETRYABLE_OPS` = task.create, project.create, task.update, task.complete, task.reopen, task.delete, task.restore, task.move.
  - `rateLimitRetry(op)` returns `{retry, retryDelay}`. It retries only for `RateLimitedError` while `failureCount < THROTTLED_SAVE_MAX_RETRIES`, with delay = `retryAfterMs`.
  - `isWaitingOnRateLimit(mutation)` derives `waiting`.
  - There is no global QueryClient retry predicate; the default stays `retry: false`.
  - Workspace create, rotation, reschedule and due-date restore are not in the union, so they cannot opt in.
- **`messages.ts`:** `THROTTLE_COPY` (plain-language copy per scope, from the story 10 PRD UX section, including `waitingToSave`) and `messageFor(error, now)`.
- Direct imports only (§12). No magic numbers: use `MS_PER_SECOND` and `SECONDS_PER_MINUTE`.

### 9. SPA: self-resolving throttle experience for create, open (ApiErrorBoundary state) and saving changes (waiting status, allowlisted retries)

Depends on stories 2, 3, 5 and 6 (landing start component, `ApiErrorBoundary`, `RememberedRecovery`, `TaskRow` localStatus, `features/tasks/mutations.ts`) and task 10.8. File paths for story 2's boundary and landing component follow whatever story 2's design names (D-33 requires story 2 to name the landing start component; `LandingStart.tsx` here).

- **Create (story 2's landing start component, replaces the stale `StartButton.tsx`):**
  - `create_burst` → a `ThrottleNotice` with `useCountdown` + `formatWait`, and the Start button disabled until the countdown finishes;
  - `create_daily` → the reset time `now + retryAfterSeconds` in the viewer's local time, via the shared `Intl` formatter, with no ticking countdown;
  - workspace create is **never** retried automatically (D-24); the remembered workspaces list stays usable throughout.
- **Open (D-20):** a `RateLimitedError` from the boot open reaches story 2's `ApiErrorBoundary`, whose `RateLimitedError` branch renders story 10's `TooManyAttempts` state with countdown and story 3's `RememberedRecovery`; at zero it resets the boundary, re-issuing the open once. A 429 without a `rate_limited` body falls through to `WorkspaceLoadFailed`.
- **Saving changes (D-24, D-33, D-06):**
  - in story 6's `features/tasks/mutations.ts` (not `taskMutations.ts`), task create, PATCH, complete, reopen, delete, restore and move spread `...rateLimitRetry(op)`; story 7's project create does the same;
  - optimistic creates get `localStatus: 'waiting'` (derived with `isWaitingOnRateLimit`) on story 5's `TaskRow`: cell 2 status text `THROTTLE_COPY.waitingToSave`, `aria-busy`, no Retry/Discard in cell 3 while waiting; never rolled back; when retries run out → story 5's `failed` with Retry/Discard;
  - other allowlisted mutations keep their optimistic value and show the "Waiting to save…" toast (one per workspace per wait, id `throttle:<ws>`, via `waitingToast.ts`); exhausted → the owning story's `onError`;
  - rotation (9), reschedule and due-date restore (8), workspace create (2) and every non-429 failure are never retried; their error paths may show `messageFor(error)`.
- **Accessibility:** messages use `role=status`, and screen-reader updates are throttled to `LIVE_ANNOUNCE_THROTTLE_MS`.

### 10. Unit tests: network keys, limiter wrapper, config parity, 429 contract, SPA error and countdown

This task implements TC-U01 to TC-U27 from the story 10 design, plus the `utcWindow(now)` boundary checks used by the daily counter:
- 23:59:59.999 UTC maps to day D
- 00:00:00.000 maps to day D+1

TC ids: TC-U01, TC-U02, TC-U03, TC-U04, TC-U05, TC-U06, TC-U07, TC-U08, TC-U09, TC-U10 (network keys); TC-U11, TC-U12, TC-U13, TC-U14 (limiter and config parity); TC-U15, TC-U16, TC-U17, TC-U18 (429 contract: exact scope list, Retry-After equals body, no `resetAt`, logging); TC-U19, TC-U20, TC-U21, TC-U22, TC-U23 (client mapping by `body.error` only, header vs body, countdown, not offline); TC-U24 (`formatWait`); TC-U25, TC-U26, TC-U27 (retry predicate: allowlist retries, non-429 never retried, rotation/reschedule/due-date restore/workspace create factories never opt in). Negative scenarios TC-N05, TC-N08, and the unit half of TC-N09/TC-N10.

Fixtures:
- **IP addresses:** documentation ranges only — 203.0.113.7, 2001:db8:abcd:12::1 and ::ffff:198.51.100.4.
- **Limiter:** the fake limiter, since these are pure units.
- **Wrangler config:** TC-U14 parses the real wrangler.toml.
- **429 bodies:** built with the real `rateLimitedSchema` / `rateLimitedResponse`.
- **TC-U27:** imports the real mutation option factories of stories 2, 8 and 9, not copies.
- **Time:** fake timers wherever the clock matters.

Run with `bun run test:unit`.

### 11. Integration tests: creation limits, daily counter (0006), cleanup, failed-open limits incl. previous secret, test routes and 429 contract

This task implements TC-I01, TC-I02, TC-I03, TC-I04, TC-I05, TC-I06, TC-I07, TC-I08, TC-I08b, TC-I09, TC-I10, TC-I11, TC-I12, TC-I13, TC-I14, TC-I24, TC-I25, TC-I26 and the `/test/seed-rate-counter` half of TC-I27, plus TC-N01, TC-N02 and TC-N07.

**Test setup:**
- Requests go through `SELF.fetch`, against real Miniflare D1 with migrations 0001–0006 applied (D-32; TC-I09 applies `0006_rate_counters.sql` to a DB holding 0001–0005 and checks story 11's 0007 still applies after it).
- The rate-limit binding is the real simulation, or the fake if task 10.1 found none. State which one was used in the test file header.
- Each test uses a unique `X-Test-Rate-Key`.
- Daily counts are seeded through `/test/seed-rate-counter` (story 1 registry, D-35). Rotated workspaces for TC-I26 are seeded through `/test/seed-workspace {rotatedSecondsAgo}`.

**Checks:**
- Assert the D1 state before and after each case: workspace row count, rate_counters rows and their count, and that no Set-Cookie is sent on a refusal.
- TC-I06 fires 25 creates in parallel with `Promise.all` and asserts the final count is exactly 25.
- TC-I08b forces the D1 delete to fail through a test hook.
- TC-I24 and the production half of TC-I27 run with `ENVIRONMENT=production` configured in a second miniflare instance (test routes → 404).
- TC-I25: every HTTP 429 body passes `rateLimitedSchema` and `Retry-After` equals `retryAfterSeconds`.
- TC-I26: misses and previous-secret (410) opens share one budget (D-34).

### 12. Integration tests: per-workspace change limits (scope mutations, PUT 405) and live connection limits (accept then close 4429, force-close route)

This task covers TC-I15, TC-I16, TC-I17, TC-I18, TC-I19, TC-I20, TC-I21, TC-I22, TC-I23, TC-I28 and the `/test/live/force-close` half of TC-I27, plus TC-N03, TC-N04 and TC-N11, using real D1 and the real WorkspaceRoom Durable Object.

- **Change limits (TC-I15 to TC-I16):** send 600 and then 601 real PATCH requests to one workspace. The 601st is 429 with scope `mutations` (D-23). Assert the task's version and name are unchanged and that no live event was broadcast. Check the broadcast with a socket connected to the room.
- **Other workspace (TC-I17)** and **unauthenticated requests (TC-I18):** send them to workspace A, then confirm A's budget is still intact.
- **Reads (TC-I19):** send 700 GET requests and expect none to be refused.
- **PUT (TC-I28, D-44):** PUT returns story 1's 405 `method_not_allowed`, never 429, and spends no budget.
- **Room cap (TC-I20 to TC-I22):** open 100 sockets through `SELF.fetch` upgrades. The 101st upgrade is accepted (101) then closed with 4429 and reason "30" — never an HTTP 429 (D-22).
- **Connection-rate limit (TC-I23):** use a test key. The 61st attempt is accepted then closed with 4429 and reason "60", and the room's socket count stays unchanged.
- **Force-close route (TC-I27, D-35):** `/test/live/force-close {code:4429}` closes both open sockets with 4429 reason "60"; code 1000 → 400; production → 404.

### 13. UI component tests: create/open cooldowns, TooManyAttempts boundary state, waiting rows and toast, and proof that rotation/reschedule/non-429 are never retried

This task implements TC-C01, TC-C02, TC-C03, TC-C04, TC-C05, TC-C06, TC-C07, TC-C08, TC-C09, TC-C10, TC-C11, TC-C12, TC-C13, TC-C14 and TC-C15, plus TC-N06 and the ui-component half of TC-N09/TC-N10, using vitest, happy-dom and Testing Library.

- **Mocked API:** MSW returns real 429 bodies built from the shared `rateLimitedSchema`, with a Retry-After header. MSW request counters prove how many requests each mutation sent.
- **Real client wiring:** the real QueryClient defaults and the real mutation option factories (story 6's `features/tasks/mutations.ts`, story 8's reschedule, story 9's rotation, story 2's create), not copies.
- **Time:** fake timers drive the countdowns.
- **Copy:** assert `THROTTLE_COPY` constants, not literal text (§13 rule 3).

Assertions:
- the Start button (story 2's landing start component) is disabled while the countdown runs, re-enabled when it finishes, and the create is sent exactly once (TC-C15);
- the daily message shows the viewer's local time for the time zones Europe/London and America/Los_Angeles;
- `ApiErrorBoundary` renders TooManyAttempts with `RememberedRecovery` for a `rate_limited` open and re-issues the open once at zero; a 429 with `{error:'internal'}` renders `WorkspaceLoadFailed` instead (TC-C14);
- creates waiting to save have `localStatus` `waiting`, keep their text, have `aria-busy` and no Retry/Discard;
- only one toast appears for 3 throttled rows;
- when retries run out, the created row shows Retry and Discard;
- a throttled complete stays completed on screen and saves after the wait (TC-C10);
- rotation (`rotation_cooldown`) and reschedule 429s send exactly one request after 3× the wait (TC-C11, TC-C12);
- PATCH 500, network error and 429-without-`rate_limited`-body send exactly one request (TC-C13);
- `role=status` updates are throttled.

### 14. E2E tests: create cooldown, daily limit, bad-link throttling, throttled saves and live 4429 recovery

This task covers TC-E01, TC-E02, TC-E03, TC-E04 and TC-E05, using Playwright against wrangler dev with a fresh local D1 (migrations 0001–0007), on story 1's Playwright matrix (D-36).

**Fixture:** give each test its own `X-Test-Rate-Key`, using `extraHTTPHeaders` or `page.route`.

**Tests:**
- **TC-E01:** create 21 times through the UI. Advance the Playwright clock by 60 seconds, then confirm the Start button works again (and that no create was sent automatically).
- **TC-E02:** seed the daily counter through `/test/seed-rate-counter` (D-35), then check the local reset time is shown and that a remembered workspace still opens.
- **TC-E03:** try 21 bad links, then a valid link. The 21st shows the TooManyAttempts error state with the remembered list; the valid link opens immediately.
- **TC-E04:** use route interception to return a real `rate_limited` 429 body (scope `mutations`) with Retry-After on the tasks endpoint. This is deliberate: the real 600-change limit is covered by TC-I15 and TC-I16. Check "Waiting to save…", then that the task is saved, and that it is still there after a reload.
- **TC-E05:** a second browser context gets its live socket closed with 4429 through `/test/live/force-close {code:4429}` (D-35). Check that "Reconnecting…" shows, that editing is still possible, and that live updates resume after the wait.

Local limits are the same as production. Tests stay isolated through their test keys only; the limits are never relaxed.


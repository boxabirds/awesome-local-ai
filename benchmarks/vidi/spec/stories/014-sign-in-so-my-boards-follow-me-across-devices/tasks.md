# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Write auth server unit tests first: mode guard, config parity, token claims, origin/cookie/refresh, claim merge (TC-01 to TC-07) | proposed | test:unit | auth.mode_guard, auth.google_verify, auth.sessions, auth.board_memory |
| 2 | Implement D1 auth schema, auth mode guard, config endpoint and local email sign-in route | proposed | implementation | auth.mode_guard |
| 3 | Implement Google ID token verification and POST /api/auth/google with rate limiting | proposed | implementation | auth.google_verify |
| 4 | Implement sessions: hashed tokens in D1, /api/me with sliding refresh and expiry, sign-out, same-origin middleware | proposed | implementation | auth.sessions |
| 5 | Implement board visits, guest board claiming, recent boards API and boards rows on creation | proposed | implementation | auth.board_memory |
| 6 | Integration tests: mode guard, Google verification route, sessions and cross-site refusal against real D1 (TC-09 to TC-21) | proposed | test:integration | auth.mode_guard, auth.google_verify, auth.sessions |
| 7 | Integration tests: visits, guest claiming, recent boards and unauthenticated board access (TC-22 to TC-27) | proposed | test:integration | auth.board_memory |
| 8 | Write guest board list unit tests first (TC-08) | proposed | test:unit | auth.client |
| 9 | Implement client auth: useAuth, Google sign-in with One Tap on home only, local email form, account menu, identity switch, recent boards, sign-in page | proposed | implementation | auth.client |
| 10 | Component tests for sign-in UI, One Tap placement, failures, account menu, recent boards, expiry notice and identity switch (TC-28 to TC-36, TC-43) | proposed | test:ui-component | auth.client |
| 11 | E2E sign-in workflows in local email mode plus production-config refusal (TC-37 to TC-42) | proposed | test:e2e | auth.mode_guard, auth.board_memory, auth.client |

## Details

### 1. Write auth server unit tests first: mode guard, config parity, token claims, origin/cookie/refresh, claim merge (TC-01 to TC-07)

## Goal
Test-first unit suites for the pure parts of four server capabilities, with stub exports throwing `not implemented`.

## Setup
- Add `jose`. Add story 14 named settings to `config.ts` (SESSION_TTL_DAYS, SESSION_REFRESH_INTERVAL_HOURS, SESSION_TOKEN_BYTES, SESSION_COOKIE, RECENT_BOARDS_LIMIT, GUEST_BOARDS_MAX, GIS_LOAD_TIMEOUT_MS, SIGN_IN_BUDGET_MS, IDENTITY_PROPAGATION_BUDGET_MS, AUTH_ATTEMPT_LIMIT, AUTH_ATTEMPT_PERIOD_SECONDS, TOKEN_CLOCK_SKEW_SECONDS, DEFAULT_BOARD_TITLE, GOOGLE_ISSUERS).
- `tests/fixtures/google-tokens.ts`: per-run RSA key pair, `JwksProvider` fake, factory for Google-shaped claims (sub, email, email_verified, name, picture, iss, aud, exp, iat).

## auth.mode_guard — `resolveAuthMode(env, url)` contract
- TC-01: all 12 combinations of AUTH_MODE {google, dev-email} × ENVIRONMENT {local, production} × host {localhost, 127.0.0.1, vidi6.example}; `dev-email` only for dev-email + local + loopback host (negative: the other 10 are `google`).
- TC-02: parse `wrangler.jsonc` — top-level vars AUTH_MODE `google`, ENVIRONMENT `production`; only `env.local` contains `dev-email`.

## auth.google_verify — `verifyGoogleToken(token, jwks, clientId, now)` contract
- TC-03: valid → claims; exp past within TOKEN_CLOCK_SKEW_SECONDS → accepted (boundary); beyond skew → `expired`; wrong iss → `bad_issuer`; wrong aud → `bad_audience`; email_verified false → `email_unverified`; tampered signature → `invalid_signature`; `alg: none` → rejected.

## auth.sessions — `isSameOrigin`, `needsRefresh`, `sessionCookie`, `clearCookie`
- TC-04 Origin same / foreign / missing / `null` → only same true.
- TC-05 needsRefresh at SESSION_REFRESH_INTERVAL_HOURS −1 min / +1 min → false / true.
- TC-06 cookie attributes HttpOnly, SameSite=Lax, Path=/, Max-Age = SESSION_TTL_DAYS seconds, Secure only when https; clear → Max-Age=0.

## auth.board_memory — `mergeClaims(items)`
- TC-07 duplicates keep later lastOpenedAt; malformed board ids dropped; exactly GUEST_BOARDS_MAX accepted; GUEST_BOARDS_MAX + 1 → `too_many`.

## Done when
All suites compile and fail only with "not implemented"; committed.

### 2. Implement D1 auth schema, auth mode guard, config endpoint and local email sign-in route

## Goal
Implement auth.mode_guard per contract so the email-only mode can only ever run in local builds.

## Approach
- `migrations/0001_auth.sql`: users, sessions, boards, board_visits tables + `board_visits_recent` index (design schema).
- `wrangler.jsonc`: D1 binding `DB`; `ratelimits` `AUTH_LIMITER` (AUTH_ATTEMPT_LIMIT / AUTH_ATTEMPT_PERIOD_SECONDS); top-level vars `AUTH_MODE=google`, `ENVIRONMENT=production`, `GOOGLE_CLIENT_ID`; `env.local.vars` `AUTH_MODE=dev-email`, `ENVIRONMENT=local`. `npm run dev` uses `--env local`; deploy script never does.
- `vitest.config.ts` integration project applies D1 migrations.
- `mode.ts`: `resolveAuthMode(env, url)` = `dev-email` only when AUTH_MODE is dev-email AND ENVIRONMENT is local AND hostname is `localhost`/`127.0.0.1`; else `google`.
- `routes.ts`: `GET /api/auth/config` → `{mode:'google', googleClientId}` or `{mode:'dev-email'}`. `POST /api/auth/dev-sign-in`: first `resolveAuthMode` → not dev-email → 404 before reading body; Origin check → 403; invalid email → 400; else `upsertUser('dev', lowercased email, {name: local part})` + session via auth.sessions → 200 with cookie.
- `users.ts`: `upsertUser(db, provider, subject, profile, now)` using `ON CONFLICT (provider, provider_subject) DO UPDATE`.

## Done when
TC-01 and TC-02 pass; integration TC-09 to TC-12 (task 14.6) pass.

### 3. Implement Google ID token verification and POST /api/auth/google with rate limiting

## Goal
Implement auth.google_verify per contract: one server path for both the Sign in with Google button and One Tap credentials.

## Approach
- `google.ts`: `JwksProvider` interface; production provider wraps `createRemoteJWKSet('https://www.googleapis.com/oauth2/v3/certs')`. `verifyGoogleToken` = `jwtVerify(token, getKey, { issuer: GOOGLE_ISSUERS, audience: clientId, clockTolerance: TOKEN_CLOCK_SKEW_SECONDS, algorithms: ['RS256'], currentDate })`, then require `email_verified === true`. Map failures to `AuthError.reason`; JWKS fetch failure → `keys_unavailable`.
- Route `POST /api/auth/google { credential }`: Origin check (403) → `AUTH_LIMITER.limit({key: CF-Connecting-IP})` (429) → verify → `keys_unavailable` → 503 `google_keys_unavailable`; any other AuthError → 401 `sign_in_failed` (generic; reason logged server-side only) → `upsertUser('google', sub, {email, name, avatarUrl: picture})` (refreshes name/picture) → `createSession` → 200 `{user}` with cookie.

## Done when
TC-03 passes; integration TC-13 to TC-17 (task 14.6) pass.

### 4. Implement sessions: hashed tokens in D1, /api/me with sliding refresh and expiry, sign-out, same-origin middleware

## Goal
Implement auth.sessions per contract (sign-out, 30-day expiry, cross-site refusal).

## Approach
- `createSession`: SESSION_TOKEN_BYTES random → base64url token; store SHA-256 hex in `sessions` with `expires_at = now + SESSION_TTL_DAYS`, `last_refreshed_at = now`; return `sessionCookie(token, secure)`.
- `readSession(db, req, now)`: parse SESSION_COOKIE; missing → null; unknown hash → null + clearing cookie; `expires_at <= now` → delete row, null + clearing cookie; else if `needsRefresh` update `expires_at`/`last_refreshed_at`; return user.
- `deleteSession`: delete row by hash; return clearing cookie.
- `isSameOrigin`: `Origin` header must equal `new URL(req.url).origin`; missing or `null` → false. `requireSameOrigin` middleware returns 403 before handlers for every POST under `/api/auth/*`, `/api/me/*`, `/api/boards/:id/visit`.
- Routes: `GET /api/me` → `{user|null}` with any Set-Cookie; `POST /api/auth/sign-out` → 204 + clearing cookie.
- Cookie `Secure` only when request scheme is https.

## Done when
TC-04 to TC-06 pass; integration TC-18 to TC-21 (task 14.6) pass.

### 5. Implement board visits, guest board claiming, recent boards API and boards rows on creation

## Goal
Implement auth.board_memory per contract: boards follow the account across devices and guest boards are claimable, without ever gating board access.

## Approach
- `mergeClaims`: dedupe by boardId keeping later `lastOpenedAt`, drop ids failing `isValidBoardId`, `too_many` above GUEST_BOARDS_MAX.
- `recordVisit(db, userId, boardId, at)`: ensure `boards` row (`INSERT OR IGNORE` with DEFAULT_BOARD_TITLE) then `INSERT ... ON CONFLICT(user_id, board_id) DO UPDATE SET last_opened_at = max(last_opened_at, excluded.last_opened_at)`.
- `claimGuestBoards`: for each merged item, existence = `boards` row present or `BoardRoom.exists()` RPC (story 5); skip unknown; recordVisit; return count.
- `recentBoards(db, userId, limit)`: join boards, `ORDER BY last_opened_at DESC LIMIT ?` (index `board_visits_recent`).
- Routes: `POST /api/boards/:id/visit` (401 signed out, 404 unknown board, 204); `POST /api/me/claim-guest-boards` (400 too_many, 401, 200 {claimed}); `GET /api/me/boards?limit` capped at RECENT_BOARDS_LIMIT (401 signed out).
- Story 5 modification in `create-board.ts`: after `initialize()` insert `boards` row with `created_by` = session user or null; when signed in also `recordVisit`; D1 failure logged, creation still returns 201.
- Link access unchanged: no board/room/create handler reads the session to allow or deny.

## Done when
TC-07 passes; integration TC-22 to TC-27 (task 14.7) pass.

### 6. Integration tests: mode guard, Google verification route, sessions and cross-site refusal against real D1 (TC-09 to TC-21)

## Goal
Exercise the route contracts of auth.mode_guard, auth.google_verify and auth.sessions through the real Worker with real D1 (migrations applied), fake `JwksProvider`, injected clock.

## Helper
`auth-env.ts`: build env overrides (AUTH_MODE, ENVIRONMENT), request factory with Origin and host, D1 row inspectors.

## auth.mode_guard (`GET /api/auth/config`, `POST /api/auth/dev-sign-in`)
- TC-09 local + localhost → 200, user provider dev name `alex`, session row, cookie.
- TC-10 AUTH_MODE dev-email with ENVIRONMENT production on localhost → config `google`; dev-sign-in 404; users and sessions unchanged (negative).
- TC-11 local env but public host → 404, no rows (negative).
- TC-12 invalid email → 400, no rows.

## auth.google_verify (`POST /api/auth/google`)
- TC-13 valid token → 200; user row provider google; sessions stores hash, raw token absent.
- TC-14 same `sub` with new name/picture → same user id, fields updated.
- TC-15 expired / wrong aud / unverified → 401 each, no session (error paths).
- TC-16 JwksProvider throws → 503 `google_keys_unavailable`, no session.
- TC-17 AUTH_ATTEMPT_LIMIT + 1 requests same CF-Connecting-IP → last 429 (boundary).

## auth.sessions (`GET /api/me`, `POST /api/auth/sign-out`, middleware)
- TC-18 fresh session → user; clock past `expires_at` → null, clearing cookie, row deleted.
- TC-19 clock at refresh interval + 1 min → `expires_at` extended, `last_refreshed_at` updated.
- TC-20 sign-out → 204, row deleted, me null.
- TC-21 foreign, missing and `null` Origin on sign-out, google, claim and visit → 403 with session and visits unchanged (negative).

## Done when
All pass in `npm run test:integration`.

### 7. Integration tests: visits, guest claiming, recent boards and unauthenticated board access (TC-22 to TC-27)

## Goal
Verify auth.board_memory's routes and D1 effects with real D1 and real BoardRoom `exists()` RPC; boards created through story 5's `POST /api/boards`.

## Cases
- TC-22 visit an existing board that has no `boards` row → row created with DEFAULT_BOARD_TITLE; later visit updates `last_opened_at` (state before/after).
- TC-23 visit while signed out → 401; visit unknown board id → 404 (error paths).
- TC-24 claim 3 items: unknown board, board with a newer server-side visit, normal board → `{claimed: 2}`; unknown skipped; newer server time kept.
- TC-25 claim GUEST_BOARDS_MAX + 1 items → 400, no visits written (boundary, negative).
- TC-26 user A 12 visits, user B 3 → A's `GET /api/me/boards` returns exactly RECENT_BOARDS_LIMIT newest first, none of B's (isolation between users).
- TC-27 `POST /api/boards` signed in → `created_by` = user and visit row; signed out → `created_by` null, no visit; then `GET /api/boards/:id` and WebSocket upgrade with no cookie → 200 / 101 (link access unchanged, negative: no auth gate).

## Done when
All pass in `npm run test:integration`.

### 8. Write guest board list unit tests first (TC-08)

## Goal
Test-first coverage of the client's `guestBoards` contract (`recordGuestBoard`, `readGuestBoards`, `clearGuestBoards`) that underpins auth.client's guest-claiming behaviour (auth.claim_guest).

## Cases (TC-08)
- Record a new board → list has it first with its time.
- Re-record an existing board with a later time → moved to top, time updated, no duplicate.
- Record GUEST_BOARDS_MAX + 1 boards → length GUEST_BOARDS_MAX, oldest dropped (boundary).
- `localStorage` value is corrupt JSON → `readGuestBoards()` returns [] and the next record overwrites it (error path).
- `localStorage` throws (private mode/quota) → functions do not throw; read returns [] (negative: board page must never crash).
- `clearGuestBoards()` → empty list.

## Done when
Suite compiles against stubs and fails with "not implemented"; committed.

### 9. Implement client auth: useAuth, Google sign-in with One Tap on home only, local email form, account menu, identity switch, recent boards, sign-in page

## Goal
Implement auth.client per contract and requirement mapping.

## Approach
- `guestBoards.ts`: pass TC-08 (localStorage key `vidi6.guestBoards`, cap GUEST_BOARDS_MAX, tolerate corrupt/throwing storage).
- `useAuth`: load `/api/auth/config` and `/api/me`; states loading → guest | signedIn; `signInWithGoogle(credential)` / `signInWithEmail(email)` → signingIn → on 200 enter claiming: post `readGuestBoards()` to `/api/me/claim-guest-boards`, clear on success, keep on failure → signedIn. 401/403/429/503/network → guest with error `sign_in_failed`. `signOut()` → route, `google.accounts.id.disableAutoSelect()`, new guest identity; network failure keeps signedIn with `sign_out_failed`. `wasSignedIn` marker drives the one-time expiry notice.
- `GoogleSignIn({page})`: inject `https://accounts.google.com/gsi/client` once; wait up to GIS_LOAD_TIMEOUT_MS for `google.accounts.id` else show unavailable message; `initialize({client_id, callback, auto_select:false, cancel_on_tap_outside:true})`; `renderButton` always; `prompt()` only when `page === 'home'` (never on boards).
- `DevEmailSignIn`: email input with validation and note "Local build only — no verification"; rendered only when config mode is dev-email.
- `AccountMenu` (every page, top-right): signed out → GoogleSignIn or DevEmailSignIn inline (no navigation on board pages); signed in → avatar (`referrerpolicy="no-referrer"`), name, email, Sign out; error messages.
- `useIdentity` (story 6 modification): signed in → `{id:'u_'+user.id, name, email, avatarUrl, color: colourFromId}`; sign-out → fresh guest id; awareness `user` field updated on change.
- `RecentBoards` on HomePage when signed in: empty state, list with relative times, error + Retry.
- `BoardPage`: on board ready, signed in → `POST /api/boards/:id/visit`; guest → `recordGuestBoard`. No auth checks gate board editing.
- `SignInPage` `/sign-in`: return path from sessionStorage `vidi6.returnTo`.

## Done when
TC-08 passes; component (14.10) and e2e (14.11) tasks pass.

### 10. Component tests for sign-in UI, One Tap placement, failures, account menu, recent boards, expiry notice and identity switch (TC-28 to TC-36, TC-43)

## Goal
jsdom tests of auth.client's contract with a stubbed `window.google.accounts.id` (`fake-gis.ts`), mocked `api.ts` and fake timers.

## Cases
- TC-28 home page, GIS ready → `initialize` called with client id + callback; `prompt` called once; button rendered (auth.one_tap).
- TC-29 board page, GIS ready → `prompt` never called; button rendered in AccountMenu (auth.no_prompt_on_board, negative).
- TC-30 GIS never ready → no message at GIS_LOAD_TIMEOUT_MS − 1; unavailable message at exactly GIS_LOAD_TIMEOUT_MS; Create a board still enabled (auth.google_unavailable, boundary).
- TC-31 callback credential with api 401, 503, network error → "Sign-in didn't work. Please try again." each; state guest (auth.failure).
- TC-32 dev-email config → note visible; invalid email shows validation and sends nothing; valid email calls `signInWithEmail` (auth.dev_email).
- TC-33 signed in, open AccountMenu → avatar, name, email; Sign out calls route and `disableAutoSelect`; menu returns to sign-in (auth.sign_out).
- TC-34 RecentBoards: empty text; 3 boards newest first with relative times; api error then Retry success (auth.recent_boards).
- TC-35 `/api/me` null with `wasSignedIn` marker → expiry notice once, marker removed, not shown after rerender (auth.session_expiry).
- TC-36 useIdentity guest g_1 → signed in u_id with account name → signed out new guest g_2 ≠ g_1; awareness `user` set each time (auth.identity).
- TC-43 signOut network failure → still signed in, retry message (error path).

## Done when
All pass in `npm run test:component`.

### 11. E2E sign-in workflows in local email mode plus production-config refusal (TC-37 to TC-42)

## Goal
Real-browser proof of auth.client flows, auth.board_memory's cross-device and claiming behaviour, and auth.mode_guard's refusal under production-like config.

## Setup
Playwright project `auth-local` runs `wrangler dev --env local`; project `auth-prod-config` runs `wrangler dev` with top-level (production) vars on localhost. Helper `auth.ts`: sign in via the email form, read account menu.

## Workflows
- TC-37 "Guest to account": guest creates board A, opens board B via link, signs in by email → recent boards shows B then A; `vidi6.guestBoards` cleared (claim via auth.board_memory and auth.client).
- TC-38 "Second device": contexts X and Y signed in with the same email; X opens board C; Y reloads home → C first.
- TC-39 "Name change during a workshop": Sam (guest) and Lena on one board; Lena signs in inline from AccountMenu → Sam's presence shows `lena` within IDENTITY_PROPAGATION_BUDGET_MS; Lena's board element handle still attached (no reload).
- TC-40 "Sign out and keep working": signed-in user signs out on home → recent list hidden, guest name shown; creates and edits a board successfully (no lockout).
- TC-41 "Production config refuses dev sign-in" (`auth-prod-config`): account menu has no email form; `POST /api/auth/dev-sign-in` from the page → 404.
- TC-42 "Sign-in speed": email submit → avatar visible within SIGN_IN_BUDGET_MS.

## Done when
All pass in chromium; TC-37 and TC-40 also in firefox and webkit. Real Google sign-in recorded as manual staging check.


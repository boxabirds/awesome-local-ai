# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Add rotation columns (migration 0005) and CAS rotate query | proposed | implementation | rotation.schema |
| 2 | Rotate-link endpoint with cooldown, concurrency safety and cookie update | proposed | implementation | rotation.api |
| 3 | Classify presented secrets as current, previous or unknown in auth, open and remembered list | proposed | implementation | rotation.access_status |
| 4 | End live sessions after rotation and probe access on close 4410 | proposed | implementation | rotation.live_revoke |
| 5 | Get a new link button and confirmation dialog in the Share panel | proposed | implementation | rotation.ui_confirm |
| 6 | Show the new link in save mode, reset the saved flag and fix the address | proposed | implementation | rotation.ui_new_link |
| 7 | LinkChanged error-boundary state and 'Link changed' label on the Home list | proposed | implementation | rotation.ui_link_changed |
| 8 | Unit tests: cooldown, rotation miss and presented-secret classification, probe decisions | proposed | test:unit | rotation.schema, rotation.api, rotation.access_status, rotation.live_revoke, rotation.ui_confirm, rotation.ui_new_link |
| 9 | Integration tests: rotation, old/older link access, concurrency, live revocation, logging | proposed | test:integration | rotation.schema, rotation.api, rotation.access_status, rotation.live_revoke, rotation.test_seed |
| 10 | UI component tests: rotate dialog, states, gating, no auto-retry, new link, LinkChanged state, Home label, switcher | proposed | test:ui-component | rotation.ui_confirm, rotation.ui_new_link, rotation.ui_link_changed |
| 11 | E2E: rotate, revoke other browsers, keep own tabs, cooldown, double rotation, no leak | proposed | test:e2e | rotation.api, rotation.access_status, rotation.live_revoke, rotation.ui_confirm, rotation.ui_new_link, rotation.ui_link_changed |
| 12 | Extend /test/seed-workspace with rotatedSecondsAgo | proposed | implementation | rotation.test_seed |

## Details

### 1. Add rotation columns (migration 0005) and CAS rotate query

Depends on story 2 task 2.1 (workspaces table and query module) and story 8's 0004 migration (D-32: numbered in build order).
1. Write migrations/0005_workspace_secret_rotation.sql (NOT 0006, which is story 10's rate_counters): two ADD COLUMNs (previous_secret_hash, secret_rotated_at) + index on previous_secret_hash. Additive only; run the story 1 safety scan locally.
2. Add rotateSecret(db, id, expectedHash, newHash, cooldownS) as a single UPDATE ... WHERE id, deleted=0, secret_hash=expected, cooldown elapsed ... RETURNING *.
3. Add findActiveByPreviousSecretHash(db, hash).
4. Extend WorkspaceRow type; keep public Workspace schema unchanged. (Delta to story 2's db module, listed in the design's Deltas section.)
5. Add constants LINK_ROTATION_COOLDOWN_S, LIVE_CLOSE_LINK_CHANGED (4410, story 4's close-code registry), LINK_CHANGED_PROBE_RETRY_MS, LINK_CHANGED_PROBE_ATTEMPTS to limits.ts.
Verify with TC-I17 (0001 to 0005 applied) and TC-I01 once the route exists.

### 2. Rotate-link endpoint with cooldown, concurrency safety and cookie update

Depends on 9.1, story 2 (crypto, cookie codec, workspace-auth, link builder), story 1 request pipeline, and story 10's `rateLimitedResponse` + `rateLimitedSchema` (ratelimit.response). Story 9 precedes 10 in build order: if story 10's helper does not exist yet, create it at story 10's path with story 10's exact contract (§13 rule 4) — do not invent a local variant.
1. apps/api/src/lib/rotation.ts: cooldownRemainingS and classifyRotationMiss (pure).
2. Route POST /api/w/:workspaceId/rotate-link behind workspaceAuth; bodyless; client header enforced by story 1 middleware.
3. generateSecret -> hashSecret -> rotateSecret(expected = hash of caller cookie secret).
4. On success: upsertRemembered(entries, entry, now) replacing this entry with the new secret; serializeRememberedCookie; respond {link, workspace} with no-store.
5. On null: reread row, classify -> cooldown: `rateLimitedResponse('rotation_cooldown', cooldownRemainingS(...))` (429, Retry-After, `{error:'rate_limited', scope:'rotation_cooldown', retryAfterSeconds}`, D-23) | 410 link_changed | 404.
6. After building the success response: ctx.waitUntil(room.closeAll(LIVE_CLOSE_LINK_CHANGED, 'link_changed')) (method from 9.4).
7. Log {event:'link_rotated', workspaceId, requestId} only.
8. Add error code `link_changed` only. Do NOT add a `rotation_cooldown` error code or a `retryAfterS` field (D-23). Response schema RotateLinkResponse in shared.
9. Rotation is never auto-retried (D-24): do not add it to story 10's retry predicate; document it as non-idempotent in the route comment.
Verified by TC-U01..TC-U06, TC-I01, TC-I06..TC-I10, TC-I14, TC-I16, TC-C04, TC-C11, TC-E04, TC-E07.

### 3. Classify presented secrets as current, previous or unknown in auth, open and remembered list

Depends on 9.1, story 2 (workspace-auth, open), story 3 (GET /api/remembered, touch, `status` schema) and story 4 (/live route).
1. classifyPresentedHash(row, hash) using constant-time hashesEqual for both current and previous.
2. workspace-auth: previous -> 410 {error:'link_changed'} for HTTP routes; unknown/missing/deleted -> existing constant 404. Expose the classification to the /live route.
3. /api/w/:id/live (D-22): never reject an Upgrade with an HTTP status. With Upgrade present and classification previous -> accept, then close 4410 reason 'link_changed'. Without Upgrade, story 4's 426 applies. (Replaces the old "410 before upgrade" behaviour.)
4. POST /api/workspaces/open: fallback lookup by previous_secret_hash; if the request cookie holds a current secret for that workspace -> 200 {workspace, canonicalLink} and refresh t; else 410 without touching the cookie; unknown -> constant 404. The 410 branch calls story 10's open-miss hook exactly as the 404 branch does (D-34: counts as a failed open attempt) — story 10 owns the limiter.
5. GET /api/remembered: set story 3's `status` field ('ok' | 'unavailable' | 'link_changed', D-27) — `link_changed` for a stored previous secret. No `available` boolean. Never include secrets or hashes. Story 3 owns the schema, which already declares `link_changed`.
6. Remembered touch: 410 link_changed for a stored previous secret (D-27); 204/404 unchanged.
Verified by TC-U07..TC-U10, TC-I02..TC-I05, TC-I11, TC-I12, TC-I15, TC-I18, TC-E01, TC-E03, TC-E05.

### 4. End live sessions after rotation and probe access on close 4410

Depends on story 4 (WorkspaceRoom, LiveConnection, deriveLiveUi) and 9.2/9.3.
1. WorkspaceRoom.closeAll(code, reason) RPC: close every ctx.getWebSockets() socket; count and ignore throws. (Delta to story 4.)
2. Client: in story 4's `apps/web/src/features/live/LiveConnection.ts` (D-43; there is no connection.ts), branch on LIVE_CLOSE_LINK_CHANGED (4410) to handleLinkChangedClose.
3. handleLinkChangedClose: await any in-flight rotate mutation for this workspace (mutation key ['ws', id, 'rotate-link']), then GET /api/w/:id: 200 -> reconnect + invalidateQueries(['ws', id]); 410 -> LiveConnection status `link_changed` (terminal), removeQueries(['ws', id]), hand `LinkChangedError` to story 2's ApiErrorBoundary via the same hand-off story 4 uses for 4404 (no navigation, no route); 404 -> story 4's not_found; network error -> retry after LINK_CHANGED_PROBE_RETRY_MS up to LINK_CHANGED_PROBE_ATTEMPTS, then story 4 live-paused.
4. deriveLiveUi: treat `link_changed` like `not_found` (canEdit false).
5. Preload the LinkChangedState chunk when 4410 arrives.
Verified by TC-U11, TC-U12, TC-I12, TC-I13, TC-E01, TC-E02.

### 5. Get a new link button and confirmation dialog in the Share panel

Depends on story 2 SharePanel (footer slot, SHARE_ACCESS_NOTE, lazyWithRetry, errors map), story 4 useCanEdit, and story 10's useCountdown, formatWait and RateLimitedError (web.throttle_core; if story 10 has not landed, create them at story 10's paths with story 10's contract — never a local timer).
1. SHARE_ACCESS_NOTE (story 2 constant): change its value to 'Anyone with it can see and change everything. To cut off access, get a new link.' (D-17). Assert via the constant.
2. RotateLinkButton in SharePanel footer slot, separated, warning icon (per-icon lucide import), 44 px, preload on pointerenter/focus.
3. RotateLinkDialog lazy chunk (lazyWithRetry): shadcn AlertDialog / bottom sheet below MOBILE_BREAKPOINT_PX; exact copy from rotateCopy.ts; Cancel initial focus; focus returns on close.
4. Gating (D-10): RotateLinkButton and the dialog's 'Get new link' each call useCanEdit() (self-gated via useCanEdit(), like every control that sends a change); disabled with 'You're offline' hint; confirm disables if canEdit flips while open. Copy/email/bookmark are not gated (work offline).
5. useRotateLink mutation, `retry: false`, mutationKey ['ws', id, 'rotate-link']: states pending / success / RateLimitedError scope 'rotation_cooldown' -> ROTATE_COOLDOWN_MESSAGE(formatWait(secondsLeft)) with useCountdown, confirm disabled until 0, then re-enabled with NO automatic request (D-24) / LinkChangedError -> rethrow to ApiErrorBoundary (no navigation) / other -> role=alert failure text, no retry.
Verified by TC-U13, TC-C01..TC-C06, TC-C10, TC-C11, TC-C13, TC-E01, TC-E04, TC-E07.

### 6. Show the new link in save mode, reset the saved flag and fix the address

Depends on 9.5 and story 2 (linkSaved store at apps/web/src/features/share/linkSaved.ts, SharePanel save mode, boot open, queryKeys).
1. useRotateLink onSuccess: setQueryData(queryKeys.link(id)) and workspace (story 2 queryKeys, use only); clearLinkSaved(id); switch SharePanel to mode='save'. Save mode keeps 'Skip for now' (D-17).
2. clearLinkSaved(id) — story 9's declared extension of story 2's `features/share/linkSaved.ts` (D-43; not features/workspace/): remove the saved flag (localStorage tdl:v1:linkSaved:<id>) AND the reminder snooze (sessionStorage tdl:v1:linkSnoozed:<id>), notify subscribers; every storage call in try/catch, never throws.
3. If location.hash holds a secret: history.replaceState to /w#<new>; leave /w/:id route alone.
4. Boot open in main.tsx: when the open response includes canonicalLink, replaceState to it before rendering the workspace.
Verified by TC-U14, TC-C03, TC-C09, TC-E01, TC-E02, TC-E03.

### 7. LinkChanged error-boundary state and 'Link changed' label on the Home list

Depends on 9.3 (status value, 410 code), story 2 (lib/errors.ts map, ApiErrorBoundary) and story 3 (Home list, switcher, forget).
1. lib/errors.ts (story 2): register `link_changed` -> LinkChangedError by body.error, never by status (D-20).
2. ApiErrorBoundary (story 2): LinkChangedError case renders <LinkChangedState/> at the current URL — a boundary state, NOT a route (D-12). No routes/LinkChanged.tsx.
3. LinkChangedState.tsx (lazy via lazyWithRetry): heading, body, 'Remove from this browser' (story 3 forget, no confirm, toast, then Home) and 'Go to my workspaces'; React 19 <title>; renders no workspace data; removeQueries(['ws', id]); heading focused.
4. RememberedRow (Home list and not-found recovery list): status 'link_changed' -> text label + icon, not openable, separate 44 px Remove button (not inside a menu) (D-28).
5. Switcher: lists only status 'ok' entries (D-28) — confirm story 3's filter excludes link_changed. No Remove inside menu items; no SwitcherItem.tsx.
Verified by TC-C05, TC-C07, TC-C08, TC-C10, TC-C12, TC-E01, TC-E05.

### 8. Unit tests: cooldown, rotation miss and presented-secret classification, probe decisions

Implement TC-U01, TC-U02, TC-U03, TC-U04, TC-U05, TC-U06, TC-U07, TC-U08, TC-U09, TC-U10, TC-U11, TC-U12, TC-U13, TC-U14 from the design.
- Boundaries at 59/60/61 s for cooldown; hashes from real generateSecret+hashSecret.
- TC-U11 probe decision table incl. two network failures; 410 must set LiveConnection status `link_changed` and hand LinkChangedError to the boundary (no navigate).
- TC-U12 waits for an in-flight rotate mutation (key ['ws', id, 'rotate-link']).
- TC-U13 pins SHARE_ACCESS_NOTE = 'Anyone with it can see and change everything. To cut off access, get a new link.' (the only literal assertion, §13 rule 3).
- TC-U14 clearLinkSaved removes saved flag and snooze, notifies subscribers, no throw when storage throws.
Run with bun run test:unit.

### 9. Integration tests: rotation, old/older link access, concurrency, live revocation, logging

Implement TC-I01, TC-I02, TC-I03, TC-I04, TC-I05, TC-I06, TC-I07, TC-I08, TC-I09, TC-I10, TC-I11, TC-I12, TC-I13, TC-I14, TC-I15, TC-I16, TC-I17, TC-I18, TC-I19 via SELF.fetch against real Miniflare D1 and WorkspaceRoom DO; nothing mocked.
- Fixtures via /test/seed-workspace `rotatedSecondsAgo` (task 9.12; D-35 registry param). No `previousSecret` input param.
- Assert DB state before/after for every mutating case (secret_hash, previous_secret_hash, secret_rotated_at, version).
- TC-I05 compares 404 bodies byte-for-byte with a never-issued secret.
- TC-I06 asserts story 10's 429 contract: Retry-After header == body retryAfterSeconds, `{error:'rate_limited', scope:'rotation_cooldown'}` validated by rateLimitedSchema, no retryAfterS.
- TC-I07 fires two rotations with Promise.all and asserts exactly one winner.
- TC-I12 (D-22): reconnect with Upgrade + old cookie gets 101 then close 4410 (no HTTP 410 before upgrade); no-Upgrade gets 426. TC-I13 post-commit ordering.
- TC-I14 spies on console.* for secrets and hashes.
- TC-I15 statuses ok/unavailable/link_changed; TC-I17 migrations 0001..0005; TC-I18 touch 410; TC-I19 seed route state and production 404.

### 10. UI component tests: rotate dialog, states, gating, no auto-retry, new link, LinkChanged state, Home label, switcher

Implement TC-C01, TC-C02, TC-C03, TC-C04, TC-C05, TC-C06, TC-C07, TC-C08, TC-C09, TC-C10, TC-C11, TC-C12, TC-C13 with vitest + happy-dom + Testing Library; MSW responses built from shared schemas (RotateLinkResponse, story 10 rateLimitedSchema, error bodies). Fake timers for the 429 countdown (story 10 useCountdown/formatWait).
- TC-C02 asserts dialog copy via rotateCopy constants; TC-C13 asserts SharePanel note via SHARE_ACCESS_NOTE.
- TC-C03 save mode includes Skip for now; banner visible despite prior snooze.
- TC-C05 LinkChangedError renders the ApiErrorBoundary state with no navigation.
- TC-C06 useCanEdit false on button and confirm (incl. flip while open); copy/email/bookmark enabled.
- TC-C08 Home row separate Remove button; TC-C12 switcher lists status ok only.
- TC-C11 exactly one request after countdown ends (D-24), and no retry after a 500.
- TC-C01 preload call count, TC-C09 replaceState behaviour, TC-C10 axe in light and dark.

### 11. E2E: rotate, revoke other browsers, keep own tabs, cooldown, double rotation, no leak

Implement workflows TC-E01, TC-E02, TC-E03, TC-E04, TC-E05, TC-E06, TC-E07 in Playwright (chromium + webkit desktop, D-36 matrix) against wrangler dev with a fresh local D1, using three browser contexts.
- TC-E01: B sees the LinkChanged boundary state (URL unchanged) within 5 s.
- TC-E04: cooldown message 'You just changed the link. Try again in N seconds'.
- TC-E05: seed via /test/seed-workspace rotatedSecondsAgo 61, rotate once in UI; oldest link → Not found; Home list shows 'Link changed' with a Remove button; switcher omits it.
- TC-E06: record every request URL and Referer during TC-E01; assert no secret appears.
- TC-E07 (D-24): seed rotatedSecondsAgo 57, confirm → countdown; after 0 + 5 s, zero further rotate-link requests and link unchanged; confirming again rotates.

### 12. Extend /test/seed-workspace with rotatedSecondsAgo

Depends on 9.1 (columns) and story 2's /test/seed-workspace handler in story 1's routes/test.ts registry (D-35: params {name?, deleted?, rotatedSecondsAgo?}, owner 2 extended by 9).
1. Add optional `rotatedSecondsAgo` (non-negative integer, zod) to the seed-workspace body schema; invalid -> 400 validation.
2. When present: generate real secrets A (previous) and B (current) with story 2's generateSecret; insert with previous_secret_hash=hash(A), secret_hash=hash(B), secret_rotated_at = now - rotatedSecondsAgo, in one INSERT.
3. Response adds `previousSecret` alongside story 2's fields; never log either secret.
4. Route stays 404 in production like every /test/* route.
Verified by TC-I19; used as fixture by TC-I05, TC-I06, TC-E05, TC-E07.


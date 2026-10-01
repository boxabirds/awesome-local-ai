# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Add workspaces migration and query module | proposed | implementation | workspace.schema |
| 2 | Implement secret generation, hashing and constant-time compare | proposed | implementation | workspace.secret |
| 3 | Implement remembered-workspaces cookie codec | proposed | implementation | workspace.cookie_codec |
| 4 | Implement create and open workspace endpoints | proposed | implementation | workspace.create, workspace.open |
| 5 | Implement checkWorkspaceAccess, workspace-auth middleware and GET workspace | proposed | implementation | workspace.auth, workspace.get |
| 6 | Implement rename workspace endpoint | proposed | implementation | workspace.rename |
| 7 | Enforce no-leak measures and verify platform logs | proposed | implementation | security.no_leak |
| 8 | Build landing page with one-click start (LandingStart) | proposed | implementation | web.landing |
| 9 | Build workspace view: query-key factory, boot open, useOpenWorkspace, skeleton, <title>, WorkspaceNameEditor | proposed | implementation | web.workspace_shell |
| 10 | Build SharePanel, ShareButton, shareText constants (SHARE_ACCESS_NOTE), copy/email/bookmark actions and footer slot | proposed | implementation | web.link_dialog |
| 11 | Build the Workspace not found state (NotFound with recovery slot) | proposed | implementation | web.not_found |
| 12 | Unit tests: crypto, cookie codec, query keys, boot open, routes, typed errors, lazyWithRetry, link-saved, copyText, tokens and lint | proposed | test:unit | workspace.secret, workspace.cookie_codec, web.workspace_shell, web.unsaved_link_banner, web.theme, web.routes, web.api_errors, web.lazy_with_retry |
| 13 | Integration tests: workspace API, access check, auth, seed route and headers | proposed | test:integration | workspace.schema, workspace.create, workspace.open, workspace.auth, workspace.get, workspace.rename, workspace.link, security.no_leak, test.seed_workspace |
| 14 | UI component tests: landing, workspace view states, AppShell, routes, error boundary, SharePanel, banner, not-found | proposed | test:ui-component | web.landing, web.workspace_shell, web.link_dialog, web.not_found, web.unsaved_link_banner, web.app_shell, web.routes, web.api_errors |
| 15 | E2E tests: create/save link, return by link, bad link, rename, no leak, fragment on id paths, boot parallelism, dark mode | proposed | test:e2e | workspace.create, workspace.open, workspace.rename, workspace.link, security.no_leak, web.landing, web.workspace_shell, web.link_dialog, web.not_found, web.unsaved_link_banner, web.theme, web.routes, web.app_shell, web.api_errors |
| 16 | Implement GET workspace link endpoint | proposed | implementation | workspace.link |
| 17 | Build unsaved-link reminder banner, linkSaved store and copyText helper | proposed | implementation | web.unsaved_link_banner |
| 18 | Add theme tokens (tokens.ts, generator, contrast checker) with entry extension points, and the direct-import lint | proposed | implementation | web.theme |
| 19 | Build AppShell (header, main slot, no fieldset; controls self-gate) and canEdit stub with named extension slots | proposed | implementation | web.app_shell |
| 20 | Build route table in App.tsx, workspacePath/secretFromHash/useWorkspaceHref and fragment carry-over | proposed | implementation | web.routes |
| 21 | Build typed client errors (lib/errors.ts) and ApiErrorBoundary with NotFound/WorkspaceLoadFailed and registration points | proposed | implementation | web.api_errors |
| 22 | Build lazyWithRetry and use it for every lazy chunk | proposed | implementation | web.lazy_with_retry |
| 23 | Implement POST /test/seed-workspace test route with {name?, deleted?, rotatedSecondsAgo?} extension point | proposed | implementation | test.seed_workspace |

## Details

### 1. Add workspaces migration and query module

Depends on story 1 scaffold (wrangler.toml D1 binding, migrations dir, safety scan).
Steps:
1. Write migrations/0001_workspaces.sql exactly per design workspace.schema. Use UNIQUE on secret_hash and no CHECK constraints. Add an index on (deleted) only if a query needs it: findActiveById uses the PK, and findActiveBySecretHash uses the UNIQUE index.
2. Write apps/api/src/db/workspaces.ts: insertWorkspace, findActiveBySecretHash, findActiveById, renameWorkspace (UPDATE ... SET version = version + 1, updated_at = datetime('now') WHERE id = ? AND deleted = 0 RETURNING *).
3. Add the Workspace public zod schema plus a toPublicWorkspace mapper to packages/shared/src/schemas.ts. The mapper must never include secret_hash.
4. Run `bunx wrangler d1 migrations apply DB --local` and confirm the story 1 safety scan passes.

### 2. Implement secret generation, hashing and constant-time compare

Create apps/api/src/lib/crypto.ts with generateSecret, hashSecret, hashesEqual and isWellFormedSecret, per the design contract.
- Use WORKSPACE_SECRET_BYTES from packages/shared/src/limits.ts. Add the constant if story 1 hasn't created it.
- Encode base64url without padding.
- Hoist the secret RegExp to module scope.
- hashesEqual: prefer crypto.subtle.timingSafeEqual (workerd), otherwise an XOR-accumulate loop. On a length mismatch return false after a full-length dummy loop.
No I/O.

### 3. Implement remembered-workspaces cookie codec

Create apps/api/src/lib/cookie.ts — the one cookie codec (D-45) — with exactly these names, per the workspace.cookie_codec contract:
- `readRemembered(cookieHeader)` -> RememberedEntry[]; validate each element with zod ({id: 32 hex, s: well-formed secret, t: int}); drop invalid elements individually; [] on total garbage; never throw.
- `upsertRemembered(entries, {id, s}, now)` -> {entries, dropped}: new/updated entry first with t = now (epoch seconds, passed in so the function is pure), no duplicate id, trimmed to MAX_REMEMBERED_WORKSPACES (50), dropped = number of oldest entries removed.
- `serializeRememberedCookie(entries, env)` -> full Set-Cookie value; encoding base64url(JSON), most recent first; attributes HttpOnly; SameSite=Lax; Path=/api; Max-Age=REMEMBERED_COOKIE_MAX_AGE_S; Secure unless ENVIRONMENT=local.
- `findEntry(entries, id)`.
No `decode…`/`encode…` aliases. Story 3 extends this module with `removeRemembered(entries, id)`; story 9 reads entries for canonicalLink. Keep the exports stable.
Tests: TC-07..TC-13 (in task 2.12).

### 4. Implement create and open workspace endpoints

Depends on tasks 1-3 and story 1 (Hono app, finalizeResponse, validate pipeline 405 -> 403 -> 413 -> 415).
1. Consume story 1's validate rules; do not redefine them: missing X-Todoodle-Client -> 403 forbidden_client; body present with a non-JSON content type -> 415 unsupported_media_type (D-21); bodyless POST allowed.
2. POST /api/workspaces (empty or {} body): generateSecret + hashSecret, insertWorkspace(DEFAULT_WORKSPACE_NAME), `upsertRemembered(readRemembered(cookie), {id, s}, nowSeconds)` (cap MAX_REMEMBERED_WORKSPACES), respond 201 {workspace, secret, dropped} + Set-Cookie.
3. POST /api/workspaces/open: zod OpenWorkspaceBody {secret: string}; 400 validation on invalid body. If !isWellFormedSecret -> constant NOT_FOUND without a DB call. Else findActiveBySecretHash; hit -> upsert cookie, 200 {workspace, dropped}. Miss -> call the named hook `classifyMiss(db, hash, cookieEntries)`, whose story 2 implementation always returns 'unknown' -> constant NOT_FOUND (story 9 replaces it: 410 link_changed / 200 with canonicalLink).
4. Shared schema `OpenWorkspaceResponse` declares `canonicalLink?: string` (never set by story 2).
5. Set `c.var.openOutcome: 'ok'|'not_found'|'link_changed'` before responding so story 10's open_attempts limiter can count failures (D-34).
6. NOT_FOUND body is a module-level frozen constant, so misses are byte-identical.
7. Never log request bodies; use the sanitised logger (task 2.7).
Tests: TC-15..TC-26, TC-62 (integration, task 2.13), TC-54..TC-56 (e2e, task 2.15).

### 5. Implement checkWorkspaceAccess, workspace-auth middleware and GET workspace

1. apps/api/src/lib/workspaceAccess.ts: `checkWorkspaceAccess(c, wid): Promise<'ok'|'not_found'|'link_changed'>` — NON-RESPONDING access check (required by story 4's /live, which must accept-then-close):
   - readRemembered(cookie) -> findEntry(wid) -> findActiveById -> hashSecret(entry.s) -> hashesEqual.
   - 'ok' also sets c.var.workspace and c.var.rememberedEntry (typed through Hono Variables in env.ts).
   - Every failure -> 'not_found'. 'link_changed' is in the type but never returned in story 2 (story 9 fills the previous-hash branch).
   - Never builds a Response; no cookie or DB writes.
2. apps/api/src/middleware/workspace-auth.ts: calls checkWorkspaceAccess; 'ok' -> next; 'not_found' -> constant NOT_FOUND (shared with open); 'link_changed' -> 410 {error:'link_changed'}.
3. Mount it in app.ts on /api/w/:workspaceId and /api/w/:workspaceId/* before every workspace-scoped route, EXCEPT /api/w/:workspaceId/live (story 4 calls checkWorkspaceAccess directly and closes 4404/4410). Document the order workspaceAuth -> (story 10 mutations limiter) -> routes in app.ts.
4. GET /api/w/:workspaceId -> {workspace: toPublicWorkspace(c.var.workspace)}.
5. Do not refresh the cookie in the check or the middleware.
Tests: TC-27..TC-32, TC-106 (integration, task 2.13).

### 6. Implement rename workspace endpoint

PATCH /api/w/:workspaceId behind workspace-auth.
- Validate with zod RenameWorkspaceBody: {name: string.trim().min(1).max(WORKSPACE_NAME_MAX)}. Failure -> 400 validation. Non-JSON body -> 415 from story 1's pipeline.
- Call renameWorkspace. If it returns null (deleted during the request) -> 404.
- Return {workspace}.
- Leave a clearly marked post-commit point (comment `// story 4: broadcast(c, wid, {type:'workspace.updated', ...})`) where story 4 inserts its broadcast call (D-26: broadcast calls waitUntil itself; no broadcastEvent, no extra waitUntil). Do not implement broadcasting here.
Tests: TC-33..TC-38 (integration, task 2.13), TC-57 (e2e, task 2.15).

### 7. Enforce no-leak measures and verify platform logs

1. apps/web/index.html: add <meta name="referrer" content="no-referrer">. Remove any external font/CDN links and self-host fonts.
2. apps/api/src/lib/errors.ts (SERVER logger; distinct from the web client's apps/web/src/lib/errors.ts): sanitised logger that emits only {requestId, method, pathname, status, errorName}. Replace any console.* in the api with it.
3. Confirm finalizeResponse (story 1) sets Referrer-Policy no-referrer and CSP default-src 'self'; frame-ancestors 'none'; connect-src 'self' wss:. If story 1 did not, add it there.
4. apps/web/src/lib/api.ts and apps/web/src/lib/errors.ts: typed errors carry only status, code and parsed server fields, never request bodies or the secret.
5. Review the web client for secret placement: never in the title, path, query strings, history.state, localStorage or sessionStorage; fragment carry-over (workspacePath) keeps it in the fragment only. The linkSaved/snooze flags (task 2.17) and the chunk-reload flag (task 2.22) store only ids/'1'. 'Email it to me' is a mailto: navigation (no fetch, no third party).
6. MANUAL: after the staging deploy, create and open a workspace and inspect Workers Logs. If Cookie headers or request bodies are captured, set invocation_logs = false for staging and production in wrangler.toml. Record the outcome in the task feedback.
Tests: TC-39, TC-40 (integration, task 2.13), TC-58, TC-89 (e2e, task 2.15).

### 8. Build landing page with one-click start (LandingStart)

- Home.tsx: hoisted static hero (name, pitch), `<HomeRememberedSlot/>` (renders nothing in story 2; story 3 fills it) above `<LandingStart/>`.
- `features/landing/LandingStart.tsx` (D-33 — the named start component story 10 references; no StartButton.tsx): primary shadcn Button 'Start a new list' (label prop, default that text), imported by direct path; icons per-icon per the lint rule (task 2.18).
- useCreateWorkspace: useMutation(createWorkspace). In `onSuccess` (never render/effect): `queryClient.setQueryData(queryKeys.workspace(id), workspace)`, then navigate to `/w#<secret>` with state {justCreated: true}. Reused by the NotFound state via LandingStart.
- Disable the button while pending. On error show `describeCreateError(err).message` inline with role=alert: story 2's `features/landing/createErrorText.ts` returns "Couldn't create your list - try again" for every error. Story 10 adds the RateLimitedError branch and countdown there.
- Button hit area >= MIN_TOUCH_TARGET_PX on touch; colours only from theme tokens (task 2.18).
- The Workspace route is lazy via lazyWithRetry (task 2.22); preload it on the button's pointerenter/focus via `.preload()`.
- api.ts: createWorkspace sends X-Todoodle-Client: web (bodyless POST, so no Content-Type needed); non-2xx responses become typed errors via lib/errors.ts (task 2.21).
Depends on: 2.9 (queryKeys.ts), 2.18 (tokens), 2.21 (errors), 2.22 (lazyWithRetry).
Tests: TC-41, TC-42 (ui-component, task 2.14), TC-54 (e2e, task 2.15), TC-83 (unit, task 2.12).

### 9. Build workspace view: query-key factory, boot open, useOpenWorkspace, skeleton, <title>, WorkspaceNameEditor

The frame (AppShell, canEdit) is task 2.19; routes, `workspacePath` and `secretFromHash` are task 2.20; typed errors and ApiErrorBoundary (including WorkspaceLoadFailed) are task 2.21.
1. `apps/web/src/lib/queryKeys.ts`: the COMPLETE key set (D-37). Every parameter that changes the response is in the key.
   - Workspace keys:
     - `root(wid)=['ws',wid]`
     - `workspace`
     - `link`
     - `tasksAll(wid)=['ws',wid,'tasks']`
     - `tasks(wid,{list:'inbox'|'project', projectId?, includeCompleted})`
     - `counts(wid)` (no date)
     - `projects(wid)`
     - `todayAll(wid)=['ws',wid,'today']`
     - `today(wid,{date, includeCompleted})`
     - `searchAll(wid)=['ws',wid,'search']`
     - `search(wid,{q, includeCompleted})`
   - Browser-scoped keys, defined ONCE here (story 3 does not add them):
     - `remembered()=['remembered']`
     - `rememberedTouch(id)=['remembered-touch',id]`
   - Export the `TaskListParams`, `TodayParams` and `SearchParams` types.
2. `features/workspace/workspaceQuery.ts`: `workspaceQuery(id, {placeholderData?})`, with key `queryKeys.workspace(id)` and queryFn `getWorkspace`. Story 3 passes `placeholderData`.
3. `features/workspace/bootOpen.ts`:
   - `startBootOpen(location)` is called from main.tsx before createRoot.
   - It fires `POST /api/workspaces/open` when `secretFromHash(location)` returns a secret, which is ANY `/w…` path with a non-empty fragment (D-13). It runs in parallel with the lazy Workspace chunk.
   - `.then` does `setQueryData(queryKeys.workspace(id), ws)`.
   - `takeBootOpen(secret)` hands the same promise over, or null for a different secret.
   - Open has no query key.
4. `features/workspace/useOpenWorkspace.ts` (exported, D-43):
   - A primed cache returns immediately. Otherwise `use(takeBootOpen(secret) ?? openWorkspace(secret))`, module-cached per secret, inside Suspense with WorkspaceSkeleton.
   - It rejects with typed errors to ApiErrorBoundary.
   - If the route's `:workspaceId` differs from the opened id, `replaceState` to `workspacePath(opened.id, sameView, {secret})`.
   - After a 200 it calls `applyOpenResult(result)`: a no-op in story 2; story 9 handles `canonicalLink`.
5. `routes/Workspace.tsx`:
   - Fragment entry → `useOpenWorkspace(secretFromHash())`. `/w` with an empty hash → throw `NotFoundError` (no request).
   - Id entry → `useQuery(workspaceQuery(id, {placeholderData}), throwOnError: true)`; pending without a placeholder shows the skeleton.
   - Never modify the fragment.
   - Provide `WorkspaceContext {workspaceId, secretFromHash?}`.
   - Render inside `<AppShell>` (task 2.19) with no slots, an 'Inbox' label and an empty Inbox state (story 5 replaces these).
6. WorkspaceSkeleton: hoisted static placeholders for the header, 3 sidebar rows and 5 list rows; `aria-busy`; shimmer off under reduced motion.
7. React 19 `<title>Todoodle - {name}</title>` rendered in the view; no `document.title` writes.
8. `features/shell/WorkspaceNameEditor.tsx` (D-43): a separate memo component, rendered in AppShell's header; like every control that sends a change it self-gates with `useCanEdit()` and is read-only when that is false.
   - Enter or blur commits, Escape cancels, the value is trimmed.
   - Empty → revert, no request, 'Name can't be empty' (`role=status`) for `NAME_HINT_MS`. Add `NAME_HINT_MS = 3_000` to `packages/shared/src/limits.ts` (D-44).
   - Unchanged → no request.
   - Otherwise `useRenameWorkspace`: optimistic `onMutate` snapshot of `queryKeys.workspace(id)`, `onError` rollback and sonner toast, `onSettled` invalidate.
9. Direct imports only; no `features/*/index.ts` barrels.

Depends on: story 1 scaffold; 2.4/2.5 endpoints; 2.19, 2.20, 2.21, 2.22.

Tests:
- ui-component, task 2.14: TC-47..TC-50, TC-64, TC-78, TC-80, TC-81, TC-93
- unit, task 2.12: TC-83, TC-84. TC-83 includes: `today`/`search` keys differ when only `includeCompleted` differs, and `todayAll`/`searchAll` are prefixes of every variant.
- e2e, task 2.15: TC-54, TC-55, TC-57, TC-63, TC-86

### 10. Build SharePanel, ShareButton, shareText constants (SHARE_ACCESS_NOTE), copy/email/bookmark actions and footer slot

Owner decision 2026-09-25: Link and Share are ONE panel. Story 4 reuses it (no link UI of its own); story 3 reuses useWorkspaceLink, copyText and linkSaved; story 9 fills the footer slot.
1. Add the shadcn Dialog (desktop) and Sheet (bottom, full width below MOBILE_BREAKPOINT_PX); buttons >= MIN_TOUCH_TARGET_PX.
2. `features/share/shareText.ts` (D-17): SHARE_KEY_NOTE, SHARE_ONLY_WAY_NOTE, SHARE_ACCESS_NOTE = "Anyone with it can see and change everything. Access can't be removed yet." (story 9 replaces the value). Components render these constants; tests import them.
3. `features/share/SharePanel.tsx` with `mode: 'save' | 'share'`:
   - Title 'Save your link' / 'Share'. Read-only link field. Texts SHARE_KEY_NOTE + SHARE_ACCESS_NOTE; save mode adds SHARE_ONLY_WAY_NOTE.
   - Primary: save -> 'Copy link & continue' (copy, markLinkSaved, close); share -> 'Copy link' (copy, markLinkSaved, 'Copied' for COPY_CONFIRM_MS = 2_000, defined here in packages/shared/src/limits.ts; COPIED_FEEDBACK_MS not used).
   - 'Email it to me': <a href="mailto:?subject=...&body=<encodeURIComponent(link)>">; click -> markLinkSaved.
   - 'Bookmark this page': platformShortcut() -> '⌘D' on macOS/iOS else 'Ctrl+D'; on an id route first history.replaceState to workspacePath(wid, currentView, {secret}) (keep router state).
   - Secondary: save -> 'Skip for now'; share -> 'Done'. Neither marks saved.
   - `SharePanelFooter` slot: renders nothing in story 2; story 9 puts RotateLinkButton there in share mode; save mode (incl. after a new link) keeps Skip for now.
   - Copy/email/bookmark are not gated by useCanEdit, so they stay usable offline (only story 9's footer button self-gates).
4. `useWorkspaceLink(workspaceId, {enabled})` (exported for story 3): secretFromHash -> origin + '/w#' + secret (no request); else useQuery(queryKeys.link(id), getWorkspaceLink, {enabled, staleTime 0, gcTime 0}); loading skeleton line; error 'Couldn't load the link' + Try again.
5. useCopyLink(workspaceId): delegates to copyText(link, field) from features/share/copyText.ts (task 2.17; there is no copy.ts); 'copied' -> markLinkSaved; 'fallback' -> field selected + one-shot native 'copy' listener that calls markLinkSaved.
6. Auto-open in save mode when location.state.justCreated; on close navigate('.', {replace: true, state: {}}) preserving the hash.
7. `features/share/ShareButton.tsx`: the header's single 'Share' button (rendered by AppShell, task 2.19) opens share mode; no 'Link' button. Radix returns focus to trigger. Preloads the panel on pointerenter/focus.
8. SharePanel is lazy via lazyWithRetry (task 2.22) and its `.preload()` is also called right after create.
Depends on: 2.9 (queryKeys, context), 2.16 (link endpoint), 2.17 (linkSaved, copyText), 2.19 (AppShell), 2.20 (workspacePath), 2.22 (lazyWithRetry).
Tests: TC-43..TC-46 (superseded rows; TC-43 asserts the constants), TC-65..TC-73, TC-95 (ui-component, task 2.14); TC-54, TC-63, TC-88, TC-89 (e2e, task 2.15).

### 11. Build the Workspace not found state (NotFound with recovery slot)

Not-found is a STATE rendered by ApiErrorBoundary (task 2.21) and by the `*` route (task 2.20), not a route of its own (D-12, D-20).
`apps/web/src/features/errors/NotFound.tsx`: `NotFound({ recovery?: ReactNode })` — heading 'Workspace not found'; the tip `LINK_CUT_OFF_TIP` = "Links are long — check it wasn't cut off when it was copied." (exported constant); then the `recovery` node when provided (filled by story 3's `RememberedRecovery`, passed once in App.tsx to the boundary and the `*` route); then `<LandingStart/>` (task 2.8) labelled 'Start a new list'. React 19 `<title>Workspace not found · Todoodle</title>`.
- Render nothing from the failed request; identical for malformed/unknown/deleted secrets, empty hash, unknown /w/:id and any unmatched path.
- Never shown for 5xx/network — those render WorkspaceLoadFailed (task 2.21).
Tests: TC-52, TC-53, TC-82 (ui-component, task 2.14), TC-56 (e2e, task 2.15).

### 12. Unit tests: crypto, cookie codec, query keys, boot open, routes, typed errors, lazyWithRetry, link-saved, copyText, tokens and lint

Implement these TCs exactly as specified in the design test strategies (test-strategy, test-strategy-3, test-strategy-4):
- TC-01..TC-06 (crypto).
- TC-07..TC-13 (cookie codec; upsertRemembered(entries, {id, s}, now) with t = now, D-45).
- TC-83 (complete queryKeys set rooted at root(wid); tasks under tasksAll; counts has no date; remembered()/rememberedTouch(id) the only non-root keys).
- TC-84 (startBootOpen fires for ANY /w… path with a fragment, none otherwise; takeBootOpen reuse; then-callback cache write).
- TC-85 (checkTokenPairs() empty for both themes; 4.49 synthetic pair fails).
- TC-90 (linkSaved keys via savedKey/snoozeKey, subscribe, storage exceptions -> not saved, storage-event invalidation; no clearLinkSaved export in story 2).
- TC-91 (lint fixtures: lucide-react root, local icon barrel @/components/icons, @/features/share directory import, date-fns outside features/dates/picker, `lazy` from react outside lazyWithRetry all fail; per-icon subpath allowed by the installed lucide-react exports map and file imports pass).
- TC-92 (copyText across all clipboard capabilities; never throws).
- TC-96, TC-97 (workspacePath for all views ± secret; secretFromHash on every /w… path class, null otherwise).
- TC-101 (toApiError maps by body.error not status; project_not_found 404 stays ApiError; registerApiErrorType and duplicate guard; NetworkError; no request body in errors).
- TC-103 (build-tokens output byte-identical to committed tokens.css).
- TC-104 (lazyWithRetry: retry, single guarded reload, flag set/unavailable storage rethrow, preload once).
Fixtures use real generateSecret output and 32-hex ids; token pairs come from packages/shared/src/tokens.ts. Boundaries: secret length 42/43/44; cookie entries 0/1/49/50/51; Set-Cookie < 4096 at 50; contrast exactly 4.5/3.0; LAZY_RETRY_ATTEMPTS last-attempt success vs failure.
Run with bun run test:unit (lint via bun run lint for TC-91).

### 13. Integration tests: workspace API, access check, auth, seed route and headers

Implement TC-14..TC-40, TC-59..TC-62, TC-105 and TC-106 via SELF.fetch against real Miniflare D1 (migrations applied). Nothing is mocked.
- Helper re-sends Set-Cookie between requests.
- Assert DB state before/after for every mutating case (row count, name, version, updated_at).
- Assert byte-identical 404 bodies for TC-22/23/25, TC-28/31 and TC-60.
- TC-19: body '{}' with text/plain -> 415 unsupported_media_type (D-21), row count unchanged. TC-62: bodyless create -> 201; '{}' + text/plain -> 415; '{}' + application/json -> 201.
- TC-20: open 200 body has no canonicalLink.
- TC-40: spy on console.* and assert the captured output never contains the secret or the cookie value.
- TC-59: the link equals origin/w# + the cookie entry secret, with Cache-Control no-store.
- TC-105: seed route per test-strategy-4 (local vs ENVIRONMENT=production, name bounds 120/121, deleted, rotatedSecondsAgo -> 400, unknown field -> 400, no Set-Cookie).
- TC-106: checkWorkspaceAccess through a test-only probe app: 'ok' sets c.var.workspace; every failing cookie class -> 'not_found'; never writes a response or cookie; never 'link_changed' in story 2.
- Deleted-workspace fixtures (TC-25, TC-32) come from POST /test/seed-workspace {deleted:true} (task 2.23).

### 14. UI component tests: landing, workspace view states, AppShell, routes, error boundary, SharePanel, banner, not-found

Implement TC-41..TC-53 (TC-43, 44, 45, 46, 49, 51 per the superseded rows in test-strategy-3), TC-64..TC-66, TC-67..TC-82, TC-93, TC-94, TC-95, TC-98, TC-100 and TC-102 with vitest + happy-dom + Testing Library. Mock the API with MSW using the real response shapes from packages/shared schemas.
- Stub navigator.clipboard in modes: writeText resolve, reject, undefined; ClipboardItem present/absent (D9).
- Fake timers for COPY_CONFIRM_MS (1,999/2,001) and NAME_HINT_MS = 3,000 (2,999/3,001).
- TC-43 imports SHARE_KEY_NOTE, SHARE_ONLY_WAY_NOTE and SHARE_ACCESS_NOTE from shareText.ts and asserts them; no literal access-note text in the test (D-17).
- TC-65/66 open the **Share** panel (D-46); no 'Link' button exists (TC-46).
- Workspace view: one create call on double click; optimistic rename before PATCH resolves; rollback on 500; empty rename sends no request and shows the hint; <title> element renders and document.title setter is never called; /w with empty hash -> NotFound state without calling open; skeleton aria-busy while pending; placeholderData name renders before GET (TC-93).
- Errors: 5xx/network -> WorkspaceLoadFailed with exactly one retry request, 404 -> NotFound (TC-79); registered state and fallthrough (TC-102); recovery slot via ApiErrorBoundary and `*` route (TC-82).
- AppShell (TC-100, rewritten 2026-09-27: there is no fieldset): slots render in named regions; `document.querySelector('fieldset')` is null; with `__setCanEditForTests(false)` the shell disables nothing itself — a plain input and button in `children` and a text input in `quickAddSlot` stay enabled (the quick-add input is typeable and keeps its value), while a test control that self-gates with `useCanEdit()` is disabled, proving offline disables only self-gated controls. TC-94: `__setCanEditForTests(false)` -> name editor read-only via its own gate with no PATCH; Share/panel copy/banner Copy still work.
- Routes (TC-98): useWorkspaceHref keeps the fragment in fragment sessions only; id mismatch replaces the URL without adding history.
- SharePanel: save vs share mode; Copy link & continue closes and sets the flag; Email href encoding and no fetch; Bookmark hint per platform and replaceState to workspacePath on an id route; Skip/Done don't set the flag; manual copy event sets the flag; footer slot and ShareButton preload (TC-95).
- Banner: visibility by D7 state; copy paths per route/clipboard; Remind me later per session; throwing storage; cross-tab storage event.

### 15. E2E tests: create/save link, return by link, bad link, rename, no leak, fragment on id paths, boot parallelism, dark mode

Implement workflows WF-1..WF-11 = TC-54 (superseded row), TC-55..TC-58, TC-63, TC-86..TC-89 and TC-99 in Playwright using story 1's project matrix (chromium + webkit desktop; tag the SharePanel full-width sheet check @mobile for mobile-webkit/mobile-chromium) against wrangler dev with a fresh local D1. Do not edit playwright.config.ts (story 1 owns it).
- WF-1 (TC-54): create, under 1000 ms locally, AppShell frame with Share button, Save your link panel, Copy link & continue closes it (grant clipboard permission in chromium; webkit asserts the fallback selection), Share reopens titled 'Share'.
- WF-2 (TC-55): new browser context opens the copied link; reload keeps the URL and workspace.
- WF-3 (TC-56): random 43-char fragment -> Workspace not found state with LINK_CUT_OFF_TIP; Start works.
- WF-4 (TC-57): rename, reload, second context sees the new name.
- WF-5 (TC-58): page.on('request') captures every URL and Referer across WF-1..4, WF-6 and WF-11. Assert the secret never appears in a URL path/query or Referer, all hosts same-origin, and the secret appears only in the POST open body or the GET link response.
- WF-6 (TC-63): navigate to /w/:id in the creating context, open **Share** (D-46) -> link equals the creation link; fresh context opens it -> same workspace.
- WF-7 (TC-88): banner absent after Copy link & continue, still absent after reload; fresh context via link shows the banner.
- WF-8 (TC-89): clicking Email it to me issues no network request; no web-storage value contains the secret.
- WF-9 (TC-86): POST open request starts before the Workspace chunk response finishes.
- WF-10 (TC-87): colorScheme dark/light -> body background equals the matching --background token.
- WF-11 (TC-99): fresh context loads /w/<id>#<secret> -> workspace opens, reload keeps URL; /w/<wrongId>#<secret> ends on /w/<id>#<secret>.

### 16. Implement GET workspace link endpoint

Depends on task 2.5 (checkWorkspaceAccess + workspace-auth).
1. Use c.var.rememberedEntry, the verified cookie entry set by checkWorkspaceAccess on 'ok'.
2. GET /api/w/:workspaceId/link returns {link: new URL(c.req.url).origin + '/w#' + entry.s}. Explicitly set Cache-Control: no-store. Never log it.
3. api.ts: getWorkspaceLink(id); failures reject with typed errors (task 2.21).
Called only on explicit user action when no secret is available from secretFromHash (id-route sessions): from useWorkspaceLink when the SharePanel is open (including its Bookmark action), from the unsaved-link banner's Copy (via queryClient.fetchQuery(queryKeys.link(id))), and from story 3's forget dialog. Never on page load. There is no separate Link dialog: story 4 reuses the SharePanel.
Tests: TC-59..TC-61 (integration, task 2.13), TC-63 (e2e, task 2.15), TC-65, TC-66, TC-70, TC-74 (ui-component, task 2.14).

### 17. Build unsaved-link reminder banner, linkSaved store and copyText helper

1. `features/share/linkSaved.ts` (D-43; the one link-saved module, consumed by story 3): `hasSavedLink(id)` / `markLinkSaved(id)` / `isSnoozed(id)` / `snooze(id)` / `subscribe(fn)` / `useLinkReminderVisible(id)` plus exported key builders `savedKey(id)` = 'tdl:v1:linkSaved:<id>' (localStorage) and `snoozeKey(id)` = 'tdl:v1:linkSnoozed:<id>' (sessionStorage); value '1' only. Every access in try/catch; unavailable storage -> reported as not saved and not snoozed (banner stays). Module-level Map read cache invalidated on write and on the single shared window 'storage' listener. useLinkReminderVisible uses useSyncExternalStore with the boolean as snapshot. Leave a comment marking where story 9 adds `clearLinkSaved(id)` (clears BOTH keys and notifies); do not implement it.
2. `features/share/copyText.ts` (D-17; the one clipboard helper, used by SharePanel, story 3 and story 4 — no copy.ts): `copyText(text | Promise<string>, fallbackField?)` -> 'copied' | 'fallback'. String -> writeText; promise -> clipboard.write([new ClipboardItem({'text/plain': blob promise})]) when ClipboardItem exists; any failure -> focus+select fallbackField if given, resolve 'fallback'. Never throws.
3. `features/share/UnsavedLinkBanner.tsx` (role=status), rendered by AppShell (task 2.19) directly under the header; not gated by useCanEdit (works offline): text 'Your link isn't saved yet — you'll lose access if you clear this browser.'; 'Copy link' -> copyText(link) when secretFromHash is set, copyText(queryClient.fetchQuery({queryKey: queryKeys.link(id), queryFn: getWorkspaceLink})) on an id route; 'copied' -> markLinkSaved; 'fallback' -> open SharePanel in share mode. 'Remind me later' -> snooze. Wraps with full-width buttons below MOBILE_BREAKPOINT_PX; buttons >= MIN_TOUCH_TARGET_PX.
Depends on: 2.9, 2.16.
Tests: TC-90, TC-92 (unit, task 2.12); TC-74..TC-77 (ui-component, task 2.14); TC-88 (e2e, task 2.15).

### 18. Add theme tokens (tokens.ts, generator, contrast checker) with entry extension points, and the direct-import lint

D-42, D-43: story 2 owns tokens.ts, the generator and the contrast checker; stories 5, 7 and 8 only add entries.
1. `packages/shared/src/tokens.ts`: `TOKENS` (semantic: background, foreground, muted, muted-foreground, primary, primary-foreground, destructive, border, ring, warning, success; light and dark hex values), `TEXT_PAIRS` and `UI_PAIRS` listing every fg/bg pair used. Mark the entry extension groups with comments: story 5 row/grid states, story 7 the 12 PROJECT_COLORS, story 8 date chip states (each extender adds tokens AND their pairs). Story 2 does not add PROJECT_COLORS values (story 7 does).
2. `packages/shared/src/contrast.ts`: `contrastRatio(fg, bg)` (WCAG relative luminance) and `checkTokenPairs()` returning failures; MIN_TEXT_CONTRAST = 4.5 and MIN_UI_CONTRAST = 3 in limits.ts. Adjust token values until checkTokenPairs() is empty in both themes.
3. `apps/web/scripts/build-tokens.ts` (bun) generates `apps/web/src/styles/tokens.css`: `:root` light vars, `@media (prefers-color-scheme: dark)` dark vars, `color-scheme: light dark`, and a global `prefers-reduced-motion: reduce` block. Wire the shadcn/Tailwind v4 theme to these vars; import from index.css. Commit the generated file; `bun run tokens` regenerates; `bun run lint` fails if it is stale.
4. `apps/web/eslint.config.js` `no-restricted-imports`: ban the `lucide-react` root (allow only the per-icon subpath the INSTALLED lucide-react exports map permits — check package.json exports and state the allowed pattern in the rule message), any local icon barrel (e.g. `@/components/icons`), `@/features/*` directory/index imports, `date-fns` outside `src/features/dates/picker/**`, and `lazy` from 'react' outside `src/lib/lazyWithRetry.ts`. Add `bun run lint`; make `bun run test` run lint first.
Tests: TC-85, TC-91, TC-103 (unit, task 2.12); TC-87 (e2e, task 2.15).

### 19. Build AppShell (header, main slot, no fieldset; controls self-gate) and canEdit stub with named extension slots

D-10, D-11: the ONE shell; replaces "Workspace route shell", WorkspaceShell, WorkspaceHeader and "AppShell in story 5". Decision 2026-09-27 (supersedes the D-10/D-11 fieldset text): **there is no `<fieldset disabled>` anywhere in the app**; every control that sends a change gates itself with `useCanEdit()`.
1. `apps/web/src/features/live/canEdit.ts` stub: `useCanEdit()` (useSyncExternalStore, snapshot = boolean), `getCanEdit()`, `subscribeCanEdit(fn)`; always true. Export test-only `__setCanEditForTests(value)`. Story 4 replaces the implementation behind the same exports. No canEditStore.ts.
2. `apps/web/src/features/shell/AppShell.tsx` with props: workspaceId, children (task grids — main region), quickAddSlot (story 5), viewHeaderSlot (5-8), sidebar (5), searchSlot (11 via 5), headerActionsSlot (5, 11), switcherTrigger (3).
3. Layout: header [WorkspaceNameEditor (task 2.9)] [switcherTrigger] … [headerActionsSlot] [ShareButton (task 2.10)]; UnsavedLinkBanner (task 2.17) under the header; body [sidebar] <main>[viewHeaderSlot][quickAddSlot]{children}</main>.
4. The shell disables nothing itself. It must not render a `<fieldset>` (a disabled fieldset would also disable the quick-add text input, the task-name button that opens the detail sheet read-only offline, and Discard on failed rows). Mutating controls self-gate: in story 2 only WorkspaceNameEditor (read-only when false); story 5's QuickAdd gates its submit (input stays typeable) and story 5's TaskRow cells gate once for every grid. Name editor, Share, banner, sidebar navigation, switcher, header action triggers and the view header ('Show completed') are not gated and work offline.
5. Absent slots render nothing and leave no empty landmark.
6. No inline component definitions for slots; slots are elements passed as props.
Depends on: 2.9 (name editor), 2.10 (ShareButton), 2.17 (banner), 2.18 (tokens).
Tests: TC-94, TC-100 (ui-component, task 2.14); TC-54 (e2e, task 2.15).

### 20. Build route table in App.tsx, workspacePath/secretFromHash/useWorkspaceHref and fragment carry-over

D-12, D-13.
1. `apps/web/src/App.tsx` — the only route table: `/` Home; `/w` Workspace (boots from fragment, Inbox); `/w/:workspaceId` Workspace with Inbox index child; marked positions for the children story 8 (`today`) and story 7 (`project/:projectId`) register; `*` renders the NotFound state. Workspace routes share one lazy (lazyWithRetry, task 2.22) Workspace element wrapped in `<ApiErrorBoundary recovery={…}>` (task 2.21); the `recovery` node is passed ONCE here to both the boundary and the `*` route (story 3 sets it to `<RememberedRecovery/>`). Error pages are boundary states, not routes.
2. `apps/web/src/lib/workspacePath.ts`: `WorkspaceView` = {kind:'inbox'} | {kind:'today'} | {kind:'project', projectId}; `workspacePath(wid, view, {secret?})` -> /w/<wid>, /w/<wid>/today, /w/<wid>/project/<pid> (ids URL-encoded) + '#<secret>' when given; `secretFromHash(loc)` -> secret for a non-empty fragment on '/w' or any '/w/…' path, else null; `useWorkspaceHref(view)` using WorkspaceContext.secretFromHash.
3. Fragment carry-over: every in-app workspace link/navigate uses useWorkspaceHref/workspacePath so a fragment session keeps '#<secret>' on all /w/:id/* views; id sessions add none. Navigating to '/' or another workspace drops it.
4. No listRoute(); story 7's useWorkspaceNavigate wraps workspacePath; story 3 does not register /w/:id again.
Depends on: 2.9 (WorkspaceContext, Workspace.tsx), 2.11 (NotFound), 2.21 (boundary), 2.22 (lazyWithRetry).
Tests: TC-96, TC-97 (unit, task 2.12); TC-98 (ui-component, task 2.14); TC-99 (e2e, task 2.15).

### 21. Build typed client errors (lib/errors.ts) and ApiErrorBoundary with NotFound/WorkspaceLoadFailed and registration points

D-20.
1. `apps/web/src/lib/errors.ts`: ApiError {status, code}, NotFoundError, ValidationError {issues}, NetworkError (fetch rejected, status 0); `registerApiErrorType(code, make)` (throws on duplicate in dev) and `toApiError(status, body, headers)` mapping BY body.error, never status alone: not_found -> NotFoundError, validation -> ValidationError, registered codes -> their type (story 4 gone -> GoneError{entity}, story 9 link_changed -> LinkChangedError, story 10 rate_limited -> RateLimitedError{scope, retryAfterSeconds}), anything else / non-JSON / empty -> ApiError. Error objects never carry the request body or secret.
2. `apps/web/src/lib/api.ts`: every non-2xx goes through toApiError; fetch rejections become NetworkError.
3. `features/errors/errorStates.ts`: `registerErrorState(errorClass, render)`; renderer gets (error, {reset, recovery}) and may return undefined to fall through.
4. `features/errors/ApiErrorBoundary.tsx` ({children, recovery?}): order = registered state (most specific class; story 9 LinkChanged, story 10 TooManyAttempts for scope open_attempts) -> NotFoundError/ValidationError -> `<NotFound recovery/>` (task 2.11) -> everything else `<WorkspaceLoadFailed>`.
5. `features/errors/WorkspaceLoadFailed.tsx`: "Couldn't load this workspace." + Try again (role=alert); Try again = reset() + invalidate queryKeys.root(wid) or clear the cached open promise, producing exactly one new request.
6. Only view loads reach the boundary (useOpenWorkspace, useQuery throwOnError); mutation errors do not.
Depends on: 2.9 (queryKeys, useOpenWorkspace), 2.11 (NotFound).
Tests: TC-101 (unit, task 2.12); TC-79, TC-102 (ui-component, task 2.14); TC-56 (e2e, task 2.15).

### 22. Build lazyWithRetry and use it for every lazy chunk

D-42: moved to story 2 as earliest user.
1. `apps/web/src/lib/lazyWithRetry.ts`: `lazyWithRetry(factory)` -> React.lazy component with `preload()` (starts the import once; shared with render).
2. On import failure retry up to LAZY_RETRY_ATTEMPTS (2) times, LAZY_RETRY_DELAY_MS (500) apart. If all fail: if sessionStorage 'tdl:v1:chunkReload' is unset, set it to '1' and location.reload() once (fragment survives); if already set, clear it and rethrow to the nearest boundary (WorkspaceLoadFailed). Clear the flag after any successful load. Storage access in try/catch; storage unavailable -> no reload, rethrow.
3. Add LAZY_RETRY_ATTEMPTS = 2 and LAZY_RETRY_DELAY_MS = 500 to packages/shared/src/limits.ts.
4. Story 2 uses it for the Workspace route (task 2.20) and SharePanel (task 2.10). The lint rule (task 2.18) bans `lazy` from 'react' elsewhere, so stories 5-11 use it too.
Tests: TC-104 (unit, task 2.12).

### 23. Implement POST /test/seed-workspace test route with {name?, deleted?, rotatedSecondsAgo?} extension point

D-35: a real capability owned by story 2 in story 1's test-route registry (`apps/api/src/routes/test.ts`). No /test/sql.
1. Register POST /test/seed-workspace behind story 1's /test/* gate (404 in production; allowed local and staging).
2. zod `SeedWorkspaceBody` (.strict()): {name?: trimmed 1..WORKSPACE_NAME_MAX, deleted?: boolean, rotatedSecondsAgo?: number}. If rotatedSecondsAgo is present, return 400 validation with issue 'rotatedSecondsAgo requires story 9' (never ignore it silently); story 9 implements it (previous_secret_hash, secret_rotated_at, previousSecret in response).
3. Handler uses real generateSecret, hashSecret, insertWorkspace (default name DEFAULT_WORKSPACE_NAME); deleted:true -> new `markDeleted(db, id)` query sets deleted=1 and deleted_at.
4. 201 {workspace, secret}; NO Set-Cookie (tests open via the real open endpoint or /w#secret).
5. Validate pipeline (403/415) applies as for any mutation.
Consumers: TC-25 and TC-32 fixtures (task 2.13), story 3 and story 9 fixtures.
Tests: TC-105 (integration, task 2.13).


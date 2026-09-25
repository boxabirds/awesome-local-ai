# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Add workspaces migration and query module | proposed | implementation | workspace.schema |
| 2 | Implement secret generation, hashing and constant-time compare | proposed | implementation | workspace.secret |
| 3 | Implement remembered-workspaces cookie codec | proposed | implementation | workspace.cookie_codec |
| 4 | Implement create and open workspace endpoints | proposed | implementation | workspace.create, workspace.open |
| 5 | Implement workspace-auth middleware and GET workspace | proposed | implementation | workspace.auth, workspace.get |
| 6 | Implement rename workspace endpoint | proposed | implementation | workspace.rename |
| 7 | Enforce no-leak measures and verify platform logs | proposed | implementation | security.no_leak |
| 8 | Build landing page with one-click start | proposed | implementation | web.landing |
| 9 | Build workspace route shell: query-key factory, boot open, skeleton/failed states, <title>, header rename | proposed | implementation | web.workspace_shell |
| 10 | Build SharePanel (save-your-link + single Share button), copy/email/bookmark actions and clipboard fallback | proposed | implementation | web.link_dialog |
| 11 | Build workspace-not-found page | proposed | implementation | web.not_found |
| 12 | Unit tests: secret crypto, cookie codec, query keys, boot open, link-saved store, theme contrast, import lint | proposed | test:unit | workspace.secret, workspace.cookie_codec, web.workspace_shell, web.unsaved_link_banner, web.theme |
| 13 | Integration tests: workspace API, auth and headers | proposed | test:integration | workspace.schema, workspace.create, workspace.open, workspace.auth, workspace.get, workspace.rename, workspace.link, security.no_leak |
| 14 | UI component tests: landing, workspace shell states, SharePanel, unsaved-link banner, not-found | proposed | test:ui-component | web.landing, web.workspace_shell, web.link_dialog, web.not_found, web.unsaved_link_banner |
| 15 | E2E tests: create/save link, return by link, bad link, rename, no leak, boot parallelism, dark mode | proposed | test:e2e | workspace.create, workspace.open, workspace.rename, workspace.link, security.no_leak, web.landing, web.workspace_shell, web.link_dialog, web.not_found, web.unsaved_link_banner, web.theme |
| 16 | Implement GET workspace link endpoint | proposed | implementation | workspace.link |
| 17 | Build unsaved-link reminder banner, linkSaved store and copyText helper | proposed | implementation | web.unsaved_link_banner |
| 18 | Add light/dark theme tokens and enforce direct (non-barrel) imports | proposed | implementation | web.theme |

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

Create apps/api/src/lib/cookie.ts with readRemembered, upsertRemembered, serializeRememberedCookie and findEntry, per the design contract.
- Encoding: base64url(JSON), most recent first. Cap at MAX_REMEMBERED_WORKSPACES (50) and return the dropped count.
- readRemembered: validate each element with zod ({id: 32 hex, s: well-formed secret, t: int}). Drop invalid elements individually. Return [] on total garbage. Never throw.
- Attributes: HttpOnly; SameSite=Lax; Path=/api; Max-Age=REMEMBERED_COOKIE_MAX_AGE_S; Secure unless ENVIRONMENT=local.
Story 3 extends this module with a removeRemembered function; keep the exports stable.

### 4. Implement create and open workspace endpoints

Depends on tasks 1-3 and story 1 (Hono app, finalizeResponse, validate middleware).
1. Consume story 1's validate rule: X-Todoodle-Client: web is always required on mutations; Content-Type: application/json only when a body is present; otherwise 403 forbidden_client. Add the rule here only if story 1 hasn't.
2. POST /api/workspaces (empty or {} body): generate + hash secret, insertWorkspace(DEFAULT_WORKSPACE_NAME), upsertRemembered cookie entry {id, s, t:now} (cap MAX_REMEMBERED_WORKSPACES), respond 201 {workspace, secret, dropped} + Set-Cookie.
3. POST /api/workspaces/open: zod OpenWorkspaceBody {secret: string}; 400 on invalid body. If !isWellFormedSecret -> constant NOT_FOUND without a DB call. Else findActiveBySecretHash; miss -> same constant; hit -> upsert cookie, 200 {workspace, dropped}.
4. NOT_FOUND body is a module-level frozen constant, so misses are byte-identical.
5. Never log request bodies; use the sanitised logger (task 2.7).

### 5. Implement workspace-auth middleware and GET workspace

1. apps/api/src/middleware/workspace-auth.ts:
   - readRemembered(cookie) -> findEntry(id) -> findActiveById -> hashSecret(entry.s) -> hashesEqual.
   - Any failure -> constant NOT_FOUND (shared with open).
   - On success set c.var.workspace; type it through Hono Variables in env.ts.
2. Mount it in app.ts on /api/w/:workspaceId and /api/w/:workspaceId/*, before every workspace-scoped route. Stories 4-8 depend on this.
3. GET /api/w/:workspaceId -> {workspace: toPublicWorkspace(c.var.workspace)}.
4. Do not refresh the cookie in the middleware.

### 6. Implement rename workspace endpoint

PATCH /api/w/:workspaceId behind workspace-auth.
- Validate with zod RenameWorkspaceBody: {name: string.trim().min(1).max(WORKSPACE_NAME_MAX)}. Failure -> 400 validation.
- Call renameWorkspace. If it returns null (deleted during the request) -> 404.
- Return {workspace}.
- Leave a clearly named hook point (a no-op function) where story 4 plugs in the workspace.updated broadcast. Do not implement broadcasting here.

### 7. Enforce no-leak measures and verify platform logs

1. apps/web/index.html: add <meta name="referrer" content="no-referrer">. Remove any external font/CDN links and self-host fonts.
2. apps/api/src/lib/errors.ts: sanitised logger that emits only {requestId, method, pathname, status, errorName}. Replace any console.* in the api with it.
3. Confirm finalizeResponse (story 1) sets Referrer-Policy no-referrer and CSP default-src 'self'; frame-ancestors 'none'; connect-src 'self' wss:. If story 1 did not, add it there.
4. apps/web/src/lib/api.ts: thrown errors carry only code and status, never request bodies.
5. Review the web client for secret placement: never in the title, query strings, history.state, localStorage or sessionStorage. The linkSaved/snooze flags (task 2.17) store only the workspace id and '1'. 'Email it to me' is a mailto: navigation (no fetch, no third party).
6. MANUAL: after the staging deploy, create and open a workspace and inspect Workers Logs. If Cookie headers or request bodies are captured, set invocation_logs = false for staging and production in wrangler.toml. Record the outcome in the task feedback.
Tests: TC-39, TC-40 (integration), TC-58, TC-89 (e2e).

### 8. Build landing page with one-click start

- Home.tsx: hoisted static hero (name, pitch) and a primary shadcn Button 'Start a new list', imported by direct path (`@/components/ui/button`); icons per-icon (`lucide-react/icons/...`).
- useCreateWorkspace: useMutation(createWorkspace). In `onSuccess` (never render/effect): `queryClient.setQueryData(queryKeys.workspace(id), workspace)` using the factory from task 2.9, then `navigate('/w#' + secret, {state: {justCreated: true}})`. Reused by NotFound.
- Disable the button while pending. On error, show inline "Couldn't create your list - try again" with role=alert.
- Button hit area >= MIN_TOUCH_TARGET_PX on touch; colours only from theme tokens (task 2.18).
- Make Workspace route React.lazy in App.tsx. Preload it on the button's pointerenter/focus.
- api.ts: createWorkspace sends Content-Type json + X-Todoodle-Client: web.
Story 3 will insert the remembered list above the button; leave a slot.
Depends on: 2.9 (queryKeys.ts), 2.18 (tokens).
Tests: TC-41, TC-42, TC-54, TC-83.

### 9. Build workspace route shell: query-key factory, boot open, skeleton/failed states, <title>, header rename

1. `apps/web/src/lib/queryKeys.ts`: factory with root(id)=['ws',id], workspace(id), link(id), plus the two browser-scoped keys story 3 uses: remembered()=['remembered'] and rememberedTouch(id)=['remembered-touch', id] (the only keys outside the ws root). All web code uses it; later stories extend it.
2. `features/workspace/workspaceQuery.ts`: `workspaceQuery(id, {placeholderData?})` returning query options (key queryKeys.workspace(id), queryFn getWorkspace). Story 3 passes placeholderData from its remembered entry.
3. `features/workspace/bootOpen.ts`: `startBootOpen(location)` called from `main.tsx` before createRoot — fires POST /api/workspaces/open when path is /w with a non-empty hash, in parallel with the lazy Workspace chunk. Its `.then` does `setQueryData(queryKeys.workspace(id), ws)`. `takeBootOpen(secret)` hands the same promise to the route (null for a different secret). No query key for open (keeps the secret out of the cache/devtools).
4. Register routes /w and /w/:workspaceId in App.tsx, both rendering Workspace.tsx.
5. /w: derive the secret from location.hash during render. Empty hash -> NotFound. Primed cache -> render. Otherwise `use(takeBootOpen(secret) ?? openWorkspace(secret))` inside `<Suspense fallback={<WorkspaceSkeleton/>}>`. 404/400 -> NotFound; network/5xx -> `<WorkspaceLoadFailed onRetry>` ('Couldn't load this workspace.' + Try again, role=alert). Never modify the hash.
6. /w/:workspaceId: useQuery(workspaceQuery(id, {placeholderData})); pending without placeholder -> skeleton; 404 -> NotFound; other errors -> WorkspaceLoadFailed with refetch. No secret in JS.
7. WorkspaceSkeleton: hoisted static header/sidebar(3)/list(5) placeholders, aria-busy, shimmer off under reduced motion.
8. Edit gate: `features/live/canEditStore.ts` stub exporting `useCanEdit()` that always returns true (story 4 replaces the implementation, same export). Wrap the name editor and main content region in `<fieldset disabled={!canEdit} className="contents">`. Share button, SharePanel and UnsavedLinkBanner stay OUTSIDE the fieldset.
9. WorkspaceContext provides {workspaceId, secretFromHash?}. Stories 3-8 consume it.
10. Layout: header (name editor, single Share button from 2.10, UnsavedLinkBanner from 2.17) + sidebar placeholder (Inbox) + empty Inbox state. Story 5 replaces the empty state and owns the mobile drawer.
11. React 19 `<title>Todoodle - {name}</title>` rendered in the view; no document.title writes.
12. WorkspaceNameEditor (separate memo component): Enter/blur commit, Escape cancel, trim. Empty -> revert, no request, show 'Name can't be empty' (role=status) for NAME_HINT_MS (add NAME_HINT_MS=2_500 to packages/shared/src/limits.ts). Unchanged -> no request. Otherwise useRenameWorkspace: optimistic onMutate snapshot of queryKeys.workspace(id), onError rollback + sonner toast, onSettled invalidate.
13. Direct imports only; no features/*/index.ts barrels.
Depends on: story 1 scaffold; 2.4/2.5 endpoints.
Tests: TC-47..TC-50, TC-64, TC-78..TC-81, TC-83, TC-84, TC-86, TC-93, TC-94.

### 10. Build SharePanel (save-your-link + single Share button), copy/email/bookmark actions and clipboard fallback

Owner decision 2026-09-25: Link and Share are ONE panel. Story 4 reuses this component and builds no link UI; story 3 reuses useWorkspaceLink, copyText and linkSaved.
1. Add the shadcn Dialog (desktop) and Sheet (bottom, full width below MOBILE_BREAKPOINT_PX); buttons >= MIN_TOUCH_TARGET_PX.
2. `features/share/SharePanel.tsx` with `mode: 'save' | 'share'`:
   - Title 'Save your link' / 'Share'. Read-only link field.
   - Exact texts: 'This link is the key to this workspace — for you and anyone you send it to.' and 'Anyone with it can see and change everything. Access can't be removed yet.'; save mode adds 'It's the only way back in: if you lose it, you lose access.'
   - Primary: save -> 'Copy link & continue' (copy, markLinkSaved, close); share -> 'Copy link' (copy, markLinkSaved, 'Copied' for COPY_CONFIRM_MS=2_000 added to packages/shared/src/limits.ts; COPIED_FEEDBACK_MS not used).
   - 'Email it to me': <a href="mailto:?subject=...&body=<encodeURIComponent(link)>">; click -> markLinkSaved.
   - 'Bookmark this page': platformShortcut() -> '⌘D' on macOS/iOS else 'Ctrl+D'; on /w/:id first history.replaceState to /w#secret (keep router state).
   - Secondary: save -> 'Skip for now'; share -> 'Done'. Neither marks saved.
   - Rendered outside the edit fieldset so it stays usable offline.
3. `useWorkspaceLink(workspaceId, {enabled})` (exported for story 3): secretFromHash -> origin + '/w#' + secret (no request); else useQuery(queryKeys.link(id), getWorkspaceLink, {enabled, staleTime 0, gcTime 0}); loading skeleton line; error 'Couldn't load the link' + Try again.
4. useCopyLink(workspaceId): delegates to copyText(link, field) from 2.17; 'copied' -> markLinkSaved; 'fallback' -> field selected + one-shot native 'copy' listener that calls markLinkSaved.
5. Auto-open in save mode when location.state.justCreated; on close navigate('.', {replace: true, state: {}}) preserving the hash.
6. Header: a single 'Share' button opens share mode (no 'Link' button). Radix returns focus to trigger.
7. Lazy-load the panel (SharePanelLazy); preload on Share pointerenter/focus and right after create.
Depends on: 2.9 (queryKeys, context), 2.16 (link endpoint), 2.17 (linkSaved, copyText).
Tests: TC-43..TC-46 (superseded rows), TC-65..TC-73, TC-54, TC-63, TC-88, TC-89.

### 11. Build workspace-not-found page

NotFound.tsx: `NotFound({ recovery?: ReactNode })` — heading 'Workspace not found', the tip 'Links are long — check it wasn't cut off when it was copied.', then the `recovery` node when provided (story 3 passes this browser's remembered workspaces), then a 'Start a new list' button using useCreateWorkspace.
- Render nothing from the failed request; identical for malformed/unknown/deleted/empty-hash.
- Register it as the router catch-all and use it from Workspace.tsx for empty hash / 404 only (never for 5xx/network — those use WorkspaceLoadFailed from 2.9).
Tests: TC-52, TC-53, TC-82, TC-56.

### 12. Unit tests: secret crypto, cookie codec, query keys, boot open, link-saved store, theme contrast, import lint

Implement TC-01..TC-06 (crypto) and TC-07..TC-13 (cookie codec) from the design test strategy, plus from test-strategy-3: TC-83 (workspace keys rooted at root(id); remembered()/rememberedTouch(id) are the only exceptions and not matched by root), TC-84 (startBootOpen/takeBootOpen firing and reuse rules, then-callback cache write), TC-85 (token contrast both themes, 4.49 synthetic pair fails), TC-90 (linkSaved: hasSavedLink/markLinkSaved keys, subscribe, storage exceptions -> not saved, cache invalidation on storage event), TC-91 (lint fixtures: lucide-react root and @/features/share directory imports fail; per-icon/file imports pass), TC-92 (copyText across all clipboard capabilities; never throws).
- Fixtures use real generateSecret output and 32-hex ids; token pairs come from packages/shared/src/tokens.ts.
- Boundaries: secret length 42/43/44 and bad chars; cookie entry counts 0/1/49/50/51; Set-Cookie length < 4096 at 50 entries; contrast exactly 4.5/3.0.
- Throwing storage stub only for TC-90's unavailable case.
Run with bun run test:unit (lint via bun run lint for TC-91).

### 13. Integration tests: workspace API, auth and headers

Implement TC-14..TC-40 and TC-59..TC-62 via SELF.fetch against real Miniflare D1 (migrations applied). Nothing is mocked.
- Helper re-sends Set-Cookie between requests.
- Assert DB state before/after for every mutating case (row count, name, version, updated_at).
- Assert byte-identical 404 bodies for TC-22/23/25, TC-28/31 and TC-60.
- TC-40: spy on console.* and assert the captured output never contains the secret or the cookie value.
- TC-59: the link equals origin/w# + the cookie entry secret, with Cache-Control no-store.
- TC-62: bodyless POST create with only the client header -> 201.
- Deleted-workspace fixture via /test/seed-workspace {deleted:true}. Add that test route in this task if absent; it is non-production only per story 1 gating.

### 14. UI component tests: landing, workspace shell states, SharePanel, unsaved-link banner, not-found

Implement TC-41..TC-53 (TC-43, 44, 45, 46, 49, 51 per the superseded rows in test-strategy-3), TC-64..TC-66, TC-67..TC-82, TC-93 and TC-94 with vitest + happy-dom + Testing Library. Mock the API with MSW using the real response shapes from packages/shared schemas.
- Stub navigator.clipboard in modes: writeText resolve, reject, undefined; ClipboardItem present/absent (D9).
- Fake timers for COPY_CONFIRM_MS (1,999/2,001) and NAME_HINT_MS (2,499/2,501).
- Assert: one create call on double click; optimistic rename before PATCH resolves; rollback on 500; empty rename sends no request and shows the hint; <title> element renders and document.title setter is never called; NotFound for empty hash without calling open; 5xx -> load-failed with one retry request, 404 -> NotFound; skeleton aria-busy while pending; placeholderData name renders before GET (TC-93).
- SharePanel: save vs share mode with the exact texts; Copy link & continue closes and sets the flag; Email href encoding and no fetch; Bookmark hint per platform and replaceState on /w/:id; Skip/Done don't set the flag; manual copy event sets the flag; no 'Link' button in the header.
- Banner: visibility by D7 state; copy paths per route/clipboard; Remind me later per session; throwing storage; cross-tab storage event.
- Edit gate (TC-94): override the canEditStore stub to false -> name editor disabled; Share, SharePanel copy and banner Copy still work.
- NotFound: tip text; recovery slot empty without the prop, renders the given node with it.

### 15. E2E tests: create/save link, return by link, bad link, rename, no leak, boot parallelism, dark mode

Implement workflows WF-1..WF-10 = TC-54 (superseded row), TC-55..TC-58, TC-63, TC-86..TC-89 in Playwright (chromium + webkit) against wrangler dev with a fresh local D1.
- WF-1: create, under 1000 ms locally, Save your link panel, Copy link & continue closes it (grant clipboard permission in chromium; webkit asserts the fallback selection), Share reopens titled 'Share'.
- WF-2: new browser context opens the copied link; reload keeps the URL and workspace.
- WF-3: random 43-char fragment -> Workspace not found with the cut-off tip; Start works.
- WF-4: rename, reload, second context sees the new name.
- WF-5: page.on('request') captures every URL and Referer across WF-1..4 and WF-6. Assert the secret never appears in a URL or Referer, all hosts same-origin, and the secret appears only in the POST open body or the GET link response.
- WF-6: navigate to /w/:id in the creating context, open Share -> link equals the creation link; fresh context opens it -> same workspace.
- WF-7 (TC-88): banner absent after Copy link & continue, still absent after reload; fresh context via link shows the banner.
- WF-8 (TC-89): clicking Email it to me issues no network request; no web-storage value contains the secret.
- WF-9 (TC-86): POST open request starts before the Workspace chunk response finishes.
- WF-10 (TC-87): colorScheme dark/light -> body background equals the matching --background token.

### 16. Implement GET workspace link endpoint

Depends on task 2.5 (workspace-auth).
1. workspace-auth: also set c.var.rememberedEntry, the verified cookie entry.
2. GET /api/w/:workspaceId/link returns {link: new URL(c.req.url).origin + '/w#' + entry.s}. Explicitly set Cache-Control: no-store. Never log it.
3. api.ts: getWorkspaceLink(id).
Called only on explicit user action on the /w/:id route: from useWorkspaceLink when the SharePanel is open (including its Bookmark action), from the unsaved-link banner's Copy (via queryClient.fetchQuery(queryKeys.link(id))), and from story 3's forget dialog. Never on page load. There is no separate Link dialog: story 4 reuses the SharePanel.
Tests: TC-59..TC-61 (integration), TC-63 (e2e), TC-65, TC-66, TC-70, TC-74 (ui-component via 2.10/2.17).

### 17. Build unsaved-link reminder banner, linkSaved store and copyText helper

1. `features/share/linkSaved.ts` (consumed by story 3): `hasSavedLink(id)` / `markLinkSaved(id)` / `isSnoozed(id)` / `snooze(id)` / `subscribe(fn)` / `useLinkReminderVisible(id)`. Versioned keys `tdl:v1:linkSaved:<id>` (localStorage) and `tdl:v1:linkSnoozed:<id>` (sessionStorage), value '1' only. Every access in try/catch; unavailable storage -> reported as not saved and not snoozed (banner stays). Module-level Map read cache invalidated on write and on the single shared window 'storage' listener. useLinkReminderVisible uses useSyncExternalStore with the boolean as snapshot.
2. `features/share/copyText.ts` (consumed by SharePanel and story 3): `copyText(text | Promise<string>, fallbackField?)` -> 'copied' | 'fallback'. String -> writeText; promise -> clipboard.write([new ClipboardItem({'text/plain': blob promise})]) when ClipboardItem exists; any failure -> focus+select fallbackField if given, resolve 'fallback'. Never throws.
3. `features/share/UnsavedLinkBanner.tsx` under the header (role=status), OUTSIDE the edit fieldset: text 'Your link isn't saved yet — you'll lose access if you clear this browser.'; 'Copy link' -> copyText(link) on hash route, copyText(queryClient.fetchQuery({queryKey: queryKeys.link(id), queryFn: getWorkspaceLink})) on id route; 'copied' -> markLinkSaved; 'fallback' -> open SharePanel in share mode. 'Remind me later' -> snooze. Wraps with full-width buttons below MOBILE_BREAKPOINT_PX; buttons >= MIN_TOUCH_TARGET_PX.
4. Render it from WorkspaceHeader (task 2.9); SharePanel (2.10) uses copyText + markLinkSaved.
Depends on: 2.9, 2.16.
Tests: TC-74..TC-77, TC-90, TC-92, TC-88.

### 18. Add light/dark theme tokens and enforce direct (non-barrel) imports

1. `packages/shared/src/tokens.ts`: semantic tokens (background, foreground, muted, muted-foreground, primary, primary-foreground, destructive, border, ring, warning, success) with light and dark values, plus light/dark values for the 12 PROJECT_COLORS (used by story 7).
2. `apps/web/scripts/build-tokens.ts` (bun) generates `apps/web/src/styles/tokens.css`: `:root` light vars, `@media (prefers-color-scheme: dark)` dark vars, `color-scheme: light dark`, and a global `prefers-reduced-motion: reduce` block disabling transitions/shimmer. Wire shadcn/Tailwind v4 theme to these vars; import from `index.css`. Commit the generated file; `bun run tokens` regenerates.
3. Contrast checker `packages/shared/src/contrast.ts` (WCAG relative luminance) used by the unit test: text pairs >= 4.5, UI pairs >= 3.0 in both themes. Adjust token values until all pass.
4. `apps/web/eslint.config.js`: `no-restricted-imports` banning `lucide-react` root, `@/features/*` directory/index imports, and `date-fns` outside `src/features/dates/picker/**`. Add `bun run lint`; make `bun run test` run lint first.
Tests: TC-85, TC-87, TC-91.


# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Protect the remembered-workspaces cookie with one attribute builder | proposed | implementation | remembered.cookie_attributes |
| 2 | Keep remembered workspaces in most-recently-opened order, including open-by-id | proposed | implementation | remembered.touch |
| 3 | Tell users when their oldest workspace is dropped from the browser list | proposed | implementation | remembered.cap_notice |
| 4 | List this browser's workspaces by name without ever exposing their secrets | proposed | implementation | remembered.list_api |
| 5 | Forget a workspace on this browser only | proposed | implementation | remembered.forget_api |
| 6 | Show remembered workspaces, Continue to the most recent, and helpful loading/empty states on Home | proposed | implementation | home.remembered_list, home.continue_recent |
| 7 | Confirm before forgetting, warn about unsaved links, and load the dialog on demand | proposed | implementation | forget.confirm_dialog, forget.unsaved_warning |
| 8 | Switch between remembered workspaces from inside a workspace | proposed | implementation | switcher.menu |
| 9 | Unit tests: remembered ordering, cap, forget, projection, cookie attributes, relative time | proposed | test:unit | remembered.touch, remembered.cap_notice, remembered.forget_api, remembered.list_api, remembered.cookie_attributes, home.remembered_list, home.continue_recent, workspace.instant_name |
| 10 | Integration tests: remembered list/touch/forget routes against real D1 and cookies | proposed | test:integration | remembered.list_api, remembered.touch, remembered.forget_api, remembered.cookie_attributes, remembered.cap_notice |
| 11 | UI component tests: Home, Continue, empty/loading states, forget dialog + unsaved warning, switcher, recovery, instant name, touch, offline, focus, ARIA, lazy loading | proposed | test:ui-component | home.remembered_list, home.continue_recent, forget.confirm_dialog, forget.unsaved_warning, switcher.menu, remembered.cap_notice, notfound.remembered, workspace.instant_name, remembered.touch, remembered.offline_usable |
| 12 | E2E tests: returning, continuing, switching, forgetting safely, recovering from bad links, and touch use in real browsers | proposed | test:e2e | remembered.list_api, remembered.touch, remembered.forget_api, remembered.cookie_attributes, remembered.cap_notice, home.remembered_list, home.continue_recent, switcher.menu, forget.confirm_dialog, forget.unsaved_warning, notfound.remembered, workspace.instant_name, remembered.offline_usable |
| 13 | Recover from bad links via remembered workspaces, and show the workspace name instantly when opening from the list | proposed | implementation | notfound.remembered, workspace.instant_name |
| 14 | Keep switching workspaces and forgetting them available when offline | proposed | implementation | remembered.offline_usable |

## Details

### 1. Protect the remembered-workspaces cookie with one attribute builder

Depends on story 2's cookie.ts codec (D-45 names: `readRemembered`, `serializeRememberedCookie`, `upsertRemembered(entries, entry, now)`).
Steps:
1. In apps/api/src/lib/cookie.ts (story 2 file; delta recorded in the design's Deltas section) factor the attribute string into one private builder used by story 2's `serializeRememberedCookie`, and add `clearRememberedCookieHeader(env)` using the same builder with Max-Age=0.
2. Attributes: HttpOnly; SameSite=Lax; Path=/api; Max-Age=REMEMBERED_COOKIE_MAX_AGE_S; Secure unless env.ENVIRONMENT is local.
3. No other Set-Cookie strings for tdl_ws anywhere; no `rememberedCookieHeader`/`encode…`/`decode…` names.
4. No numeric literals: import from packages/shared/src/limits.ts.
Done when TC-09, TC-10, TC-37 pass.

### 2. Keep remembered workspaces in most-recently-opened order, including open-by-id

Depends on task 1 and on story 2's open/create routes, crypto.ts, queryKeys.ts (which already defines `remembered()` and `rememberedTouch(id)`, D-37), lib/errors.ts + ApiErrorBoundary (D-20) and the `/w/:workspaceId` view (D-12).

Steps:
1. **cookie.ts (story 2 file, delta):**
   - Use story 2's `upsertRemembered(entries, {id,s}, now) -> {entries, dropped}` (removes existing id, prepends, truncates to MAX_REMEMBERED_WORKSPACES).
   - Add `touchRemembered(entries, id, now) -> entries | null`.
2. **routes/remembered.ts:** a new Hono sub-app at `/api/remembered`, mounted in app.ts, with `POST /:id/touch`:
   - CSRF header required; missing -> 403 forbidden_client. Bodyless, so no Content-Type is required.
   - Id not in the cookie -> 404 `{error:'not_found'}`.
   - Verify the secret with getWorkspacesByIds + hashSecret + constant-time compare. Mismatch or deleted -> 404, with no cookie change.
   - Leave a `classifyEntry` hook so story 9 adds the 410 `{error:'link_changed'}` branch for a previous secret (contract declared in the design; not implemented here).
   - Success -> 204 + `serializeRememberedCookie`.
3. **Web:**
   - Do NOT register `/w/:workspaceId` (story 2 owns routes, D-12) and do NOT edit queryKeys.ts (D-37).
   - `useTouchRemembered(id)`: `useQuery({queryKey: queryKeys.rememberedTouch(id), staleTime: Infinity, gcTime: Infinity, retry: false, throwOnError: true})`, no effect-based fetch. On success, inside queryFn, invalidate queryKeys.remembered(). Errors propagate to story 2's ApiErrorBoundary (NotFoundError -> NotFound state).
4. **Story 2 call sites (delta):** the `/w/:workspaceId` view calls `useTouchRemembered(id)`; useOpenWorkspace and the create mutation invalidate queryKeys.remembered() in onSuccess.

Done when TC-01, TC-02, TC-31..TC-34, TC-70 (touch 404 branch), TC-73, TC-80, TC-81 and TC-86 pass.

### 3. Tell users when their oldest workspace is dropped from the browser list

Depends on task 2.
Steps:
1. Confirm story 2's open and create responses include dropped (from `upsertRemembered(entries, entry, now)`); add if missing, typed in packages/shared/src/schemas.ts.
2. apps/web/src/features/remembered/useDroppedNotice.ts: `notifyDropped(dropped)` showing sonner toast "Your least recently opened workspace was removed from this browser's list. Its link still works." only when dropped > 0. Call from mutation onSuccess (event path, not useEffect).
3. apps/api/src/routes/test.ts (story 1's `/test/*` registry, D-35): register `POST /test/remembered-seed {count}` under the registry's story-3 row. It creates N workspaces and returns a Set-Cookie (via `serializeRememberedCookie`) holding them. 404 in production like every `/test/*` route.
Done when TC-03..TC-05, TC-35, TC-38, TC-59, TC-87 pass.

### 4. List this browser's workspaces by name without ever exposing their secrets

Depends on tasks 1-2.
Steps:
1. packages/shared/src/schemas.ts (D-27): `RememberedStatus = z.enum(['ok','unavailable','link_changed'])` with a comment that `link_changed` is produced by story 9; `RememberedItem {id, name: string|null, lastOpenedAt ISO, status}` and `RememberedListResponse`, both `.strict()`. No `available` field.
2. db/workspaces.ts: getWorkspacesByIds(db, ids) - one prepared SELECT id,name,secret_hash WHERE deleted = 0 AND id IN (...).
3. lib/remembered.ts: listRemembered(db, entries): start the D1 query and the Promise.all of hashSecret for every entry concurrently; `classifyEntry(row, hash)` returns 'ok' when the row exists and constant-time compare matches, else 'unavailable' (story 9 replaces this function to add 'link_changed'). name is null unless status is 'ok'. toPublic projects exactly the 4 keys.
4. GET /api/remembered: `readRemembered(cookie)`; absent -> []; value present but decodes to [] -> [] + clearRememberedCookieHeader; parse output through RememberedListResponse before returning. Never log cookie values.
Done when TC-08, TC-20..TC-26, TC-37, TC-84 pass.

### 5. Forget a workspace on this browser only

Depends on task 1.
Steps:
1. cookie.ts (story 2 file, delta): removeRemembered(entries, id) -> {entries, changed}.
2. DELETE /api/remembered/:id: CSRF header required (403). changed -> 204 + `serializeRememberedCookie`; not changed -> 204 without Set-Cookie. No D1 access. Works for every status.
3. middleware/csrf.ts (story 1): verify body-less DELETE is accepted when X-Todoodle-Client is present (Content-Type only enforced when a body exists); change only if it is not.
4. web api.ts: useForgetRemembered with onMutate snapshot + optimistic filter of `queryKeys.remembered()`, onError rollback + role=alert toast, onSettled invalidate. Not gated by useCanEdit (D-10).
Done when TC-06, TC-07, TC-27..TC-30, TC-36, TC-82, TC-83 pass.

### 6. Show remembered workspaces, Continue to the most recent, and helpful loading/empty states on Home

Depends on tasks 4, 5 and 7 (for preloadForgetDialog), and on story 2's queryKeys.ts (use only, D-37), workspacePath, workspaceQuery and Home route. Applies vercel-react-best-practices and architecture §12.

Steps:
1. **api.ts:** define `rememberedQuery = queryOptions({queryKey: queryKeys.remembered(), queryFn})`, parsing with RememberedListResponse.
2. **main.tsx:** if the pathname is '/', call `queryClient.prefetchQuery(rememberedQuery)` before render, so it runs in parallel with the chunk load (async-parallel).
3. **RememberedList** (`variant: 'home' | 'recovery'`): renders skeleton (3 rows) / error + Retry / empty / list, all via ternaries.
   - Heading `<h2 tabIndex={-1}>` "Your workspaces on this browser" (D-19 focus fallback target).
   - The empty state renders HomeEmptyHint only in the 'home' variant.
   - The Start button stays enabled in every state.
4. **RememberedRow (D-28):** `memo`, module scope, primitive props `{id, name, lastOpenedAt, status}`. `<li>` with sibling controls, never nested:
   - status 'ok': a Link to `workspacePath(id)` with the name and relativeTime, then a Remove button ("Remove <name> from this browser") that opens the lazy ForgetDialog and calls `preloadForgetDialog()` on pointerenter/focus.
   - other statuses: greyed text label `REMEMBERED_STATUS_LABEL[status]` + icon, no link, and a Remove button that forgets directly with no dialog.
   - Exhaustive switch over RememberedStatus. No DropdownMenu in rows.
5. **statusLabels.ts:** `REMEMBERED_STATUS_LABEL = {unavailable: 'Unavailable', link_changed: 'Link changed'}` (story 9 owns the link_changed copy).
6. **Touch:**
   - Add a `touch-target` utility (min-h-11 min-w-11) under `[@media(hover:none)]`.
   - Remove is `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`.
   - Use per-icon lucide imports only, with no barrel files.
7. **pickContinueTarget.ts** (pure, early exit on first `status === 'ok'`). **ContinueRecent** uses `useQuery({...rememberedQuery, select: pickContinueTarget})` with a module-level select. It renders the primary "Continue to <name>" link, or nothing. Hover/focus prefetches `workspaceQuery(id)` and preloads the Workspace chunk. There is no auto-navigation.
8. **Home.tsx:** compose ContinueRecent, RememberedList and Start. Start is secondary when Continue renders.
9. **relativeTime.ts:** a module-level cached `Intl.RelativeTimeFormat`, with thresholds as named constants.
10. No `useCanEdit()` anywhere in these files (D-10).

Done when TC-11, TC-12, TC-50..TC-54, TC-60..TC-63, TC-71, TC-76, TC-80, TC-85, TC-88 and TC-91 pass.

### 7. Confirm before forgetting, warn about unsaved links, and load the dialog on demand

Depends on task 5, and on story 2's `features/share/linkSaved.ts` (hasSavedLink/markLinkSaved), `useWorkspaceLink(id)`, `GET /api/w/:id/link`, `features/share/copyText.ts` and `lib/lazyWithRetry.ts` (D-42). The dialog is opened from Home Remove buttons (task 6) and from the switcher's "Forget this workspace on this browser…" item (task 8).

Steps:
1. Run `bunx shadcn add alert-dialog` if it is absent.
2. **forgetDialogLoader.ts:**
   - `const load = memoise(() => import('./ForgetDialog'))`
   - `export const LazyForgetDialog = lazyWithRetry(load)` (story 2 helper; not bare React.lazy)
   - `export function preloadForgetDialog()`, which returns the same promise every time
   - Callers mount the lazy dialog only after its first open, inside `<Suspense fallback={null}>`.
3. **ForgetDialog({workspace:{id,name}, open, onOpenChange, onForgotten}):**
   - Title "Forget <name> on this browser?"; body "This only removes it from this browser. Anyone with the link can still open it."; buttons Cancel / Forget.
   - Forget calls useForgetRemembered (optimistic), closes and calls onForgotten after success.
   - On failure, show the toast "Couldn't forget this workspace — try again" with role=alert.
   - Not gated by useCanEdit (D-10).
   - Focus (D-19): Cancel returns focus to the opener (Remove button, or the switcher chevron). After Forget the opener may be gone: `onCloseAutoFocus` checks `trigger.isConnected` and otherwise calls `focusListHeadingOrPage()` (list heading "Your workspaces on this browser", else the page h1); after the switcher's navigate-to-Home the same helper runs. Buttons use touch-target sizing.
4. **UnsavedLinkWarning:**
   - `const [saved, setSaved] = useState(() => hasSavedLink(id))`. A throwing localStorage reads as unsaved.
   - When unsaved, show the warning and a "Copy link" button.
   - Copy link calls `useWorkspaceLink(id, {enabled:false}).refetch()`, then `copyText(link)`. On success it calls `markLinkSaved(id)` and `setSaved(true)`, showing "Link copied — you can forget it safely." (role=status).
   - If the fetch fails: show "Couldn't get the link" with Retry.
   - If the clipboard is rejected or unavailable: show a read-only field, pre-selected, with "Copy it manually", and do not set the flag.
   - Forget is disabled only while the link request is in flight.
5. **Imports:** direct file imports only.

Done when TC-55, TC-56, TC-58, TC-64..TC-68, TC-72, TC-75, TC-82 and TC-89 pass.

### 8. Switch between remembered workspaces from inside a workspace

Depends on tasks 2, 6 and 7, and on story 2's AppShell (switcher-trigger slot `switcherSlot`, D-11), WorkspaceNameEditor (unchanged), workspaceQuery and workspacePath.

Steps (D-28):
1. **Trigger:** a separate chevron icon button beside the name editor, accessible name "Switch workspace", `aria-haspopup="menu"`, `aria-expanded`. Clicking the workspace name must still enter rename mode and never open the menu.
2. **WorkspaceSwitcher({currentId, currentName}):** shadcn DropdownMenu opened by the chevron. Menu order:
   - one menuitem per `status === 'ok'` entry from rememberedQuery (queryKeys.remembered()), in list order; current is a checked menuitemradio. `unavailable` and `link_changed` entries are omitted;
   - separator, then a standalone menuitem "Forget this workspace on this browser…" acting on the current workspace: its `onSelect` sets state that opens the existing lazy ForgetDialog for `{id: currentId, name: currentName}` (dialog rendered as a sibling of the menu, not inside its content). `onForgotten` navigates to `/` only after the DELETE succeeds; on failure stay put (toast from useForgetRemembered). Cancel returns focus to the chevron;
   - final menuitem "All workspaces…" navigating to `/`.
   - Every item is standalone text — no buttons or links nested inside any menu item, no per-workspace Remove, no SwitcherItem.tsx.
3. **Prefetch per workspace item:** on onPointerEnter/onFocus, call `queryClient.prefetchQuery(workspaceQuery(id))` (key queryKeys.workspace(id)) and preload the Workspace route chunk via story 2's loader.
   - Guard with a per-open `Set` held in a ref, so it fires once per item per open; clear it in onOpenChange(false).
   - onOpenChange(true) also calls preloadForgetDialog().
4. **Handlers:** stable useCallback with primitive deps.
5. **Touch:** trigger and all items get the touch-target class under hover:none.
6. **List error:** show only the current workspace, "Forget this workspace on this browser…" and "All workspaces…".
7. **Mount:** pass `<WorkspaceSwitcher currentId currentName />` to story 2's AppShell `switcherSlot` (not gated; works offline). Do not edit WorkspaceNameEditor. Does not read useCanEdit (D-10).

Done when TC-57, TC-58, TC-71, TC-72, TC-73, TC-74, TC-76 and TC-86 pass.

### 9. Unit tests: remembered ordering, cap, forget, projection, cookie attributes, relative time

Cases:

| Case | What it checks |
|---|---|
| TC-01, TC-02 | touch ordering via story 2's `upsertRemembered(entries, entry, now)` |
| TC-03, TC-04, TC-05 | cap boundaries 49/50/51 |
| TC-06, TC-07 | remove, id present / absent |
| TC-08 | public projection has exactly id, name, lastOpenedAt, status; ok with name / unavailable with null name; parses with `RememberedItem.strict()` |
| TC-09, TC-10 | `serializeRememberedCookie` and `clearRememberedCookieHeader` attributes per ENVIRONMENT (local/staging/production), and the clear variant |
| TC-11 | relative time boundaries 30s / 59s / 60s / 1d / 400d |
| TC-12 | pickContinueTarget: empty; single ok; first ok after unavailable and link_changed; none ok |
| TC-13 | rememberedPlaceholder with a real QueryClient: ok / unavailable / link_changed / absent / empty cache; cache unchanged afterwards |

Fixtures: real generateSecret output, real 32-hex ids and unicode names. Assert the arrays before and after, not just return values.

### 10. Integration tests: remembered list/touch/forget routes against real D1 and cookies

vitest-pool-workers with SELF.fetch, real Miniflare D1 seeded via story 2 createWorkspace; cookies built by the real codec (`serializeRememberedCookie`) except malformed cases.
Cases:
- TC-20..TC-26 (GET: absent; 3 valid -> every status 'ok' and keys exactly {id,name,lastOpenedAt,status}, no `available`; mismatch / soft-deleted / unknown id -> status 'unavailable', name null; 3 malformed variants -> [] + clearing Set-Cookie; 50 entries).
- TC-27..TC-30 (DELETE present/absent/no CSRF header/last entry; D1 row identical before and after).
- TC-31..TC-34 (touch reorder 204, absent 404 not_found, mismatch 404 not_found, no CSRF 403). The 410 link_changed touch case is story 9's.
- TC-35 (open at cap returns dropped 1).
- TC-36 (forget in cookie X does not affect cookie Y).
- TC-37 (Set-Cookie under 4096 bytes with 50 entries; HttpOnly, SameSite=Lax, Path=/api).
- TC-38 (`/test/remembered-seed` works locally, 404 with ENVIRONMENT=production).
Also assert raw response bodies contain none of the fixture secrets, and every GET body parses with RememberedListResponse.

### 11. UI component tests: Home, Continue, empty/loading states, forget dialog + unsaved warning, switcher, recovery, instant name, touch, offline, focus, ARIA, lazy loading

Tooling: vitest + happy-dom + Testing Library. MSW handlers for /api/remembered (including `unavailable` and `link_changed` items), DELETE, touch, the workspace query and GET /api/w/:id/link; all bodies are parsed through the shared schemas.

Stubs:
- navigator.clipboard in three modes: resolve / reject / undefined.
- matchMedia('(hover: none)') true or false.
- localStorage.getItem throwing, for TC-68.
- story 2's `useCanEdit` stub overridden to false, for TC-74.
- dynamic import rejecting once, for TC-72.

Cases:

| Case | What it checks |
|---|---|
| TC-50 | empty state; Start primary |
| TC-51 | `<ul>` of items in order; name link + relative time |
| TC-52 | unavailable and link_changed items: greyed, `REMEMBERED_STATUS_LABEL` text + icon, Remove button, no link |
| TC-53 | 3 skeleton rows, then error + Retry; Start enabled |
| TC-54 | name link navigates to workspacePath(id) |
| TC-55 | saved flag: no warning; Cancel sends nothing and refocuses Remove; Confirm is optimistic |
| TC-56 | 500 -> item restored + role=alert toast |
| TC-57 | switcher: separate "Switch workspace" chevron; ok items (current checked), then "Forget this workspace on this browser…", then final "All workspaces…"; non-ok absent; no per-workspace Remove; prefetch once per open |
| TC-58 | switcher "Forget this workspace…" opens ForgetDialog for the current workspace; success -> DELETE, navigate `/`, focus list heading; 500 -> stays with role=alert; Cancel -> nothing sent, focus to chevron. "All workspaces…" goes Home; name click renames and never opens menu; chevron never enters rename |
| TC-59 | dropped toast |
| TC-60 | Remove without a dialog for unavailable and link_changed |
| TC-61 | Continue is primary, Start is secondary, prefetch on hover |
| TC-62 | Continue hidden when no ok entries, loading, or error |
| TC-63 | no auto-navigation, using fake timers |
| TC-64 | unsaved warning: Copy -> exactly one GET link, clipboard, markLinkSaved, "Link copied"; Forget disabled while pending |
| TC-65 | saved flag: no link request |
| TC-66 | clipboard failure -> pre-selected field; flag not set |
| TC-67 | link 500 -> Retry; Forget still enabled |
| TC-68 | storage throws -> treated as unsaved |
| TC-69 | RememberedRecovery states inside story 2's ApiErrorBoundary NotFound state |
| TC-70 | placeholder name before GET resolves; replaced by real data; GET 404 and touch 404 -> boundary NotFound with RememberedRecovery; cold cache shows a skeleton; network error -> WorkspaceLoadFailed |
| TC-71 | hover:none shows Remove, switcher chevron and all menu items with touch-target class; hover:true hides Remove until hover/focus-within, still reachable by Tab |
| TC-72 | ForgetDialog module not imported until Remove hover/focus or switcher open; imported once on repeated preloads; recovers from one failed import (lazyWithRetry) |
| TC-73 | story 2's query keys used; invalidation isolation |
| TC-74 | useCanEdit false: switcher (incl. Forget this workspace… and All workspaces…), Home list, Remove, Forget all enabled; failed DELETE rolls back with role=alert |
| TC-75 | Forget focus fallback: list heading, or page h1 when the last item was forgotten |
| TC-76 | axe incl. nested-interactive on Home list and open switcher; every menu child is a standalone menuitem/menuitemradio/separator with no control inside |

Also run axe checks on Home, the recovery state and the dialog.

### 12. E2E tests: returning, continuing, switching, forgetting safely, recovering from bad links, and touch use in real browsers

Playwright against wrangler dev with a fresh local D1, using story 1's matrix (chromium and webkit desktop; TC-91 tagged `@mobile` runs on mobile-webkit iPhone 13 and mobile-chromium Pixel 7). Separate browser contexts stand in for separate browsers. Seeding via `/test/remembered-seed` (story 1 registry, D-35).

Workflows:

| Case | Workflow |
|---|---|
| TC-80 | created workspace is listed first |
| TC-81 | recency: B,A becomes A,B after opening A |
| TC-82 | Remove on Home with confirm; the saved link still opens A and re-adds it |
| TC-83 | forgetting in context 1 does not affect context 2 |
| TC-84 | document.cookie lacks tdl_ws; the /api/remembered body contains no secret |
| TC-85 | fresh context shows the empty-state hint and no Continue |
| TC-86 | "Switch workspace" chevron from B to A; then chevron -> "Forget this workspace on this browser…" -> Forget -> lands on Home with only B; "All workspaces…" returns Home |
| TC-87 | seed 50 via /test/remembered-seed, create one more -> toast, 50 listed, oldest gone |
| TC-88 | "Continue to B" shown; URL stays / for 2 s; click lands in B |
| TC-89 | Skip-for-now workspace -> Remove -> warning -> Copy link equals the real link (chromium clipboard permission; webkit asserts pre-selected fallback) -> forget -> copied link reopens |
| TC-90 | bad /w# link -> NotFound state lists A (RememberedRecovery) -> click -> lands in A |
| TC-91 | @mobile: Remove visible without hover, tap-to-forget works, Remove, switcher chevron, switcher menu items and dialog buttons ≥ 44x44 via boundingBox |
| TC-92 | with GET /api/w/A delayed 1 s via route, the header shows A's name within 200 ms of the click |
| TC-93 | offline (context.setOffline): switcher chevron enabled and lists A and Forget this workspace…; Home list renders; Forget fails and A is restored with an error toast |

### 13. Recover from bad links via remembered workspaces, and show the workspace name instantly when opening from the list

Depends on task 6 (RememberedList variant), and on story 2's ApiErrorBoundary with its recovery slot (D-20), the `/w/:workspaceId` view (D-12) and workspaceQuery. Cross-story edits are recorded in the design's Deltas section.

Steps:
1. **RememberedRecovery.tsx** (story 3 owns, D-20): `export function RememberedRecovery()` rendering `<RememberedList variant="recovery" />`. With 0 entries or on error it renders nothing; while loading it shows skeletons. It never reveals anything about the bad link.
2. **Wire into story 2:** story 2's ApiErrorBoundary NotFound state (catch-all and NotFoundError) renders `<RememberedRecovery />` in its recovery slot above "Start a new list". Do NOT register or edit any route in App.tsx (D-12).
3. **rememberedPlaceholder.ts:**
   - `rememberedPlaceholder(queryClient, id)` reads `queryClient.getQueryData(queryKeys.remembered())` without fetching and returns `{id, name}` for a `status === 'ok'` entry, else undefined.
   - It builds a Map by id, memoised on the list array's identity (a WeakMap keyed by the array).
4. **Story 2 `/w/:workspaceId` view:** call `workspaceQuery(id, {placeholderData: rememberedPlaceholder(queryClient, id)})` (existing option).
   - Header renders the name from data, placeholder or real; while isPlaceholderData, the body shows skeleton rows.
   - NotFoundError propagates to ApiErrorBoundary (NotFound + RememberedRecovery); other errors to WorkspaceLoadFailed. Placeholder is discarded.
   - No setQueryData in render or effects.

Done when TC-13, TC-69, TC-70, TC-90 and TC-92 pass.

### 14. Keep switching workspaces and forgetting them available when offline

Implements D-10 for story 3 (design: remembered.offline_usable). Depends on tasks 6, 7 and 8, and on story 2's AppShell (which disables nothing itself; every control that sends a change self-gates with `useCanEdit()`) and `useCanEdit` stub.

Steps:
1. Confirm WorkspaceSwitcher is mounted through AppShell's `switcherSlot` and is not gated (works offline); Home and RememberedRecovery are not gated either.
2. Add an ESLint `no-restricted-imports` rule forbidding `features/live/canEdit` under `apps/web/src/features/remembered/**`, so no story-3 control gates itself.
3. ForgetDialog stays enabled offline; the offline DELETE failure uses the existing rollback + role=alert toast (no new copy).
4. Verify with `useCanEdit` forced false that the chevron, menu items, Home links, Remove and Forget are enabled.

Done when TC-74 and TC-93 pass.


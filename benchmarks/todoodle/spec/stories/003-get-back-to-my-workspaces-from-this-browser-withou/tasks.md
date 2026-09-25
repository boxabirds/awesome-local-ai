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
| 11 | UI component tests: Home, Continue, empty/loading states, forget dialog + unsaved warning, switcher, NotFound recovery, instant name, touch, lazy loading | proposed | test:ui-component | home.remembered_list, home.continue_recent, forget.confirm_dialog, forget.unsaved_warning, switcher.menu, remembered.cap_notice, notfound.remembered, workspace.instant_name, remembered.touch |
| 12 | E2E tests: returning, continuing, switching, forgetting safely, recovering from bad links, and touch use in real browsers | proposed | test:e2e | remembered.list_api, remembered.touch, remembered.forget_api, remembered.cookie_attributes, remembered.cap_notice, home.remembered_list, home.continue_recent, switcher.menu, forget.confirm_dialog, forget.unsaved_warning, notfound.remembered, workspace.instant_name |
| 13 | Recover from bad links via remembered workspaces, and show the workspace name instantly when opening from the list | proposed | implementation | notfound.remembered, workspace.instant_name |

## Details

### 1. Protect the remembered-workspaces cookie with one attribute builder

Depends on story 2's cookie.ts codec.
Steps:
1. In apps/api/src/lib/cookie.ts export rememberedCookieHeader(value, env) and clearRememberedCookieHeader(env). Attributes: HttpOnly; SameSite=Lax; Path=/api; Max-Age=REMEMBERED_COOKIE_MAX_AGE_S; add Secure when env.ENVIRONMENT is staging or production. Clear variant Max-Age=0.
2. If story 2 already has an inline Set-Cookie string, replace it with the builder so every write path shares attributes.
3. No numeric literals: import from packages/shared/src/limits.ts.
Done when TC-09, TC-10, TC-37 pass.

### 2. Keep remembered workspaces in most-recently-opened order, including open-by-id

Depends on task 1 and on story 2's open/create routes, crypto.ts and queryKeys.ts.

Steps:
1. **cookie.ts:**
   - Ensure `upsertRemembered(entries, {id,s}, nowSec) -> {entries, dropped}` removes any existing entry for the id, prepends the new one, and truncates to MAX_REMEMBERED_WORKSPACES.
   - Add `touchRemembered(entries, id, nowSec) -> entries | null`.
2. **routes/remembered.ts:** a new Hono sub-app at `/api/remembered`, registered in app.ts, with `POST /:id/touch`:
   - CSRF header required; missing -> 403 forbidden_client. Bodyless, so no Content-Type is required.
   - Id not in the cookie -> 404 not_found.
   - Verify the secret with getWorkspacesByIds + hashSecret + constantTimeEqual. Mismatch or deleted -> 404, with no cookie change.
   - Success -> 204 + rememberedCookieHeader.
3. **Web:**
   - Add route `/w/:workspaceId` in App.tsx, loading the lazy Workspace chunk shared with `/w`.
   - Extend queryKeys.ts with `remembered()` = ['remembered'] and `rememberedTouch(id)` = ['remembered-touch', id].
   - useTouchRemembered: `useQuery(queryKeys.rememberedTouch(id), {staleTime: Infinity, gcTime: Infinity, retry: false})`, with no effect-based fetch. On 404 render NotFound; on success, inside queryFn, invalidate queryKeys.remembered().
4. **Story 2 hooks:** in useOpenWorkspace (story 2) and the create mutation, invalidate queryKeys.remembered() in onSuccess.

Done when TC-01, TC-02, TC-31..TC-34, TC-73, TC-80, TC-81 and TC-86 pass.

### 3. Tell users when their oldest workspace is dropped from the browser list

Depends on task 2.
Steps:
1. Confirm story 2's open and create responses include dropped (from upsertRemembered); add if missing, typed in packages/shared/src/schemas.ts.
2. apps/web/src/features/remembered/useDroppedNotice.ts: function notifyDropped(dropped) showing sonner toast "Your least recently opened workspace was removed from this browser's list. Its link still works." only when dropped > 0. Call from mutation onSuccess (event path, not useEffect).
3. apps/api/src/routes/test.ts: POST /test/remembered-seed {count} (404 in production) creating N workspaces and returning a Set-Cookie holding them, for e2e TC-87.
Done when TC-03..TC-05, TC-35, TC-59, TC-87 pass.

### 4. List this browser's workspaces by name without ever exposing their secrets

Depends on tasks 1-2.
Steps:
1. packages/shared/src/schemas.ts: RememberedPublic {id, name: string|null, lastOpenedAt ISO, available} and RememberedListResponse, both .strict().
2. db/workspaces.ts: getWorkspacesByIds(db, ids) - one prepared SELECT id,name,secret_hash WHERE deleted = 0 AND id IN (...).
3. lib/remembered.ts: listRemembered(db, entries): start the D1 query and the Promise.all of hashSecret for every entry concurrently; available = row exists && constantTimeEqual; unavailable -> name null. toPublic projects exactly the 4 keys.
4. GET /api/remembered: decode cookie; absent -> []; decode failure -> [] + clearRememberedCookieHeader; parse output through RememberedListResponse before returning. Never log cookie values.
Done when TC-08, TC-20..TC-26, TC-37, TC-84 pass.

### 5. Forget a workspace on this browser only

Depends on task 1.
Steps:
1. cookie.ts: removeRemembered(entries, id) -> {entries, changed}.
2. DELETE /api/remembered/:id: CSRF header required (403). changed -> 204 + Set-Cookie; not changed -> 204 without Set-Cookie. No D1 access.
3. middleware/csrf.ts (story 1): allow body-less DELETE when X-Todoodle-Client present (Content-Type only enforced when a body exists).
4. web api.ts: useForgetRemembered with onMutate snapshot + optimistic filter of ['remembered'], onError rollback + toast, onSettled invalidate.
Done when TC-06, TC-07, TC-27..TC-30, TC-36, TC-82, TC-83 pass.

### 6. Show remembered workspaces, Continue to the most recent, and helpful loading/empty states on Home

Depends on tasks 4, 5 and 7 (for preloadForgetDialog), and on story 2's queryKeys.ts and workspaceQuery. Applies vercel-react-best-practices and architecture §12.

Steps:
1. **api.ts:** define `rememberedQuery = queryOptions({queryKey: queryKeys.remembered(), queryFn})`.
2. **main.tsx:** if the pathname is '/', call `queryClient.prefetchQuery(rememberedQuery)` before render, so it runs in parallel with the chunk load (async-parallel).
3. **RememberedList** (`variant: 'home' | 'notfound'`): renders skeleton (3 rows) / error + Retry / empty / list, all via ternaries.
   - The empty state renders HomeEmptyHint only in the 'home' variant.
   - The Start button stays enabled in every state.
4. **RememberedRow:** `memo`, defined at module scope, primitive props only.
   - Available row: a Link to `/w/:id` with the name and relativeTime.
   - Unavailable row: greyed "Unavailable" label plus Remove, which forgets directly with no dialog.
   - Row "..." menu, "Forget on this browser": opens the lazy ForgetDialog, and calls `preloadForgetDialog()` on onOpenChange(true), pointerenter or focus.
5. **Touch:**
   - Add a `touch-target` utility (min-h-11 min-w-11) under `[@media(hover:none)]`.
   - The menu trigger is `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`.
   - Use per-icon lucide imports only, with no barrel files.
6. **pickContinueTarget.ts** (pure, early exit). **ContinueRecent** uses `useQuery({...rememberedQuery, select: pickContinueTarget})` with a module-level select. It renders the primary "Continue to <name>" link, or nothing. Hover/focus prefetches `workspaceQuery(id)` and preloads the Workspace chunk. There is no auto-navigation.
7. **Home.tsx:** compose ContinueRecent, RememberedList and Start. Start is secondary when Continue renders.
8. **relativeTime.ts:** a module-level cached `Intl.RelativeTimeFormat`, with thresholds as named constants.

Done when TC-11, TC-12, TC-50..TC-54, TC-60..TC-63, TC-71, TC-80, TC-85, TC-88 and TC-91 pass.

### 7. Confirm before forgetting, warn about unsaved links, and load the dialog on demand

Depends on task 5, and on story 2's `features/share/linkSaved.ts` (hasSavedLink/markLinkSaved), `useWorkspaceLink(id)`, `GET /api/w/:id/link` and the `copyText` clipboard helper.

Steps:
1. Run `bunx shadcn add alert-dialog` if it is absent.
2. **forgetDialogLoader.ts:**
   - `const load = () => import('./ForgetDialog')`, memoised promise
   - `export const LazyForgetDialog = React.lazy(load)`
   - `export function preloadForgetDialog()`, which returns the same promise every time
   - Callers mount the lazy dialog only after its first open, inside `<Suspense fallback={null}>`.
3. **ForgetDialog({workspace:{id,name}, open, onOpenChange, onForgotten}):**
   - Title "Forget <name> on this browser?"; body "This only removes it from this browser. Anyone with the link can still open it."; buttons Cancel / Forget.
   - Forget calls useForgetRemembered (optimistic), closes and calls onForgotten.
   - On failure, show the toast "Couldn't forget this workspace — try again" with role=alert.
   - Focus returns to the trigger (Radix default). Buttons use touch-target sizing.
4. **UnsavedLinkWarning:**
   - `const [saved, setSaved] = useState(() => hasSavedLink(id))`. A throwing localStorage reads as unsaved.
   - When unsaved, show the warning and a "Copy link" button.
   - Copy link calls `useWorkspaceLink(id, {enabled:false}).refetch()`, then `copyText(link)`. On success it calls `markLinkSaved(id)` and `setSaved(true)`, showing "Link copied — you can forget it safely." (role=status).
   - If the fetch fails: show "Couldn't get the link" with Retry.
   - If the clipboard is rejected or unavailable: show a read-only field, pre-selected, with "Copy it manually", and do not set the flag.
   - Forget is disabled only while the link request is in flight.
5. **Imports:** direct file imports only.

Done when TC-55, TC-56, TC-64..TC-68, TC-72, TC-82 and TC-89 pass.

### 8. Switch between remembered workspaces from inside a workspace

Depends on tasks 2, 6 and 7, and on story 2's WorkspaceHeader and workspaceQuery.

Steps:
1. **WorkspaceSwitcher({currentId}):** a shadcn DropdownMenu on the workspace name.
   - Items come from rememberedQuery (queryKeys.remembered(), available only); the current one is checked.
   - Footer: "Forget this workspace on this browser" opens the lazy ForgetDialog, whose onForgotten navigates to '/'. Also "All workspaces".
2. **Prefetch per item:** on onPointerEnter/onFocus, call `queryClient.prefetchQuery(workspaceQuery(id))` (key ['ws', id, 'workspace']) and preload the Workspace route chunk.
   - Guard with a per-open `Set` held in a ref, so it fires once per item per open; clear it in onOpenChange(false).
   - onOpenChange(true) also calls preloadForgetDialog().
3. **Handlers:** stable useCallback with primitive deps.
4. **Touch:** items get the touch-target class under hover:none.
5. **List error:** show only the current workspace and "All workspaces".
6. **Mount** in WorkspaceHeader.

Done when TC-57, TC-58, TC-71, TC-73 and TC-86 pass.

### 9. Unit tests: remembered ordering, cap, forget, projection, cookie attributes, relative time

Cases:

| Case | What it checks |
|---|---|
| TC-01, TC-02 | touch ordering |
| TC-03, TC-04, TC-05 | cap boundaries 49/50/51 |
| TC-06, TC-07 | remove, id present / absent |
| TC-08 | public projection has exactly id, name, lastOpenedAt, available |
| TC-09, TC-10 | cookie attributes per ENVIRONMENT (local/staging/production), and the clear variant |
| TC-11 | relative time boundaries 30s / 59s / 60s / 1d / 400d |
| TC-12 | pickContinueTarget: empty; single; first-available after unavailable; all unavailable |
| TC-13 | rememberedPlaceholder with a real QueryClient: available / unavailable / absent / empty cache; cache unchanged afterwards |

Fixtures: real generateSecret output, real 32-hex ids and unicode names. Assert the arrays before and after, not just return values.

### 10. Integration tests: remembered list/touch/forget routes against real D1 and cookies

vitest-pool-workers with SELF.fetch, real Miniflare D1 seeded via story 2 createWorkspace; cookies built by the real codec (except malformed cases).
Cases: TC-20..TC-26 (GET: absent, valid x3, mismatch, soft-deleted, unknown id, 3 malformed variants, 50 entries), TC-27..TC-30 (DELETE present/absent/no CSRF header/last entry; D1 row identical before and after), TC-31..TC-34 (touch reorder, absent 404, mismatch 404, no CSRF 403), TC-35 (open at cap returns dropped 1), TC-36 (forget in cookie X does not affect cookie Y), TC-37 (Set-Cookie under 4096 bytes with 50 entries; HttpOnly, SameSite=Lax, Path=/api).
Also assert raw response bodies contain none of the fixture secrets.

### 11. UI component tests: Home, Continue, empty/loading states, forget dialog + unsaved warning, switcher, NotFound recovery, instant name, touch, lazy loading

Tooling: vitest + happy-dom + Testing Library. MSW handlers for /api/remembered, DELETE, touch, the workspace query and GET /api/w/:id/link; all bodies are parsed through the shared schemas.

Stubs:
- navigator.clipboard in three modes: resolve / reject / undefined.
- matchMedia('(hover: none)') true or false.
- localStorage.getItem throwing, for TC-68.

Cases:

| Case | What it checks |
|---|---|
| TC-50 | empty state; Start primary |
| TC-51 | ordered rows with relative time |
| TC-52 | unavailable row greyed, not a link |
| TC-53 | 3 skeleton rows, then error + Retry; Start enabled |
| TC-54 | navigation |
| TC-55 | saved flag: no warning; Cancel sends nothing; Confirm is optimistic |
| TC-56 | 500 -> row restored + role=alert toast |
| TC-57 | prefetch of ['ws', id, 'workspace'] once per open |
| TC-58 | forgetting the current workspace goes Home |
| TC-59 | dropped toast |
| TC-60 | Remove without a dialog |
| TC-61 | Continue is primary, Start is secondary, prefetch on hover |
| TC-62 | Continue hidden when all entries unavailable, loading, or error |
| TC-63 | no auto-navigation, using fake timers |
| TC-64 | unsaved warning: Copy -> exactly one GET link, clipboard, markLinkSaved, "Link copied"; Forget disabled while pending |
| TC-65 | saved flag: no link request |
| TC-66 | clipboard failure -> pre-selected field; flag not set |
| TC-67 | link 500 -> Retry; Forget still enabled |
| TC-68 | storage throws -> treated as unsaved |
| TC-69 | NotFound slot states |
| TC-70 | placeholder name before GET resolves; replaced by real data; 404 drops it; cold cache shows a skeleton |
| TC-71 | hover:none shows the trigger with touch-target class; hover:true hides it until hover/focus-within, still reachable by Tab |
| TC-72 | ForgetDialog module not imported until menu open; imported once even on repeated preloads |
| TC-73 | query key prefixes and invalidation isolation |

Also run axe checks on Home, NotFound and the dialog.

### 12. E2E tests: returning, continuing, switching, forgetting safely, recovering from bad links, and touch use in real browsers

Playwright against wrangler dev with a fresh local D1 (chromium and webkit, plus an iPhone 13 hasTouch project for TC-91). Separate browser contexts stand in for separate browsers.

Workflows:

| Case | Workflow |
|---|---|
| TC-80 | created workspace is listed first |
| TC-81 | recency: B,A becomes A,B after opening A |
| TC-82 | forget with confirm; the saved link still opens A and re-adds it |
| TC-83 | forgetting in context 1 does not affect context 2 |
| TC-84 | document.cookie lacks tdl_ws; the /api/remembered body contains no secret |
| TC-85 | fresh context shows the empty-state hint and no Continue |
| TC-86 | switcher from B to A |
| TC-87 | seed 50 via /test/remembered-seed, create one more -> toast, 50 listed, oldest gone |
| TC-88 | "Continue to B" shown; URL stays / for 2 s; click lands in B |
| TC-89 | Skip-for-now workspace -> forget warning -> Copy link equals the real link (chromium clipboard permission; webkit asserts pre-selected fallback) -> forget -> copied link reopens |
| TC-90 | bad /w# link -> NotFound lists A -> click -> lands in A |
| TC-91 | mobile touch: menu trigger visible without hover, tap-to-forget works, trigger and dialog buttons ≥ 44x44 via boundingBox |
| TC-92 | with GET /api/w/A delayed 1 s via route, the header shows A's name within 200 ms of the click |

### 13. Recover from bad links via remembered workspaces, and show the workspace name instantly when opening from the list

Depends on task 6 (RememberedList variant), and on story 2's NotFound route, workspaceQuery and WorkspaceHeader. These are documented cross-story edits.

Steps:
1. **NotFound.tsx** (story 2): accept a `recovery?: ReactNode` prop and render it above "Start a new list". App.tsx passes `recovery={<RememberedList variant="notfound" />}`, so NotFound does not import story-3 internals. With 0 entries or on error the slot renders nothing; while loading it shows skeletons. The page never reveals anything about the bad link.
2. **rememberedPlaceholder.ts:**
   - `rememberedPlaceholder(queryClient, id)` reads `queryClient.getQueryData(queryKeys.remembered())` without fetching and returns `{id, name}` for an available entry, else undefined.
   - It builds a Map by id, memoised on the list array's identity (a WeakMap keyed by the array).
3. **workspaceQuery(id)** (story 2): add `placeholderData: () => rememberedPlaceholder(queryClient, id)`.
4. **WorkspaceHeader:**
   - Renders the name from data, whether placeholder or real.
   - While isPlaceholderData, the body shows skeleton rows.
   - A 404 renders NotFound and the placeholder is discarded; a network error shows "Couldn't load this workspace" with Try again.
   - No setQueryData happens in render or effects.

Done when TC-13, TC-69, TC-70, TC-90 and TC-92 pass.


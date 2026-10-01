# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Define shared live event contract and live constants | proposed | implementation | live.broadcast |
| 2 | WorkspaceRoom Durable Object and authenticated /live upgrade endpoint | proposed | implementation | live.room |
| 3 | Broadcast helper and wire workspace rename to live events | proposed | implementation | live.broadcast |
| 4 | Verify story 2's single SharePanel meets the share requirements (no new share UI) | proposed | implementation | share.panel |
| 5 | Join via shared link starts the live connection | proposed | implementation | share.join |
| 6 | Client live connection, handler registry, per-frame batching and screen-reader announcer | proposed | implementation | live.client_sync |
| 7 | Live paused vs offline: reconnect, health probe, Reconnecting pill, offline banner and useCanEdit edit gate | proposed | implementation | live.connection_status |
| 8 | Reusable edit guard with conflict choice (Use my version / Keep theirs) and deleted notices | proposed | implementation | live.conflict_notice |
| 9 | Unit tests: event contract, room, dispatch/registry/batching/announcer, socket+network+derived UI, edit guard matrix | proposed | test:unit | live.broadcast, live.room, live.client_sync, live.connection_status, live.conflict_notice |
| 10 | Integration tests: live endpoint auth/origin, DO fan-out, broadcast, link and join contracts | proposed | test:integration | live.room, live.broadcast, share.panel, share.join |
| 11 | UI-component tests: shared SharePanel pins, live provider/announcer, pill vs banner gating, conflict choice | proposed | test:ui-component | share.panel, live.client_sync, live.connection_status, live.conflict_notice |
| 12 | E2E tests: share, join, live propagation, offline vs live-paused, conflict choice | proposed | test:e2e | share.panel, share.join, live.client_sync, live.connection_status, live.conflict_notice |

## Details

### 1. Define shared live event contract and live constants

Depends on: story 1 (packages/shared scaffold) and story 2 (WorkspaceDTO schema, `COPY_CONFIRM_MS`).

Steps:
1. Add to `limits.ts`:
   - `LIVE_RECONNECT_BASE_MS=1_000`
   - `LIVE_RECONNECT_JITTER=0.2`
   - `CONFLICT_RECENT_EDIT_WINDOW_MS=10_000`
   - `LIVE_MAX_EVENT_BYTES=16_384`
   - Close codes (story 4 owns all four; D-22): `LIVE_CLOSE_BAD_ORIGIN=4403`, `LIVE_CLOSE_NOT_FOUND=4404`, `LIVE_CLOSE_LINK_CHANGED=4410` (emitted by story 9), `LIVE_CLOSE_RATE_LIMITED=4429` (emitted by story 10)
   - `LIVE_ANNOUNCE_THROTTLE_MS=10_000`
   - `LIVE_PAUSED_AFTER_MS=5_000`

   Do **not** define `COPY_CONFIRM_MS`: story 2 defines it and story 4 only references it (D-44). Remove `LIVE_OFFLINE_AFTER_MS`, or mark it deprecated if another story already references it.
2. `events.ts` — the final `LiveEvent` shape (design live.broadcast, D-25):
   - a zod discriminated union with the 8 type literals;
   - `project.deleted.entity = {id, batchId}` (batchId required; emitted by story 7);
   - `tasks.bulk.entity = {ids: string[], deleted?: boolean}` with refetch semantics documented in JSDoc;
   - `ProjectDTO`/`TaskDTO` placeholder schemas, marked for field extension by stories 5, 7 and 8;
   - exported types, an `isUuid` helper and `eventByteSize(event)`.
3. Consumers import by direct path. No barrel re-exports (architecture §12).

Done when types compile in api and web, and TC-E01 to TC-E03, TC-E05, TC-E07 and TC-E08 pass. Those cases are written in task 4.9.

### 2. WorkspaceRoom Durable Object and authenticated /live upgrade endpoint

Depends on: task 4.1; story 2 workspace-auth.

Steps:
1. `WorkspaceRoom` extends `DurableObject`:
   - constructor sets `setWebSocketAutoResponse(ping/pong)`;
   - `fetch()` creates a `WebSocketPair`, `ctx.acceptWebSocket(server)`, returns 101;
   - `broadcast(event)` RPC serialises once, sends to `ctx.getWebSockets()`, closes throwing sockets with 1011, returns `{delivered, failed}`;
   - `closeAll(code, reason)` RPC closes every socket with that code (extension point for story 9's 4410 and story 10's force-close test route);
   - `webSocketMessage` ignores; `webSocketClose`/`webSocketError` close.
2. `acceptAndClose(code, reason)` in `live/acceptAndClose.ts`: Worker-side `WebSocketPair`, `server.accept()`, `server.close(code, reason)`, return 101 with the client end. Exported for stories 9 and 10.
3. `routes/live.ts` `GET /api/w/:id/live` — accept-then-close (D-22):
   - no `Upgrade: websocket` → HTTP 426 `{error:'upgrade_required'}` (the only HTTP rejection);
   - `Origin` ≠ `new URL(req.url).origin` or missing → `acceptAndClose(4403, 'bad_origin')`, before auth;
   - named slot for story 10's `live_connect` limit (→ 4429, reason = seconds); empty in story 4;
   - story 2's workspace-auth in non-responding form; failure (missing entry, mismatch, deleted, unknown id) → `acceptAndClose(4404, 'not_found')`, identical in every case;
   - named slot for story 9's previous-secret check (→ 4410); empty in story 4;
   - authorised → forward to `WORKSPACE_ROOM.get(idFromName(id)).fetch(req)`.
   - Remove the old pre-upgrade HTTP 403 `forbidden_client` and HTTP 404 rejections.
   - If story 2 only exposes workspace-auth as a responding middleware, raise the delta on story 2 rather than duplicating the hash check.
4. `finalizeResponse`: pass status 101 through untouched (accepted and reject-by-close alike).
5. `wrangler.toml`: durable_objects binding `WORKSPACE_ROOM` in base, `env.staging`, `env.production`; `[[migrations]] tag v1 new_sqlite_classes=[WorkspaceRoom]`. Export the class from index.ts. Add the binding type to env.ts.

Done when TC-L01 to TC-L11, TC-R01 to TC-R07 pass.

### 3. Broadcast helper and wire workspace rename to live events

Depends on: tasks 4.1 and 4.2; story 2 `PATCH /api/w/:id` rename.

Steps:
1. `broadcast(c, workspaceId, event): void` — **the single signature (D-26)**:
   - `originClientId` from `X-Todoodle-Client-Id` if a UUID, else `null`;
   - `LiveEvent.parse`; reject and log if `eventByteSize > LIVE_MAX_EVENT_BYTES`;
   - **calls `c.executionCtx.waitUntil(stub.broadcast(event).catch(err => log with requestId))` itself**;
   - never throws, returns `void`, never awaited by the caller.
   - Do not create `broadcastEvent(env, ctx, …)`, a caller-side `waitUntil` wrapper, or any direct `room.broadcast` call from routes.
2. In the rename handler: after a successful D1 update (version incremented, RETURNING row) call `broadcast(c, id, {type:'workspace.updated', ...})`. No broadcast on 400/500 or when the name is unchanged (no-op write).
3. JSDoc on `broadcast()` for stories 5–8: one call per committed, non-no-op write; exact call form `broadcast(c, wid, event)`; `tasks.bulk` = `{ids, deleted?}` with refetch semantics; `project.deleted` carries `batchId`.

Done when TC-B01 to TC-B06, TC-E04, TC-E06 and TC-E09 pass.

### 4. Verify story 2's single SharePanel meets the share requirements (no new share UI)

**Scope (owner decision 2026-09-25, updated 2026-09-27 per D-17):** Link and Share are one SharePanel owned by story 2 (`features/share/SharePanel.tsx`, `ShareButton.tsx`, `copyText.ts`, `SHARE_ACCESS_NOTE`, `COPY_CONFIRM_MS`). This task builds no share UI; it verifies `prd.share_panel` against story 2's panel. Nothing is dropped. There is no `features/share/copy.ts`; earlier references to it are wrong.

Depends on: story 2 SharePanel, ShareButton, copyText, useWorkspaceLink, `SHARE_ACCESS_NOTE`, `COPY_CONFIRM_MS`, `GET /api/w/:id/link`, and AppShell. Do NOT add an endpoint, component or constant. If story 2's panel lacks a required behaviour, file a story 2 bug rather than forking the component.

Steps:
1. Confirm the panel's primary button in share mode is labelled **Copy link** and that it renders `SHARE_ACCESS_NOTE` (story 2 value now; story 9 replaces it). Tests import the constant; they never pin its literal text.
2. Confirm the copy confirmation uses story 2's `COPY_CONFIRM_MS` (referenced, not redefined; D-44).
3. Confirm the Share button sits in the AppShell header and that Share, Copy link, Email and Bookmark are **not** gated by `useCanEdit()` (not gated; they work offline per the D-10 offline-works list).
4. Confirm the link source switches correctly between `/w#secret` (in memory, no request) and `/w/:id` (fetched).

Done when TC-S01 to TC-S08 and e2e W1 and W7 pass.

### 5. Join via shared link starts the live connection

Depends on: story 2's open flow (early open request from main.tsx, `ApiErrorBoundary`, `WorkspaceLoadFailed`, `AppShell`); the story 3 cookie codec; and task 4.6 (LiveProvider).

Steps:
1. Workspace route: once story 2's open promise resolves, render `<LiveProvider workspaceId>` inside story 2's `ApiErrorBoundary` and around `AppShell`.
   - On 404, the boundary renders its NotFound state (a state, not a route; D-12/D-20) and LiveProvider is NOT mounted.
   - On a network error or 5xx, `WorkspaceLoadFailed` (retryable) renders and LiveProvider is not mounted.
2. Ordering:
   - The open request runs in parallel with the route chunk load; story 2 owns this in main.tsx.
   - The workspace data queries (`['ws', id, ...]`, `prefetchWorkspaceData`) start only after open returns the id, then run in parallel with each other and with the live socket.
3. No server change. Confirm story 2's open is idempotent for repeated opens: one cookie entry, moved to the front. If it isn't, raise a bug on story 2/3 rather than patching here.

Done when TC-J01 to TC-J04 and e2e W1 and W2 pass.

### 6. Client live connection, handler registry, per-frame batching and screen-reader announcer

Depends on: task 4.1, and story 2's queryKeys.ts (`['ws', id, ...]`) and AppShell.

Steps:
1. `clientId.ts`: a module-level `crypto.randomUUID()`. api.ts sends `X-Todoodle-Client-Id` on every request.
2. `registry.ts`:
   - `registerLiveHandler(type, fn)` over `Map<type, Set<fn>>`; handlers return `'applied' | 'stale'`.
   - Returns an unregister function.
   - This is the single name and the extension point for stories 5–11. Do NOT create `registerEventApplier` or `applyEvent.ts`.
3. `dispatch.ts`, `dispatchEvent(ctx, event)`, applied per event:
   - safeParse failure: warn and ignore;
   - own echo: ignore;
   - no handlers: `invalidateQueries({queryKey:['ws', id]})`;
   - otherwise run all handlers.
   - If any handler applied it, call `editGuard.notify` and `announcer.record`.
4. `features/live/LiveConnection.ts` (plain class, no React; D-43 — the only live-connection module, story 9 conforms):
   - Opens `/api/w/:id/live` and queues frames.
   - Flushes once per animation frame inside `notifyManager.batch`.
   - Uses `setTimeout(0)` instead of rAF while `document.visibilityState === 'hidden'`.
   - Exposes `subscribe`/`getSnapshot` (socket status and close-code handling are added in task 4.7).
5. `queryClient.ts`: set `notifyManager.setScheduler` to the same visibility-aware rAF/timeout scheduler.
6. Handlers registered by LiveProvider once per workspace:
   - `workspace.updated`: `setQueryData(['ws', id, 'workspace'])` if the event is newer.
   - `tasks.bulk` (`{ids, deleted?}`, D-25): invalidate `['ws', id, 'tasks']` and `['ws', id, 'counts']`; **never** `setQueryData`.
7. `announcer.ts` (pure, injectable clock):
   - Leading-edge announcement, then at most one per `LIVE_ANNOUNCE_THROTTLE_MS`.
   - Messages: `1 change made by someone else` / `N changes made by someone else`.
   - `LiveAnnouncer.tsx` renders a visually hidden `role=status aria-live=polite` region, mounted once in story 2's `features/shell/AppShell.tsx`.
8. `LiveProvider`: a lazy `useState` initialiser, and an effect keyed on the primitive `workspaceId`.

Done when TC-C01 to TC-C18 pass (unit and UI-component).

### 7. Live paused vs offline: reconnect, health probe, Reconnecting pill, offline banner and useCanEdit edit gate

Depends on: task 4.6, story 1's `GET /api/health`, and story 2's AppShell, `canEdit.ts` stub, `lib/errors.ts` and `ApiErrorBoundary`.

Steps:
1. `backoff.ts` (pure): `min(BASE*2^n, MAX)` × (1 ± JITTER), with an injectable random source.
2. LiveConnection socket states: `connecting / open / reconnecting / rate_limited / stopped / not_found / link_changed`.
   - Ping every `LIVE_PING_INTERVAL_MS`; the socket is dead if no pong arrives within one interval.
   - `pausedLong` timer: set after `LIVE_PAUSED_AFTER_MS` in any non-open, non-hand-off state; cleared on open.
   - On open after reconnecting/rate_limited: `invalidateQueries(['ws', id])` exactly once, and reset attempts.
   - A socket drop NEVER sets offline.
3. `closeCodes.ts` `LIVE_CLOSE_HANDLING` (D-22), keyed by the shared constants — decisions on close code only (browsers can't see upgrade HTTP status):
   - 4404 → `not_found`, never retry, hand off `{error:'not_found'}`;
   - 4410 → `link_changed`, never retry, hand off `{error:'link_changed'}` (LinkChanged once story 9 registers it);
   - 4429 → `rate_limited`, one retry after exactly `reason` seconds (positive integer), else normal backoff; editing stays on;
   - 4403 → `stopped`, never retry, no hand-off, `console.error`; editing stays on;
   - anything else → `reconnecting` with backoff.
4. `LiveProvider`: on a hand-off state, throw the error produced by story 2's body-keyed `lib/errors.ts` mapper during render so `ApiErrorBoundary` renders it.
5. `network.ts` NetworkMonitor:
   - Initial state from `navigator.onLine`.
   - Offline on a window `offline` event, or when api.ts reports a network-level failure (TypeError). HTTP 4xx and 5xx are NOT offline.
   - While offline, probes `api.health()` (no-store): immediately on `online`, otherwise on the backoff schedule.
   - A successful probe sets online and calls `invalidateQueries(['ws', id])` once. Window listeners registered once per app.
6. `deriveLiveUi(socket, pausedLong, network)` (pure): `banner = offline`; `pill = !banner && pausedLong`; `canEdit = online && socket ∉ {not_found, link_changed}`.
7. `canEdit.ts` (D-10): replace story 2's stub implementation behind the same exports (`useCanEdit`, `getCanEdit`, `subscribe`, `getSnapshot`); boolean snapshot; subscribers re-render only on flips. Do not create `canEditStore`.
8. Edit gate (decision 2026-09-27: **there is no `<fieldset disabled>` anywhere in the app**; the name `WorkspaceShell` is retired):
   - AppShell disables nothing itself. Every control that sends a change gates itself with `useCanEdit()` (or `getCanEdit()` in key handlers).
   - `WorkspaceNameEditor.tsx` (header) reads `useCanEdit()`.
   - Document the contract for extenders (live.connection_status): story 5's TaskRow cells gate once for every grid (checkbox off, name button always on and opens detail read-only, `…` trigger on with its mutating items off, Retry off, Discard on); grid mutating keys (Space, Delete, E-commit, M, D) no-op via `getCanEdit()`, navigation keys always work; QuickAdd input typeable with submit gated; overlays, sheets, pickers, dialogs, Finder action bar, Get a new link, toast Undo, sidebar and header controls self-gate.
   - Inputs are never remounted, so drafts survive.
9. `ReconnectingPill` (role=status, "Reconnecting…") and `OfflineBanner` (role=status aria-live=polite, "You're offline — changes can't be saved right now"), in the AppShell header, rendered with a ternary.
10. api.ts: mutating calls reject with `OfflineError` (nothing sent) while `!canEdit`; network failures reject with `NetworkError` and notify NetworkMonitor. `errors.ts`: add `OfflineError`, `NetworkError`.

Done when TC-O01, TC-O02, TC-O05 to TC-O26, TC-M01 to TC-M14 and e2e W4, W8 and W9 pass.

### 8. Reusable edit guard with conflict choice (Use my version / Keep theirs) and deleted notices

Depends on: task 4.6; story 2's `lib/errors.ts` (body-keyed map) and `features/shell/WorkspaceNameEditor.tsx`.

Steps:
1. `editGuard.ts`: a pure per-key state machine (Idle, Editing, RecentlySaved, Conflicted) following the design's state diagram and TC-G01 to TC-G21, TC-G31, plus a `Map<key, guard>` registry.
   - `notify(event)` is called from `dispatchEvent`. Own echoes are ignored.
   - A changed upsert while Editing or RecentlySaved moves to Conflicted, keeping `mine` (changed fields only) and `theirs`.
   - A newer upsert while Conflicted updates only `theirs`.
   - A deletion, or `tasks.bulk` with `deleted: true` containing the key's id, fires the gone path. `tasks.bulk` without `deleted` never conflicts.
2. `useEditGuard({key, fields, entityLabel, save})` — the final signature (D-18) — returns `{arm, disarm, markSaved, conflict, useMine, keepTheirs}`.
   - `save` and `fields` are held in refs; `conflict` via `useSyncExternalStore`.
   - `useMine`: success → RecentlySaved; `GoneError` → gone path; `NetworkError` → stay Conflicted, keep `mine`, return the error.
   - `keepTheirs`/`disarm`: Idle.
3. `conflictCopy.ts`: `conflictMessage(label)` = "Someone else changed this <label> just now.", `goneMessage(label)` = "This <label> was deleted", `USE_MINE_LABEL`, `KEEP_THEIRS_LABEL`. Consumers and other stories' tests import these.
4. `ConflictNotice.tsx`: inline `role=alert` notice with `conflictMessage(entityLabel)`, their value, keyboard-reachable **Use my version** (disabled while `!useCanEdit()`, D-10) and **Keep theirs** (always enabled). Persists until the user chooses.
5. `showConflictToast.ts` for editor-closed (RecentlySaved): sonner toast, `duration: Infinity`, `id = key`, both actions, same offline gating.
6. `errors.ts` (D-20): **register** `gone → GoneError{entity}` in story 2's map keyed by `body.error`. Do not map by status: a 410 with `{error:'link_changed'}` must not become `GoneError`. Remove any "api.ts maps HTTP 410 to GoneError" logic. Add `handleMutationError(err, {key, entityLabel})`: roll back, remove the entity from `['ws', id, ...]` caches, toast `goneMessage(entityLabel)`.
7. Wire `WorkspaceNameEditor` with `useEditGuard({key:'workspace:'+id, fields:{name}, entityLabel:'workspace', save: renameMutation})`.
8. JSDoc usage example for stories 6 and 7 (`task:<id>` / `project:<id>` keys).

Done when TC-G01 to TC-G31 and e2e W5 pass.

### 9. Unit tests: event contract, room, dispatch/registry/batching/announcer, socket+network+derived UI, edit guard matrix

Cases, from the design test strategy:
- TC-E01 to TC-E09 (union incl. `tasks.bulk {ids, deleted?}` and `project.deleted {id, batchId}`; `broadcast` calls `waitUntil` itself)
- TC-R01, TC-R02, TC-R07 (`closeAll`)
- TC-C01 to TC-C08, TC-C11 to TC-C16 and TC-C18 (registry Set semantics, per-frame batch, hidden-tab path, announcer throttle, bulk refetch-only)
- TC-O01, TC-O02, TC-O05 to TC-O08, TC-O13 to TC-O17 and TC-O20 to TC-O23 (socket, close codes 4404/4410/4429/4403 with hand-off via story 2's body-keyed error map, NetworkMonitor, health probe, canEdit notifications)
- TC-M01 to TC-M14 (the deriveLiveUi matrix incl. rate_limited, stopped, link_changed)
- TC-G01 to TC-G21, TC-G28, TC-G29, TC-G31 (guard matrix, Conflicted actions, conflict copy constants, `gone` registration by `body.error`, bulk delete)

Test setup:
- Fake timers for boundaries: 4,999/5,000 ms for the pill, 44,999/45,000 ms for a 4429 reason of 45, and 9,999/10,000 ms for the edit window and the announcer.
- Fake socket able to emit any close code and reason; fake requestAnimationFrame; stubbed `document.visibilityState`.
- `api.health` injected as a stub with scripted results. Injectable random for jitter bounds.
- Real story 2 `lib/errors.ts` map (not mocked) for TC-O07, TC-O20, TC-G29.
- Fixtures from zod types, with realistic hex ids and UUID client ids. No I/O.

### 10. Integration tests: live endpoint auth/origin, DO fan-out, broadcast, link and join contracts

vitest-pool-workers with SELF.fetch, against real Miniflare D1 and the WorkspaceRoom DO. Workspaces are created via the real POST /api/workspaces; soft delete via `/test/seed-workspace {deleted:true}` (no `/test/sql`).

Cases:
- TC-L01 to TC-L11 — accept-then-close (D-22): plain GET → HTTP 426 `upgrade_required`; every other rejection is **101 then close** — 4403 for bad/missing Origin (TC-L03, L04), 4404 `not_found` for every auth failure (TC-L05 to L09, identical code and reason); 101 passes finalizeResponse untouched (TC-L10); rejected sockets never receive frames (TC-L11). There are no HTTP 403/404 assertions on `/live` any more.
- TC-R03 to TC-R06
- TC-B01 to TC-B06. TC-B04 overrides the DO binding with a throwing stub.
- TC-S01 to TC-S05, which pin story 2's GET /api/w/:id/link that the shared SharePanel depends on.
- TC-J01 to TC-J04

Assert state before and after:
- D1 name and version before and after rename.
- Cookie entries before and after open.
- 404 bodies byte-identical across TC-S02 and S03; close code and reason identical across TC-L05, L06 and L09.

### 11. UI-component tests: shared SharePanel pins, live provider/announcer, pill vs banner gating, conflict choice

vitest + happy-dom + Testing Library, with MSW for HTTP and mock-socket for WebSocket. Story 2's SharePanel, ShareButton, AppShell and `lib/errors.ts` are imported as-is; do not stub them.

Cases:
- **TC-S06 to TC-S08:** primary button "Copy link"; access note equals the imported `SHARE_ACCESS_NOTE` constant (no literal text); both link sources; Share, Copy link, Email, Bookmark enabled while offline (`copyText` spied).
- **TC-C09, TC-C10 and TC-C17:** a single socket, cache propagation, and the polite live region.
- **TC-O09 to TC-O12, TC-O18, TC-O19 and TC-O24 to TC-O26:**
  - the pill keeps editing on;
  - the banner shows; there is no `<fieldset>` in the document; a main-region control gated by `useCanEdit()` is disabled while a plain main-region input stays enabled; the header name editor is disabled via `useCanEdit()`;
  - drafts are retained, asserting the same DOM node;
  - no requests while offline;
  - no re-renders on socket flips;
  - portalled dialog and toast Undo self-gate via `useCanEdit()` (TC-O24);
  - offline-works controls stay usable: nav, Show completed toggle, header panel trigger; a self-gated main-region button is disabled (TC-O25);
  - quick-add pattern: input typeable, submit disabled, text kept (TC-O26).
- **TC-G22 to TC-G27 and TC-G30:**
  - the inline notice text equals `conflictMessage('workspace')`, Use my version, Keep theirs and keyboard reachability;
  - the persistent toast replaced per key;
  - 410 `{error:'gone'}` handling with `goneMessage('task')`;
  - no notice on own echo;
  - Use my version disabled offline, Keep theirs enabled (TC-G30).

### 12. E2E tests: share, join, live propagation, offline vs live-paused, conflict choice

Playwright against local wrangler dev with a fresh D1, using story 1's project matrix (D-36). Each participant is a separate browser context, so separate cookie jars. Clipboard permission is granted where supported.

Workflows, from the design test strategy:
- **W1:** create, Share, click **Copy link**, join. The panel note equals `SHARE_ACCESS_NOTE`.
- **W2:** a rename propagates within 5 s, and the polite live-region text appears.
- **W3:** 10 contexts.
- **W4:** `setOffline` for 8 s with a draft typed in. Assert the banner, editing disabled, the draft kept and Share → Copy link still working, then recovery heals the missed rename.
- **W5:** conflict notice (text equals `conflictMessage('workspace')`), then Use my version. Both clients end with A's value.
- **W6:** a no-cookie live connection receives close code 4404 and no event frames.
- **W7:** return via `/w/:workspaceId`, then Share shows the same link.
- **W8:** `page.routeWebSocket` drops only the socket.
  - The Reconnecting pill appears after 5 s.
  - Renaming still works, and A sees it.
  - When the socket is restored, the pill clears and the outage rename is healed.
- **W9:** B's cookies are cleared and B's socket is dropped; the reconnect is closed with 4404, B shows the `ApiErrorBoundary` NotFound state, and no further `/live` attempts occur within 10 s.


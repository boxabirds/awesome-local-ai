# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Define shared live event contract and live constants | proposed | implementation | live.broadcast |
| 2 | WorkspaceRoom Durable Object and authenticated /live upgrade endpoint | proposed | implementation | live.room |
| 3 | Broadcast helper and wire workspace rename to live events | proposed | implementation | live.broadcast |
| 4 | Verify story 2's single SharePanel meets the share requirements (no new share UI) | proposed | implementation | share.panel |
| 5 | Join via shared link starts the live connection | proposed | implementation | share.join |
| 6 | Client live connection, handler registry, per-frame batching and screen-reader announcer | proposed | implementation | live.client_sync |
| 7 | Live paused vs offline: reconnect, health probe, Reconnecting pill, offline banner and fieldset edit gate | proposed | implementation | live.connection_status |
| 8 | Reusable edit guard with conflict choice (Use my version / Keep theirs) and deleted notices | proposed | implementation | live.conflict_notice |
| 9 | Unit tests: event contract, room, dispatch/registry/batching/announcer, socket+network+derived UI, edit guard matrix | proposed | test:unit | live.broadcast, live.room, live.client_sync, live.connection_status, live.conflict_notice |
| 10 | Integration tests: live endpoint auth/origin, DO fan-out, broadcast, link and join contracts | proposed | test:integration | live.room, live.broadcast, share.panel, share.join |
| 11 | UI-component tests: shared SharePanel pins, live provider/announcer, pill vs banner gating, conflict choice | proposed | test:ui-component | share.panel, live.client_sync, live.connection_status, live.conflict_notice |
| 12 | E2E tests: share, join, live propagation, offline vs live-paused, conflict choice | proposed | test:e2e | share.panel, share.join, live.client_sync, live.connection_status, live.conflict_notice |

## Details

### 1. Define shared live event contract and live constants

Depends on: story 1 (packages/shared scaffold) and story 2 (WorkspaceDTO schema).

Steps:
1. Add to `limits.ts`:
   - `LIVE_RECONNECT_BASE_MS=1_000`
   - `LIVE_RECONNECT_JITTER=0.2`
   - `CONFLICT_RECENT_EDIT_WINDOW_MS=10_000`
   - `LIVE_MAX_EVENT_BYTES=16_384`
   - `LIVE_CLOSE_NOT_FOUND=4404`
   - `LIVE_CLOSE_BAD_ORIGIN=4403`
   - `COPY_CONFIRM_MS=2_000`, if story 2 has not already added it
   - `LIVE_ANNOUNCE_THROTTLE_MS=10_000`
   - `LIVE_PAUSED_AFTER_MS=5_000`

   Remove `LIVE_OFFLINE_AFTER_MS`, or mark it deprecated if another story already references it. Socket loss no longer means offline (design live.connection_status).
2. `events.ts`:
   - a zod discriminated union `LiveEvent` with the 9 type literals from the design;
   - `ProjectDTO`/`TaskDTO` placeholder schemas, marked for extension by stories 5 and 7;
   - exported types;
   - an `isUuid` helper;
   - `eventByteSize(event)`.
3. Consumers import by direct path. No barrel re-exports (architecture §12).

Done when types compile in api and web, and TC-E01 to TC-E05 pass. Those cases are written in the unit test task.

### 2. WorkspaceRoom Durable Object and authenticated /live upgrade endpoint

Depends on: task 1; story 2 workspace-auth middleware.
Steps:
1. WorkspaceRoom extends DurableObject: constructor sets setWebSocketAutoResponse(ping/pong); fetch() creates WebSocketPair, ctx.acceptWebSocket(server), returns 101; broadcast(event) RPC serialises once, sends to ctx.getWebSockets(), closes throwing sockets with 1011, returns {delivered, failed}; webSocketMessage ignores; webSocketClose/Error close.
2. routes/live.ts: GET /api/w/:id/live -> 426 without Upgrade; Origin must equal new URL(req.url).origin else 403 forbidden_client (before auth); then workspace-auth (404 on failure); forward to WORKSPACE_ROOM.get(idFromName(id)).fetch(req).
3. finalizeResponse: pass status 101 through untouched (do not reconstruct Response; preserve webSocket).
4. wrangler.toml: durable_objects binding WORKSPACE_ROOM in base, env.staging, env.production; [[migrations]] tag v1 new_sqlite_classes=[WorkspaceRoom]. Export class from index.ts. Add binding type to env.ts.
Done when TC-L01..L10, TC-R01..R06 pass.

### 3. Broadcast helper and wire workspace rename to live events

Depends on: tasks 1-2; story 2 PATCH /api/w/:id rename.
Steps:
1. broadcast(c, workspaceId, event): originClientId from X-Todoodle-Client-Id if UUID else null; LiveEvent.parse; reject + log if eventByteSize > LIVE_MAX_EVENT_BYTES; c.executionCtx.waitUntil(stub.broadcast(event).catch(err => log with requestId)). Never throws, never awaited by caller.
2. In rename handler: after successful D1 update (version incremented, RETURNING row) call broadcast with type workspace.updated. No broadcast on 400/500 or when name unchanged (no-op write).
3. Document the rule 'one broadcast per committed write' in a JSDoc on broadcast() for stories 5-8.
Done when TC-B01..B05, TC-E04..E06 pass.

### 4. Verify story 2's single SharePanel meets the share requirements (no new share UI)

**Scope move (owner decision, 2026-09-25):** Link and Share are merged into one SharePanel owned by story 2 (features/share/SharePanel.tsx and ShareButton.tsx). This task no longer builds the share UI. Nothing is dropped: prd.share_panel is still verified here, and the build work moved to story 2 tasks 2.10 and 2.14.

Depends on: story 2 SharePanel, ShareButton, useWorkspaceLink, and GET /api/w/:id/link. Do NOT add a new endpoint or component. If story 2's panel lacks any required behaviour, file a story 2 bug rather than forking the component.

Steps:
1. Confirm story 2's `copy.ts` access statement reads exactly: "This link is the key to this workspace — for you and anyone you send it to. Anyone with it can see and change everything. Access can't be removed yet." The integration and UI tests import it.
2. In WorkspaceShell (with task 4.7), ensure the header Share button and Copy sit outside the edit-gating `<fieldset>`, so sharing works while offline.
3. Confirm the link source switches correctly between `/w#secret` (in memory, no request) and `/w/:id` (fetched).

Done when TC-S01 to TC-S08 and e2e W1 and W7 pass.

### 5. Join via shared link starts the live connection

Depends on: story 2's open flow, including the early open request started from main.tsx; the story 3 cookie codec; and task 4.6 (LiveProvider).

Steps:
1. Workspace route: once story 2's open promise resolves, wrap the shell in `<LiveProvider workspaceId>`.
   - On 404, render NotFound and do NOT mount LiveProvider.
   - On a network error or 500, show a retryable error.
2. Ordering (corrected per the React audit):
   - The open request runs in parallel with the route chunk load; story 2 owns this in main.tsx.
   - The workspace data queries (`['ws', id, ...]`) start only after open returns the id, then run in parallel with each other and with the live socket.
   - Do not claim or attempt parallelism between open and data. The id comes from open.
3. No server change. Confirm story 2's open is idempotent for repeated opens: one cookie entry, moved to the front. If it isn't, raise a bug on story 2/3 rather than patching here.

Done when TC-J01 to TC-J04 and e2e W1 and W2 pass.

### 6. Client live connection, handler registry, per-frame batching and screen-reader announcer

Depends on: task 4.1, and story 2's queryKeys.ts (`['ws', id, ...]`).

Steps:
1. `clientId.ts`: a module-level `crypto.randomUUID()`. api.ts sends `X-Todoodle-Client-Id` on every request.
2. `registry.ts`:
   - `registerLiveHandler(type, fn)` over `Map<type, Set<fn>>`.
   - Returns an unregister function.
   - This is the single name. Do NOT create `registerEventApplier` or `applyEvent.ts`.
3. `dispatch.ts`, `dispatchEvent(ctx, event)`, applied per event:
   - safeParse failure: warn and ignore;
   - own echo: ignore;
   - no handlers: `invalidateQueries({queryKey:['ws', id]})`;
   - otherwise run all handlers. Each returns applied or stale.
   - If any handler applied it, call `editGuard.notify` and `announcer.record`.
4. `LiveConnection` (plain class, no React):
   - Opens `/api/w/:id/live` and queues frames.
   - Flushes once per animation frame inside `notifyManager.batch`.
   - Uses `setTimeout(0)` instead of rAF while `document.visibilityState === 'hidden'`.
   - No `startTransition`.
   - Exposes `subscribe`/`getSnapshot` (socket status is extended in task 4.7).
5. `queryClient.ts`: set `notifyManager.setScheduler` to the same visibility-aware rAF/timeout scheduler.
6. Handlers registered by LiveProvider once per workspace:
   - `workspace.updated`: `setQueryData(['ws', id, 'workspace'])` if the event is newer.
   - `tasks.bulk`: invalidate `['ws', id, 'tasks']` and `['ws', id, 'counts']`.
7. `announcer.ts` (pure, injectable clock):
   - Leading-edge announcement, then at most one per `LIVE_ANNOUNCE_THROTTLE_MS`.
   - Messages: `1 change made by someone else` / `N changes made by someone else`.
   - `LiveAnnouncer.tsx` renders a visually hidden `role=status aria-live=polite` region, mounted once in WorkspaceShell.
8. `LiveProvider`: a lazy `useState` initialiser, and an effect keyed on the primitive `workspaceId`.

Done when TC-C01 to TC-C17 pass (unit and UI-component).

### 7. Live paused vs offline: reconnect, health probe, Reconnecting pill, offline banner and fieldset edit gate

Depends on: task 4.6, story 1's `GET /api/health`, and story 2's WorkspaceShell.

Steps:
1. `backoff.ts` (pure): `min(BASE*2^n, MAX)` × (1 ± JITTER), with an injectable random source.
2. LiveConnection socket states: connecting / open / reconnecting / not_found.
   - Ping every `LIVE_PING_INTERVAL_MS`; the socket is dead if no pong arrives within one interval.
   - `pausedLong` timer: set after `LIVE_PAUSED_AFTER_MS` in connecting or reconnecting, cleared on open.
   - On open after reconnecting: `invalidateQueries(['ws', id])` exactly once, and reset attempts.
   - Close 4404 or a 404 upgrade: terminal `not_found`.
   - A socket drop NEVER sets offline.
3. `network.ts` NetworkMonitor:
   - Initial state from `navigator.onLine`.
   - Goes offline on a window `offline` event, or when api.ts reports a network-level failure (a TypeError). HTTP 4xx and 5xx are NOT offline.
   - While offline, probes `api.health()` (`GET /api/health`, no-store): immediately on the `online` event, otherwise on the backoff schedule.
   - A successful probe sets online and calls `invalidateQueries(['ws', id])` once.
   - Window listeners are registered once per app.
4. `deriveLiveUi(socket, pausedLong, network)` (pure):
   - `banner = offline`
   - `pill = !banner && pausedLong`
   - `canEdit = online && socket !== 'not_found'`
5. `canEdit.ts`: a boolean-snapshot store plus `useCanEdit()`. Subscribers re-render only when it flips.
6. WorkspaceShell:
   - One `<fieldset disabled={!canEdit} className="contents">` wraps the sidebar and main editing areas.
   - Share, nav links and the Show-completed toggle stay outside it.
   - Inputs are never remounted, so drafts survive.
7. `ReconnectingPill` (role=status, "Reconnecting…") and `OfflineBanner` (role=status aria-live=polite, "You're offline — changes can't be saved right now"). Both render with a ternary.
8. api.ts:
   - Mutating calls reject with `OfflineError`, and send nothing, while `!canEdit`.
   - Network failures reject with `NetworkError` and notify NetworkMonitor.

Done when TC-O01, O02, O05–O19, TC-M01–M10 and e2e W4 and W8 pass.

### 8. Reusable edit guard with conflict choice (Use my version / Keep theirs) and deleted notices

Depends on: task 4.6.

Steps:
1. `editGuard.ts`: a pure per-key state machine (Idle, Editing, RecentlySaved, Conflicted) following the design's state diagram and the TC-G01 to TC-G21 matrix, plus a `Map<key, guard>` registry.
   - `notify(event)` is called from `dispatchEvent`.
   - Own echoes are ignored.
   - A changed upsert while Editing or RecentlySaved moves to Conflicted, keeping `mine` (the changed fields only) and `theirs`.
   - A newer upsert while Conflicted updates only `theirs`.
   - A deletion fires the gone path.
2. `useEditGuard({key, fields, entityLabel, save})` returns `{arm, disarm, markSaved, conflict, useMine, keepTheirs}`.
   - `save` and `fields` are held in refs.
   - `conflict` is exposed via `useSyncExternalStore`.
   - `useMine`:
     - `save(mine)` succeeds: RecentlySaved.
     - `GoneError`: gone path.
     - `NetworkError`: stay Conflicted, keep `mine`, return the error.
   - `keepTheirs`/`disarm`: Idle.
3. `ConflictNotice.tsx`:
   - An inline `role=alert` notice reading "Someone else changed this just now."
   - Shows their value, with keyboard-reachable **Use my version** and **Keep theirs** buttons.
   - Persists until the user chooses.
4. `showConflictToast.ts` for when the editor is closed (RecentlySaved): a sonner toast with `duration: Infinity`, `id = key` (replaces an earlier one), and both actions.
5. `errors.ts`:
   - `GoneError`; api.ts maps 410 to it.
   - `handleMutationError(err, {key, entityLabel})` rolls back, removes the entity from the `['ws', id, ...]` caches, and toasts "This <label> was deleted".
6. Wire WorkspaceName with `useEditGuard({key:'workspace:'+id, fields:{name}, entityLabel:'workspace', save: renameMutation})`.
7. Add a JSDoc usage example for stories 6 and 7 (task and project editors).

Done when TC-G01 to TC-G27 and e2e W5 pass.

### 9. Unit tests: event contract, room, dispatch/registry/batching/announcer, socket+network+derived UI, edit guard matrix

Cases, from the design test strategy:
- TC-E01 to TC-E06 and TC-R01 to TC-R02
- TC-C01 to TC-C08 and TC-C11 to TC-C16 (registry Set semantics, per-frame batch, hidden-tab path, announcer throttle)
- TC-O01, TC-O02, TC-O05 to TC-O08 and TC-O13 to TC-O17 (socket, NetworkMonitor, health probe, canEdit notifications)
- TC-M01 to TC-M10 (the deriveLiveUi matrix)
- TC-G01 to TC-G21 (the guard matrix and Conflicted actions)

Test setup:
- Fake timers for boundaries: 4,999/5,000 ms for the pill and 9,999/10,000 ms for the edit window and the announcer.
- Fake requestAnimationFrame and a stubbed `document.visibilityState`.
- `api.health` injected as a stub with scripted results.
- Injectable random for jitter bounds.
- Fixtures from zod types, with realistic hex ids and UUID client ids.
- No I/O.

### 10. Integration tests: live endpoint auth/origin, DO fan-out, broadcast, link and join contracts

vitest-pool-workers with SELF.fetch, against real Miniflare D1 and the WorkspaceRoom DO. Workspaces are created via the real POST /api/workspaces.

Cases:
- TC-L01 to TC-L10
- TC-R03 to TC-R06
- TC-B01 to TC-B06. TC-B04 overrides the DO binding with a throwing stub.
- TC-S01 to TC-S05, which pin story 2's GET /api/w/:id/link that the shared SharePanel depends on.
- TC-J01 to TC-J04

Assert state before and after:
- D1 name and version before and after rename.
- Cookie entries before and after open.
- 404 bodies byte-identical across TC-L05, L06 and L09, and across TC-S02 and S03.

No change in cases from the previous version. The story 2 SharePanel merge does not alter the server contracts.

### 11. UI-component tests: shared SharePanel pins, live provider/announcer, pill vs banner gating, conflict choice

vitest + happy-dom + Testing Library, with MSW for HTTP and mock-socket for WebSocket. Story 2's SharePanel is imported as-is; do not stub it.

Cases:
- **TC-S06 to TC-S08:** the access statement, both link sources, and Share enabled while offline.
- **TC-C09, TC-C10 and TC-C17:** a single socket, cache propagation, and the polite live region.
- **TC-O09 to TC-O12, TC-O18 and TC-O19:**
  - the pill keeps editing on;
  - the banner and fieldset disable editing;
  - drafts are retained, asserting the same DOM node;
  - no requests while offline;
  - no re-renders on socket flips.
- **TC-G22 to TC-G27:**
  - the inline notice, Use my version, Keep theirs and keyboard reachability;
  - the persistent toast replaced per key;
  - 410 handling;
  - no notice on own echo.

### 12. E2E tests: share, join, live propagation, offline vs live-paused, conflict choice

Playwright (Chromium) against local wrangler dev with a fresh D1. Each participant is a separate browser context, so separate cookie jars. Clipboard permission is granted.

Workflows, from the design test strategy:
- **W1:** create, Share, copy, join.
- **W2:** a rename propagates within 5 s, and the polite live-region text appears.
- **W3:** 10 contexts.
- **W4:** `setOffline` for 8 s with a draft typed in. Assert the banner, editing disabled and the draft kept, then recovery heals the missed rename.
- **W5:** conflict notice, then Use my version. Both clients end with A's value.
- **W6:** a no-cookie live connection is refused.
- **W7:** return via `/w/:workspaceId`, then Share shows the same link.
- **W8:** `page.routeWebSocket` drops only the socket.
  - The Reconnecting pill appears after 5 s.
  - Renaming still works, and A sees it.
  - When the socket is restored, the pill clears and the outage rename is healed.


# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Write service worker unit tests first: request classification and old cache cleanup (TC-01, TC-02) | proposed | test:unit | offline.app_shell |
| 2 | Implement release-scoped service worker for the offline app shell | proposed | implementation | offline.app_shell |
| 3 | Write device copy and eviction unit tests first (TC-03 to TC-07) | proposed | test:unit | offline.local_store, offline.cache_manager |
| 4 | Implement device copy store: availability probe, y-indexeddb copy with load timeout, quota watcher, discard | proposed | implementation | offline.local_store |
| 5 | Implement cache manager: index DB, 50-board limit, storage pressure eviction, unsynced flag | proposed | implementation | offline.cache_manager |
| 6 | Browser-mode integration tests with real IndexedDB for device copies and eviction (TC-10 to TC-15, TC-36, TC-39) | proposed | test:integration | offline.local_store, offline.cache_manager |
| 7 | Write sync tracker unit tests first: frame classification and ack state machine (TC-08, TC-09) | proposed | test:unit | offline.sync_ack |
| 8 | Implement sync acknowledgement: room acks stored data frames, client counting socket and tracker wiring | proposed | implementation | offline.sync_ack |
| 9 | Integration tests for sync acknowledgement against the real BoardRoom (TC-16 to TC-19) | proposed | test:integration | offline.sync_ack |
| 10 | Implement local-first BoardPage: open from device copy, offline copy, orphaned read-only copy, discard with confirmation | proposed | implementation | offline.board_open |
| 11 | Implement offline status badge states and leave guard | proposed | implementation | offline.status_ui |
| 12 | Component tests for offline board page states, discard confirmation, badge states and leave guard (TC-20 to TC-27, TC-37, TC-40) | proposed | test:ui-component | offline.board_open, offline.status_ui |
| 13 | E2E offline workflows: train journey with full restart, plane without copy, private mode, board gone, two tabs, broken precache (TC-28 to TC-35, TC-38) | proposed | test:e2e | offline.app_shell, offline.local_store, offline.board_open, offline.status_ui |

## Details

### 1. Write service worker unit tests first: request classification and old cache cleanup (TC-01, TC-02)

## Goal
Test-first coverage of offline.app_shell's pure contract: `classifyRequest` and `cachesToDelete`.

## Setup
Add story 13 named settings (LOCAL_BOARD_CACHE_MAX_BOARDS, LOCAL_STORAGE_PRESSURE_RATIO, STORAGE_CHECK_INTERVAL_MS, OFFLINE_STATUS_BUDGET_MS, OFFLINE_OPEN_BUDGET_MS, LOCAL_LOAD_TIMEOUT_MS, ORPHAN_RECHECK_AFTER_FAILURES, LOCAL_COPY_FORMAT_VERSION, LOCAL_DB_PREFIX, CACHE_INDEX_DB, APP_SHELL_CACHE_PREFIX) and `MESSAGE_SYNC_ACK` in protocol.ts. Stub exports in `sw.ts`.

## Cases
- TC-01 `classifyRequest`: navigation GET `/b/abc` → shell; GET hashed `/assets/index-3f2a.js` → asset; `/api/boards/x` → passthrough; `/api/rooms/x` WebSocket upgrade → passthrough; POST anything → passthrough; `/sw.js` → passthrough (negative: API and worker script never cached).
- TC-02 `cachesToDelete(['vidi6-shell-a','vidi6-shell-b','other-cache'], 'b')` → `['vidi6-shell-a']` (foreign caches untouched; current kept).

## Done when
Suite compiles and fails only with "not implemented"; committed.

### 2. Implement release-scoped service worker for the offline app shell

## Goal
Implement the offline.app_shell contract so board addresses open after a full browser restart without a connection.

## Approach
- `build/vite-sw-manifest.ts`: Vite plugin emitting `sw.js` with injected `RELEASE_ID` (build hash) and `ASSET_MANIFEST` (index.html + hashed JS/CSS/fonts).
- `sw.ts`: install → open `APP_SHELL_CACHE_PREFIX + RELEASE_ID`, `addAll(manifest)` (failure rejects install so the previous worker stays active); activate → delete `cachesToDelete(keys, RELEASE_ID)`; fetch → `classifyRequest`: shell = network-first, fallback cached `index.html`; asset = cache-first; passthrough = not intercepted (API, WebSocket, non-GET, `/sw.js`). No `skipWaiting`/`clients.claim`.
- `registerSw.ts`: register `/sw.js` when `serviceWorker` supported and not in unit/component test mode; called from `main.tsx`.
- `public/_headers`: `/sw.js` → `Cache-Control: no-cache` (confirm Workers static assets honour `_headers`; otherwise set header in the Worker for that path).

## Done when
TC-01/TC-02 pass; manual check in Chrome DevTools: offline reload of `/b/<id>` serves cached shell; e2e TC-33 passes.

### 3. Write device copy and eviction unit tests first (TC-03 to TC-07)

## Goal
Test-first coverage of the pure parts of offline.local_store (`localDbName`, format version check) and offline.cache_manager (`chooseEvictions`, `choosePressureEvictions`).

## offline.local_store
- TC-03 `localDbName('abc')` → `LOCAL_DB_PREFIX + 'abc'`; copy meta with `formatVersion !== LOCAL_COPY_FORMAT_VERSION` → `isUsableCopy` false (treated as no copy).

## offline.cache_manager
- TC-04 LOCAL_BOARD_CACHE_MAX_BOARDS+1 synced entries → evicts exactly the least recently opened (boundary).
- TC-05 same, but least recent is unsynced → evicts the least recent *synced* entry instead (negative: unsynced kept).
- TC-06 every over-limit candidate unsynced → evicts nothing.
- TC-07 open board is least recent → never chosen, by both `chooseEvictions` and `choosePressureEvictions`.
- `choosePressureEvictions` returns synced, non-open entries oldest first.

## Done when
Suites compile and fail only with "not implemented"; committed.

### 4. Implement device copy store: availability probe, y-indexeddb copy with load timeout, quota watcher, discard

## Goal
Implement the offline.local_store contract.

## Approach
- Add `y-indexeddb` dependency.
- `probeAvailability(factory = indexedDB)`: open `vidi6-probe`, put/get/delete a record in a transaction; any exception or `onerror`/`onblocked` → `unavailable`.
- `openLocalCopy(id, doc, timeoutMs = LOCAL_LOAD_TIMEOUT_MS)`: `new IndexeddbPersistence(localDbName(id), doc)`; race `whenSynced` against timeout → `{loaded, timedOut, persistence}`; check/store `formatVersion` in the persistence meta (`persistence.set/get`), mismatch → clear database and treat as no copy. Must run before `connectBoard` so offline changes join the first sync exchange (offline.survive_reload, offline.merge).
- Two tabs use the same database; no locking (both tabs' updates stored; offline.merge).
- `onQuotaExceeded(listener)`: `window.addEventListener('unhandledrejection', e => DOMException name QuotaExceededError → listener())` (offline.storage_unavailable).
- `discardCopy(id)`: destroy persistence if open, `indexedDB.deleteDatabase`, reject on error/blocked, then `cacheManager` removes index entry (offline.discard).

## Done when
TC-03 passes; browser integration task passes; opening a 2,000-note copy completes within OFFLINE_OPEN_BUDGET_MS locally (offline.open_offline).

### 5. Implement cache manager: index DB, 50-board limit, storage pressure eviction, unsynced flag

## Goal
Implement the offline.cache_manager contract.

## Approach
- Index database `CACHE_INDEX_DB` with object store `boards` keyed by `boardId`: `{ boardId, lastOpenedAt, unsynced, formatVersion }`.
- `touch`, `setUnsynced`, `hasCopy` simple transactions; failures swallowed (availability handled by localBoardStore).
- `chooseEvictions(entries, openBoardId, max = LOCAL_BOARD_CACHE_MAX_BOARDS)`: sort by `lastOpenedAt` ascending; remove oldest entries that are neither unsynced nor open until ≤ max (offline.cache_limit).
- `choosePressureEvictions`: synced, not open, oldest first.
- `enforceLimits(openBoardId, estimate = navigator.storage?.estimate)`: apply limit evictions; then if estimate available and `usage/quota > LOCAL_STORAGE_PRESSURE_RATIO`, delete pressure candidates one by one, re-estimating after each (offline.storage_pressure). `deleteDatabase` blocked → add to `skipped`, continue. Never throws.
- BoardPage calls `touch` + `enforceLimits` on open and every STORAGE_CHECK_INTERVAL_MS.

## Done when
TC-04 to TC-07 pass; browser integration task passes.

### 6. Browser-mode integration tests with real IndexedDB for device copies and eviction (TC-10 to TC-15, TC-36, TC-39)

## Goal
Exercise offline.local_store and offline.cache_manager against real IndexedDB using Vitest browser mode (Playwright Chromium provider), not fake-indexeddb.

## Setup
Add `@vitest/browser` and a `browser` project in `vitest.config.ts` for `tests/browser/**`; script `test:browser`.

## offline.local_store (`local-board-store.test.ts`)
- TC-10 `openLocalCopy`, apply 3 real sticky-note updates via board-model, destroy persistence, open a fresh doc on the same board → 3 notes present (survives reload).
- TC-11 `probeAvailability` with an `IDBFactory` whose `open` fires `onerror` → `unavailable`, no throw (error path).
- TC-12 two docs on the same database apply different updates; third doc opened → contains both (two tabs merge).
- TC-13 `discardCopy` → database no longer listed by `indexedDB.databases()`, index entry gone.
- TC-36 persistence whose `whenSynced` never resolves (stub) → result `timedOut` after LOCAL_LOAD_TIMEOUT_MS (boundary).

## offline.cache_manager (`cache-manager.test.ts`)
- TC-14 create LOCAL_BOARD_CACHE_MAX_BOARDS+1 real copies with increasing `lastOpenedAt`, `enforceLimits` → oldest database deleted; index size = max.
- TC-15 estimate stub reports usage above LOCAL_STORAGE_PRESSURE_RATIO; 3 synced, 1 unsynced, 1 open → synced non-open deleted oldest first; unsynced and open kept (negative).
- TC-39 hold an open connection to one candidate database (blocked delete) → that board in `skipped`, others evicted, no throw (error path).

## Done when
All pass in `npm run test:browser`.

### 7. Write sync tracker unit tests first: frame classification and ack state machine (TC-08, TC-09)

## Goal
Test-first coverage of offline.sync_ack's client contract: `classifyFrame` and `createSyncTracker`.

## Cases
- TC-08 `classifyFrame` on frames built with y-protocols encoders: SyncStep1 → other; SyncStep2 → data; Update → data; awareness → other; `MESSAGE_SYNC_ACK` → other; string frame → other.
- TC-09 tracker with `initiallyUnsynced:false`: `onLocalChange` while connected → syncing and `persistFlag(true)` once; 3 `onSend(data)`; `onAck(1)`, `onAck(2)` → syncing; `onAck(3)` → synced and `persistFlag(false)`; `onDisconnected` with unsynced → pending_offline and counters reset; new connection starts at 0 sent/0 acked (boundaries).
- `initiallyUnsynced:true` starts pending_offline; after `onConnected` + handshake SyncStep2 send + ack → synced.
- Ack greater than sent → clamped, state not corrupted (error path).
- `hasUnsynced()` reflects state for the leave guard.

## Done when
Suite compiles and fails only with "not implemented"; committed.

### 8. Implement sync acknowledgement: room acks stored data frames, client counting socket and tracker wiring

## Goal
Implement the offline.sync_ack contract end to end.

## Server (modification of story 4 BoardRoom)
- In `webSocketMessage`, for MESSAGE_SYNC frames whose inner type is SyncStep2 or Update: after `readSyncMessage` and the story 4 append succeed (or no doc change occurred), increment `syncCount` in the socket attachment (spread existing fields incl. story 6 `awareness`) and send `MESSAGE_SYNC_ACK` + varUint count.
- No ack when the room is load-failed/storage-failed (story 4 closes the socket instead) or for SyncStep1/awareness frames.
- New sockets start with `syncCount` 0.

## Client
- `classifyFrame` decodes the first varUint message type and inner sync type.
- `createSyncTracker` per contract; `persistFlag` → `cacheManager.setUnsynced`.
- `connectBoard`: pass `WebSocketPolyfill: class extends WebSocket { send(d) { tracker.onSend(d); super.send(d) } }`; register `provider.messageHandlers[MESSAGE_SYNC_ACK] = (enc, dec) => tracker.onAck(decoding.readVarUint(dec))`; provider status → `onConnected/onDisconnected`; doc `update` with LOCAL_ORIGIN → `onLocalChange`.
- The reconnect handshake SyncStep2 carries device-held changes and is acked like any update (offline.sync_after_reopen, offline.merge); tracker state drives "Syncing…" (offline.status_syncing) and `hasUnsynced` feeds the leave guard (offline.leave_guard).

## Done when
TC-08/TC-09 pass; integration task for sync ack passes.

### 9. Integration tests for sync acknowledgement against the real BoardRoom (TC-16 to TC-19)

## Goal
Verify the server side of offline.sync_ack with a real Durable Object, real storage and real WebSockets (extend the story 3 `ws-client` helper to record `MESSAGE_SYNC_ACK` frames).

## Cases
- TC-16 client sends 3 Update frames → receives acks 1, 2, 3 in order; when each ack arrives, the corresponding `updates` row already exists (read via `runInDurableObject`).
- TC-17 story 4 injection makes `store.append` throw once → no ack for that frame; socket closed with CLOSE_STORAGE_FAILURE (negative/error path).
- TC-18 client sends only SyncStep1 and awareness frames → no ack frames received (negative).
- TC-19 client reconnects on a new socket after 5 acks on the previous one → first ack on the new socket is 1 (per-connection count; attachment of the old socket not reused). Also assert story 6 `awareness` field in the attachment is preserved when `syncCount` updates.

## Done when
All pass in `npm run test:integration`.

### 10. Implement local-first BoardPage: open from device copy, offline copy, orphaned read-only copy, discard with confirmation

## Goal
Implement the offline.board_open contract as a modification of story 5's BoardPage.

## Approach
- Injected `deps` (store, cache, api) for testability.
- On mount: `probeAvailability`; if available and `hasCopy(id)`, state `opening_copy` → `openLocalCopy` → `ready_from_copy` (board rendered immediately, offline.open_offline).
- Always run story 5 `checkBoard`: 200 → `connectBoard` (after copy loaded or timed out) → `ready`, handshake delivers device changes (offline.sync_after_reopen); unreachable with copy → `offline_copy` (editable, keep retrying check, connect when reachable); 404 with copy → `orphaned` (never call `connectBoard`, `canEdit` false, offline.orphaned_copy); no copy → story 5 `not_found`/`unreachable` (offline.no_copy_offline).
- Count consecutive provider connection failures; at ORPHAN_RECHECK_AFTER_FAILURES re-run `checkBoard`; 404 → destroy provider → `orphaned`.
- `OrphanedBanner`: text "This board no longer exists. You're viewing the copy saved on this device."; Discard copy → if unsynced, confirm dialog "Discard this copy? Your unsynced changes will be lost." (Discard / Keep copy) → `discardCopy` → `not_found`; failure → "Couldn't discard the copy. Try again." (offline.discard).

## Done when
Component task and e2e task for story 13 pass.

### 11. Implement offline status badge states and leave guard

## Goal
Implement the offline.status_ui contract.

## Approach
- `deriveBadge({connected, tracker, availability})`: disconnected + available → `offline_saved`; disconnected + unavailable → `offline_unsaved`; connected + syncing + available → `syncing`; connected + unsynced + unavailable → `connected_unsaved`; connected + synced → `hidden`. Story 4 `load_failed` and story 3 `connecting` keep precedence.
- `ConnectionStatus` renders exact PRD texts and colours with `role=status`.
- Offline detection: provider disconnect or `window` `offline` event sets disconnected immediately (offline.status_offline within OFFLINE_STATUS_BUDGET_MS); `online` triggers provider reconnect attempt.
- Availability from `probeAvailability` and `onQuotaExceeded` (offline.storage_unavailable).
- `shouldGuard({availability, unsynced})` = unavailable && unsynced; `installLeaveGuard` adds `beforeunload` handler calling `preventDefault()` and setting `returnValue = ''` only when guarded; returns uninstall (offline.leave_guard).
- Badge hidden only when tracker `synced` (offline.status_syncing).

## Done when
Component and e2e tasks for story 13 pass.

### 12. Component tests for offline board page states, discard confirmation, badge states and leave guard (TC-20 to TC-27, TC-37, TC-40)

## Goal
jsdom tests of offline.board_open (BoardPage with mocked `deps`) and offline.status_ui (`deriveBadge`, `ConnectionStatus`, `shouldGuard`/`installLeaveGuard`).

## offline.board_open
- TC-20 copy exists + `checkBoard` not_found → banner text, editing handlers no-ops, `connectBoard` spy never called (negative: no re-upload).
- TC-21 no copy + unreachable → "Couldn't reach vidi6. Retrying…", no board rendered (negative).
- TC-22 unsynced copy: Discard copy → confirmation text; Keep copy → `discardCopy` not called; Discard again → confirm → `discardCopy` called → Board not found.
- TC-23 synced copy: Discard copy → no confirmation, `discardCopy` called.
- TC-40 `discardCopy` rejects → banner stays with "Couldn't discard the copy. Try again." (error path).
- Extra: ORPHAN_RECHECK_AFTER_FAILURES consecutive provider failures then not_found → state orphaned.

## offline.status_ui
- TC-24 disconnected + available → amber "Offline — changes saved on this device".
- TC-25 connected syncing → "Syncing…"; synced → hidden.
- TC-26 unavailable: disconnected → red offline text; connected + unsynced → red "Changes can't be saved on this device until they sync."
- TC-27 leave guard: (available, unsynced) → no preventDefault; (unavailable, synced) → none; (unavailable, unsynced) → preventDefault and returnValue set (boundary + negative).
- TC-37 dispatch `unhandledrejection` with DOMException QuotaExceededError → availability unavailable, badge red (error path).

## Done when
All pass in `npm run test:component`.

### 13. E2E offline workflows: train journey with full restart, plane without copy, private mode, board gone, two tabs, broken precache (TC-28 to TC-35, TC-38)

## Goal
Real Chromium against `wrangler dev` proving the offline app shell (offline.app_shell), device copies (offline.local_store), local-first page flows (offline.board_open) and status/guard (offline.status_ui).

## Helper
`persistent-browser.ts`: launch `chromium.launchPersistentContext(tmpDir)` so IndexedDB, Cache Storage and the service worker survive a full close/relaunch.

## Workflows
- **Train journey** — TC-35: `setOffline(true)` → amber "Offline — changes saved on this device" within OFFLINE_STATUS_BUDGET_MS. TC-28: add 3 notes offline, close the whole persistent context, relaunch offline, open the board URL → shell served by the service worker, 3 notes visible within OFFLINE_OPEN_BUDGET_MS, amber status. TC-29: go online → "Syncing…" then hidden; a second participant sees the 3 notes within LIVE_UPDATE_LATENCY_BUDGET_MS.
- **Plane without a copy** — TC-33: load app online once, relaunch offline, open a never-opened board → shell loads from cache; TC-30: "Couldn't reach vidi6. Retrying…" and no board.
- **Private mode** — TC-31: init script makes `indexedDB.open` fail; go offline; add note → red "Offline — changes can't be saved on this device. Don't close this tab."; reload → `beforeunload` dialog event observed (dismissed).
- **Board gone** — TC-32: open board online (copy created), delete it via TEST_HOOKS `DELETE /__test/boards/:id`, reload → read-only copy with banner; no WebSocket to `/api/rooms` opened (network log); Discard copy → Board not found.
- **Two tabs offline** — TC-34: two pages in one persistent context, both offline, edit different notes, go online → both pages and a third participant show all changes.
- **Broken release precache** — TC-38: serve a build where one manifest asset returns 500 → new worker becomes redundant; previous release's worker stays active and the app still loads online.

## Done when
All pass in chromium (service worker scenarios are Chromium-only per strategy).


# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 5 | Integration tests for room awareness tracking: removal on close, hibernation, join query, malformed bytes (TC-04 to TC-08) | proposed | test:integration | presence.room_tracking |
| 7 | Write awareness tracker unit tests first (TC-01 to TC-03) | proposed | test:unit | presence.room_tracking |
| 8 | Implement room awareness tracking in BoardRoom: attachments, removal on close/error, query on join | proposed | implementation | presence.room_tracking |
| 9 | Write identity and colour assignment unit tests first (TC-09 to TC-15) | proposed | test:unit | presence.identity, presence.colors |
| 10 | Implement guest identity: random Adjective Animal names, persistence with memory fallback, validated rename | proposed | implementation | presence.identity |
| 11 | Implement distinct colour assignment with deterministic conflict resolution | proposed | implementation | presence.colors |
| 12 | Write awareness publishing and people derivation unit tests first (TC-16 to TC-18) | proposed | test:unit | presence.awareness_client |
| 13 | Implement usePresence: publish user, throttled cursor and selection; derive avatars, cursors and selections | proposed | implementation | presence.awareness_client |
| 14 | Implement presence UI: avatar stack with overflow and rename, remote cursors, remote selection outlines | proposed | implementation | presence.ui |
| 15 | Component tests for avatars, overflow, rename, off-screen cursors and remote outlines (TC-19 to TC-23) | proposed | test:ui-component | presence.ui, presence.identity |
| 16 | E2E presence workflows: cursor across zoom, hide on leave, full room colours and overflow, remote outlines, rename persistence, leave, two tabs (TC-24 to TC-31) | proposed | test:e2e | presence.awareness_client, presence.ui, presence.identity |

## Details

### 5. Integration tests for room awareness tracking: removal on close, hibernation, join query, malformed bytes (TC-04 to TC-08)

## Goal
Verify the presence.room_tracking contract with a real Durable Object, real WebSockets with attachments, and real y-protocols `Awareness` clients (extend story 3's `ws-client.ts` helper with an Awareness instance per client).

## Cases
- TC-04 A and B connected with realistic states; B closes → A receives a `MESSAGE_AWARENESS` removal for B's clientId within PRESENCE_CLOSE_REMOVAL_BUDGET_MS; A's Awareness no longer has B; A's own state untouched.
- TC-05 hibernation path: reconstruct the room instance while sockets remain accepted (attachments intact), then B closes → removal still broadcast using `deserializeAttachment().awareness`.
- TC-06 A and B idle, C connects → A and B each receive `MESSAGE_QUERY_AWARENESS`; after their clients answer, C holds A's and B's states within PRESENCE_EXISTING_VISIBLE_BUDGET_MS. Run a variant where B's socket closes concurrently → room drops B (story 3 rule) without throwing.
- TC-07 negative: A sends undecodable awareness bytes → B receives identical bytes (verbatim relay), A's attachment unchanged, A's socket stays open.
- TC-08 negative: B connects and closes without ever sending awareness → no removal message is broadcast, no error logged.

## Done when
All pass in `npm run test:integration`, 10 consecutive runs without flakes.

### 7. Write awareness tracker unit tests first (TC-01 to TC-03)

## Goal
Test-first unit coverage of presence.room_tracking's pure contract: `readAwarenessClients`, `encodeAwarenessRemoval`, `mergeTracked`.

## Setup
Add story 6 named settings to `config.ts` (PRESENCE_COLORS, MAX_AVATARS_SHOWN, CURSOR_BROADCAST_INTERVAL_MS, CURSOR_LATENCY_BUDGET_MS, CURSOR_POSITION_TOLERANCE_PX, PRESENCE_JOIN_BUDGET_MS, PRESENCE_EXISTING_VISIBLE_BUDGET_MS, PRESENCE_CLOSE_REMOVAL_BUDGET_MS, PRESENCE_STALE_REMOVAL_BUDGET_MS, NAME_MAX_CHARS, IDENTITY_STORAGE_KEY). Stub the tracker exports.

## Cases
- TC-01 build an update with `encodeAwarenessUpdate` from two real `Awareness` instances → `readAwarenessClients` returns `{id1: clock1, id2: clock2}`.
- TC-02 `encodeAwarenessRemoval` for one tracked id, applied with `applyAwarenessUpdate` to a real Awareness holding both states → that state removed, the other untouched.
- TC-03 error path: truncated bytes, empty array, entry with invalid JSON → `null`, no throw.
- `mergeTracked`: keeps the max clock per id; entries whose state is null are dropped.

## Done when
Suite compiles and fails only with "not implemented"; committed.

### 8. Implement room awareness tracking in BoardRoom: attachments, removal on close/error, query on join

## Goal
Implement the presence.room_tracking contract as a modification of story 4's hibernating BoardRoom.

## Approach
- `awareness-tracker.ts`: lib0 decoding of `varUint count; (varUint clientId, varUint clock, varString json)*`; `encodeAwarenessRemoval` writes the same layout with JSON `null` at the last seen clock; `mergeTracked` per contract.
- `webSocketMessage` awareness branch: relay verbatim to all sockets including sender (story 3 behaviour kept); if `readAwarenessClients` returns a map, `ws.serializeAttachment({ ...att, awareness: mergeTracked(att.awareness, map) })`. Undecodable → relay only.
- `fetch` after `ctx.acceptWebSocket(server)`: send `MESSAGE_QUERY_AWARENESS` to every other open socket (presence.join).
- `webSocketClose` / `webSocketError`: read attachment; if non-empty, broadcast `MESSAGE_AWARENESS` + removal to remaining sockets (presence.leave), works after hibernation because attachments persist.
- Attachment object shared with story 13's `syncCount` field: always spread existing attachment.

## Done when
TC-01 to TC-03 pass and task 6.5 integration tests pass.

### 9. Write identity and colour assignment unit tests first (TC-09 to TC-15)

## Goal
Test-first coverage of presence.identity (`randomGuestName`, `validateName`, `loadIdentity`) and presence.colors (`assignColorIndex`, `colorFor`).

## presence.identity
- TC-09 `randomGuestName` 1,000× with seeded rng → every value matches "Adjective Animal" pattern and length ≤ NAME_MAX_CHARS.
- TC-10 `validateName`: '' → error; '   ' → error; 1 char → ok; NAME_MAX_CHARS chars → ok; NAME_MAX_CHARS+1 → error 'Name must be 1–32 characters'; ' Alex ' → ok with 'Alex' (boundaries + trimming).
- TC-11 `loadIdentity` with a Storage whose getItem/setItem throw → identity generated (`g_` id, name, colour), `persisted: false`, no throw (error path). Also: valid stored identity is returned unchanged; corrupt JSON regenerates.

## presence.colors
- TC-12 seeded simulation (500 runs) of MAX_CONCURRENT_EDITORS clients joining in random order with simultaneous picks, iterating `assignColorIndex` until stable → all indices distinct every run.
- TC-13 MAX_CONCURRENT_EDITORS+1 clients → every client has an index; only overflow repeats when palette exhausted.
- TC-14 preferred index free → used; taken by lower clientID → lowest free chosen.
- TC-15 invariant `PRESENCE_COLORS.length >= MAX_CONCURRENT_EDITORS`.

## Done when
Suites compile and fail only with "not implemented"; committed.

### 10. Implement guest identity: random Adjective Animal names, persistence with memory fallback, validated rename

## Goal
Implement the presence.identity contract (convention 5 guest identity).

## Approach
- `names.ts`: two curated ASCII word lists (≥ 40 adjectives, ≥ 40 animals, all combinations ≤ NAME_MAX_CHARS); `randomGuestName(rng = Math.random)`.
- `validateName(raw)`: trim; ok when 1 ≤ length ≤ NAME_MAX_CHARS; otherwise `{ ok:false, error:'Name must be 1–32 characters' }` (presence.name_validation).
- `loadIdentity(storage)`: read IDENTITY_STORAGE_KEY JSON; if valid return it; else generate `{ id:'g_'+base64url(16 random bytes), name: randomGuestName(), color: random PRESENCE_COLORS entry }` and try to save; any storage exception → `persisted:false` (memory for this visit).
- `useIdentity()`: holds identity state; `rename(raw)` validates, updates state, saves when persisted (presence.names: remembered across visits in same browser).
- Shape matches the `Identity` interface story 14 will reuse for signed-in users.

## Done when
TC-09 to TC-11 pass; component rename test (task 6.14) passes.

### 11. Implement distinct colour assignment with deterministic conflict resolution

## Goal
Implement the presence.colors contract so up to MAX_CONCURRENT_EDITORS people always converge to distinct colours and more people degrade gracefully.

## Approach
- `assignColorIndex(ownClientId, preferredIndex, others)`: ignore claims with non-integer or out-of-range indices; if own current claim collides with a lower clientID, re-pick; pick preferred if unclaimed, else lowest unclaimed index in `[0, PRESENCE_COLORS.length)`, else `ownClientId % PRESENCE_COLORS.length` (palette exhausted → repeats allowed).
- `colorFor(index)` = `PRESENCE_COLORS[index % PRESENCE_COLORS.length]`.
- Pure module; `usePresence` re-runs it on every awareness change and publishes `user.colorIndex`.

## Done when
TC-12 to TC-15 pass.

### 12. Write awareness publishing and people derivation unit tests first (TC-16 to TC-18)

## Goal
Test-first coverage of presence.awareness_client's pure parts: `derivePeople` and `createCursorPublisher`.

## Cases
- TC-16 `derivePeople` with states: own clientID (self), two clientIDs sharing one other `user.id` with different `updatedAt`, one state with the same `user.id` as self from another tab, one malformed state (no user) → avatars: self first, one entry per user.id (newest wins), malformed skipped; cursors/selections exclude own clientID and same-user tabs (presence.self, presence.dedupe).
- TC-17 fake timers: 20 `move()` calls within CURSOR_BROADCAST_INTERVAL_MS → exactly one immediate publish and one trailing publish carrying the latest position (throttle boundary).
- TC-18 `hide()` mid-interval → `null` published immediately; pending trailing move cancelled; next `move()` publishes immediately (presence.cursor_hide).
- Non-finite cursor coordinates in remote states → cursor treated as null.

## Done when
Suite compiles and fails only with "not implemented"; committed.

### 13. Implement usePresence: publish user, throttled cursor and selection; derive avatars, cursors and selections

## Goal
Implement the presence.awareness_client contract on top of story 3's WebsocketProvider awareness.

## Approach
- `usePresence(provider, camera, selection, identity)`:
  - `awareness.setLocalStateField('user', { id, name, color: colorFor(idx), colorIndex: idx })` on mount, rename (presence.names) and colour re-assignment.
  - Board `pointermove` → `screenToWorld(camera, point)` → `createCursorPublisher.move` (throttled to CURSOR_BROADCAST_INTERVAL_MS) → `setLocalStateField('cursor', …)` (presence.cursors).
  - `pointerleave` and `visibilitychange` hidden → `hide()` → cursor null immediately (presence.cursor_hide).
  - Selection changes → `setLocalStateField('selection', ids)` (presence.selection); never reads remote selections into `useSelection`.
  - Subscribe to awareness `change`; recompute `derivePeople(states, provider.awareness.clientID, identity.id)`; added states appear (presence.join), removed states disappear (presence.leave), dedupe by user.id (presence.dedupe), own and same-user tabs excluded from cursors/outlines (presence.self).
- `createCursorPublisher`: leading + trailing throttle, `hide` cancels trailing, `dispose` clears timers.
- `BoardPage`: call `usePresence` once and pass results to presence UI.

## Done when
TC-16 to TC-18 pass; e2e task 6.15 passes.

### 14. Implement presence UI: avatar stack with overflow and rename, remote cursors, remote selection outlines

## Goal
Implement the presence.ui contract.

## Approach
- `PresenceAvatars({ self, others, onRename })`: left of Share; self first with "you" marker and accessible name "<name>, you"; show `MAX_AVATARS_SHOWN` avatars (initials + colour), then a `+N` button opening a list of all names with colour swatches (presence.avatars, presence.overflow). Own avatar menu → Rename field; inline error from `onRename` result.
- `RemoteCursors({ cursors, camera, viewport })`: container `aria-hidden`, `pointer-events:none`; each cursor an SVG arrow in the person's colour with name label at `worldToScreen(camera, cursor)`; skipped when outside viewport; constant screen size (presence.cursors).
- `RemoteSelections({ selections, objects })`: world-layer rectangles around each selected object's bounds in the person's colour with a name tag; stroke width kept constant on screen; ids not in `objects` ignored; `pointer-events:none` so editing is never blocked (presence.selection).
- Names always shown next to colours (colours may repeat beyond capacity, presence.colors); self never rendered as remote (presence.self relies on derived lists).

## Done when
Component task 6.14 and e2e task 6.15 pass.

### 15. Component tests for avatars, overflow, rename, off-screen cursors and remote outlines (TC-19 to TC-23)

## Goal
jsdom tests of presence.ui components with synthetic `RemotePerson` data, plus presence.identity rename behaviour through the avatar menu.

## presence.ui
- TC-19 MAX_AVATARS_SHOWN+2 others → self avatar first with accessible name "<name>, you"; MAX_AVATARS_SHOWN avatars; "+2" button; opening it lists every name with its colour.
- TC-20 alone → only self avatar; RemoteCursors renders no cursor elements.
- TC-22 cursor whose world point is outside the camera viewport → not rendered; container has `aria-hidden="true"` and `pointer-events: none` (negative).
- TC-23 remote selection of a note id → outline around the note bounds in the remote colour with name tag; a spy on local `useSelection.select` is never called (negative); outline has `pointer-events: none`.

## presence.identity (via avatar menu)
- TC-21 submit NAME_MAX_CHARS+1 characters → "Name must be 1–32 characters" shown and label unchanged; submit "Alex" → label "Alex, you" and `onRename` called once.

## Done when
All pass in `npm run test:component`.

### 16. E2E presence workflows: cursor across zoom, hide on leave, full room colours and overflow, remote outlines, rename persistence, leave, two tabs (TC-24 to TC-31)

## Goal
Real browsers against `wrangler dev` proving presence end to end: awareness publishing/derivation (presence.awareness_client), rendering (presence.ui) and identity persistence (presence.identity).

## Workflows
- **Pointing at a note** — TC-24: Sam at 50% zoom points at a note's top-left corner; Alex at 200% sees Sam's named cursor tip within CURSOR_POSITION_TOLERANCE_PX of that corner within CURSOR_LATENCY_BUDGET_MS. TC-25: Sam's mouse leaves the board → cursor gone on Alex within CURSOR_LATENCY_BUDGET_MS; re-entry shows it again.
- **Full room** — TC-26: MAX_CONCURRENT_EDITORS contexts join one by one → each newcomer visible to others within PRESENCE_JOIN_BUDGET_MS; every screen shows MAX_CONCURRENT_EDITORS avatars with pairwise-distinct colours. TC-27: one more context joins → "+1" overflow, every person has a colour and name, nobody refused.
- **Who's working on what** — TC-28: Sam selects a note while Alex has another selected → Alex sees Sam's outline in Sam's colour; Alex's selection unchanged; Alex can still type in Sam's note.
- **Becoming Alex** — TC-29: Alex renames to "Alex" → Sam sees it within PRESENCE_JOIN_BUDGET_MS; Alex reloads → still "Alex" (localStorage persistence).
- **Leaving** — TC-30: Sam's context closes → avatar, cursor and outline gone on Alex within PRESENCE_CLOSE_REMOVAL_BUDGET_MS.
- **Two tabs** — TC-31: Alex opens a second page in the same context → Sam sees one Alex avatar; neither Alex tab draws Alex's other tab's cursor.

## Done when
All pass in chromium; TC-24 also in firefox and webkit.


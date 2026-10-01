# Technical Design

Presence built on Yjs awareness through the existing y-websocket provider. The BoardRoom tracks awareness client ids and clocks per socket in hibernation-safe WebSocket attachments, broadcasts removals on close and queries existing clients when someone joins. The client has a guest identity module, a pure distinct-colour assignment with deterministic conflict resolution, a throttled awareness publisher with people derivation (dedupe, self exclusion), and UI for avatars, remote cursors and remote selection outlines.

## Overview

## Context
Builds on story 1 (`camera.ts` worldToScreen/screenToWorld), story 2 (`useSelection`), story 3 (`connectBoard` WebsocketProvider, BoardRoom relaying awareness verbatim to all sockets including sender), story 4 (hibernating BoardRoom using `ctx.acceptWebSocket` and `ctx.getWebSockets()`), story 5 (`BoardPage`, Share button top-right). Conventions: identity (5), awareness state shape `{user:{id,name,color}, cursor:{x,y}|null, selection:string[]}`, all numbers in `config.ts` (12). When story 7 lands, `selection` is the multi-select id set; before that it is zero or one id.

## Files
| Path | Change | Purpose |
|---|---|---|
| `src/shared/config.ts` | modified | presence settings below |
| `src/shared/protocol.ts` | modified | export awareness message helpers used by worker and tests |
| `src/worker/awareness-tracker.ts` | added | decode awareness update → clientId/clock map; encode removal update |
| `src/worker/board-room.ts` | modified | per-socket awareness ids in WebSocket attachment; removal broadcast on close/error; query-awareness to others on join |
| `src/client/identity/names.ts` | added | adjective and animal word lists, `randomGuestName()` |
| `src/client/identity/useIdentity.ts` | added | guest identity per convention 5, persistence, rename, validation |
| `src/client/presence/colors.ts` | added | pure distinct-colour assignment and conflict resolution |
| `src/client/presence/usePresence.ts` | added | publish local awareness (user, throttled cursor, selection); subscribe; `derivePeople` |
| `src/client/presence/PresenceAvatars.tsx` | added | avatar stack, overflow list, own avatar rename |
| `src/client/presence/RemoteCursors.tsx` | added | cursors in screen space |
| `src/client/presence/RemoteSelections.tsx` | added | outlines + name tags in world layer |
| `src/client/pages/BoardPage.tsx` | modified | mount presence components next to Share |

## Named settings added
```ts
export const PRESENCE_COLORS = ['#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00897B', '#F4511E', '#3949AB'] as const;
// invariant (unit-tested): PRESENCE_COLORS.length >= MAX_CONCURRENT_EDITORS
export const MAX_AVATARS_SHOWN = MAX_CONCURRENT_EDITORS;
export const CURSOR_BROADCAST_INTERVAL_MS = 50;
export const CURSOR_LATENCY_BUDGET_MS = 500;
export const CURSOR_POSITION_TOLERANCE_PX = 2;
export const PRESENCE_JOIN_BUDGET_MS = 1000;          // newcomer visible to others
export const PRESENCE_EXISTING_VISIBLE_BUDGET_MS = 2000; // idle people visible to newcomer
export const PRESENCE_CLOSE_REMOVAL_BUDGET_MS = 3000;
export const PRESENCE_STALE_REMOVAL_BUDGET_MS = 35_000; // y-protocols outdated timeout (30 s) + margin
export const NAME_MAX_CHARS = 32;
export const IDENTITY_STORAGE_KEY = 'vidi6.identity';
```

## Product and technical decisions
1. **Colours are per session, not per identity.** The identity's stored colour is a *preference*; the displayed colour is the lowest free palette index, choosing the preference if free. Conflicts (two clients picking the same index before seeing each other) resolve deterministically: the client with the higher awareness clientID re-picks on the next awareness change. All clients converge without server coordination. Beyond `PRESENCE_COLORS.length` or capacity, indices repeat (colour = index modulo palette length).
2. **Server stores no awareness states.** They would be lost on hibernation anyway. It keeps only `{clientId: lastClock}` per socket inside `ws.serializeAttachment`, which survives hibernation, so removal on close still works.
3. **Newcomers see idle people** because the room sends `MESSAGE_QUERY_AWARENESS` to all other sockets when a socket is accepted; the y-websocket client answers with its current state, which the room relays (story 3 relay unchanged).
4. **Removal encoding**: an awareness update entry with the last seen clock and JSON `null` state; y-protocols applies a null state at an equal clock when the state exists.
5. **Remote cursors are screen-space overlays**, positioned with `worldToScreen(camera, cursor)`, constant size, hidden when off-screen; outlines live in the world layer so they scale with objects.
6. **Dedupe by `user.id`** for avatars (two tabs of the same person); cursors are per tab but only the most recently updated tab's cursor is drawn per `user.id`.
7. **Hidden tab / pointer leave** publish `cursor: null` immediately (not throttled) so hiding is prompt.

## Structure diagram
```mermaid
flowchart TD
    subgraph Browser
        Page[BoardPage] --> Identity[useIdentity]
        Identity --> Names[names.ts]
        Page --> Presence[usePresence]
        Presence --> Identity
        Presence --> Colors[colors.ts]
        Presence --> Camera[camera.ts story 1]
        Presence --> Selection[useSelection story 2]
        Presence --> Awareness[provider awareness story 3]
        Page --> Avatars[PresenceAvatars]
        Page --> Cursors[RemoteCursors]
        Page --> Outlines[RemoteSelections]
        Avatars --> Presence
        Cursors --> Presence
        Outlines --> Presence
    end
    subgraph DurableObject
        Room[BoardRoom] --> Tracker[awareness-tracker.ts]
        Room --> Attach[WebSocket attachment]
    end
    Awareness -->|WebSocket| Room
```

## State diagrams
A remote person as seen by one viewer (in-memory awareness only; nothing persisted except the socket attachment on the server):
```mermaid
stateDiagram-v2
    [*] --> Present : awareness state received
    Present --> Present : name or cursor or selection update
    Present --> CursorHidden : cursor null received
    CursorHidden --> Present : cursor position received
    Present --> Absent : removal after socket close
    CursorHidden --> Absent : removal after socket close
    Present --> Absent : outdated timeout without renewal
    CursorHidden --> Absent : outdated timeout without renewal
    Absent --> Present : new state received
```
Colour assignment for the local client:
```mermaid
stateDiagram-v2
    [*] --> Unassigned
    Unassigned --> Assigned : pick preferred or lowest free index
    Assigned --> Assigned : others change without conflict
    Assigned --> Conflicted : lower clientID holds same index
    Conflicted --> Assigned : re-pick lowest free index
```
Local identity persistence:
```mermaid
stateDiagram-v2
    [*] --> Loading
    Loading --> Stored : valid identity in localStorage
    Loading --> Generated : none stored
    Generated --> Stored : saved
    Loading --> MemoryOnly : localStorage throws
    Generated --> MemoryOnly : save throws
    Stored --> Stored : valid rename saved
    MemoryOnly --> MemoryOnly : rename kept for visit
```
Server per-socket attachment: `{ awareness: Record<clientId, clock> }`, updated on each decodable awareness message and cleared when the socket closes.

## Sequence: join and initial presence
```mermaid
sequenceDiagram
    participant S as Sam client
    participant R as BoardRoom
    participant A as Alex client idle
    S->>R: WebSocket accepted story 3 sync
    R->>A: MESSAGE_QUERY_AWARENESS
    alt Alex socket already closed
        R->>R: send throws drop socket story 3
    else open
        A->>R: awareness Alex state
        R->>R: track Alex clientId clock
        R->>S: relay Alex state
        R->>A: relay echo story 3
    end
    S->>R: awareness Sam state
    alt undecodable awareness bytes
        R->>A: relay verbatim not tracked
    else decodable
        R->>R: attachment Sam clientId clock
        R->>A: relay Sam state
    end
    A->>A: derivePeople adds Sam avatar
```

## Sequence: cursor and selection publishing
```mermaid
sequenceDiagram
    participant U as Sam pointer
    participant P as usePresence Sam
    participant R as BoardRoom
    participant V as Alex RemoteCursors
    U->>P: pointermove screen point
    P->>P: screenToWorld camera
    alt within CURSOR_BROADCAST_INTERVAL_MS of last send
        P->>P: keep latest schedule trailing send
    else interval elapsed
        P->>R: awareness cursor x y
        R->>V: relay
        V->>V: worldToScreen Alex camera
        alt outside Alex viewport
            V->>V: hide cursor
        else inside
            V->>V: draw at position
        end
    end
    alt pointerleave or tab hidden
        U->>P: event
        P->>R: awareness cursor null immediately
        R->>V: relay hide
    end
    U->>P: selection changed
    P->>R: awareness selection ids
    R->>V: relay outline update
```

## Sequence: rename
```mermaid
sequenceDiagram
    participant U as Alex
    participant AV as PresenceAvatars
    participant I as useIdentity
    participant P as usePresence
    U->>AV: Rename submit name
    AV->>I: rename name
    alt empty whitespace or over NAME_MAX_CHARS
        I-->>AV: ok false error
        AV-->>U: Name must be 1 to 32 characters
    else valid
        I->>I: save to localStorage
        alt localStorage throws
            I->>I: keep in memory for visit
        end
        I-->>P: identity changed
        P->>P: setLocalStateField user
    end
```

## Sequence: leave
```mermaid
sequenceDiagram
    participant S as Sam client
    participant R as BoardRoom
    participant A as Alex client
    alt Sam closes tab clean close
        S->>R: socket close
        R->>R: webSocketClose read attachment
        alt attachment empty
            R->>R: nothing to remove
        else ids tracked
            R->>A: awareness removal clock null
            A->>A: remove avatar cursor outline
        end
    else room hibernated before close
        S->>R: close wakes object
        R->>R: attachment survived hibernation
        R->>A: awareness removal
    else Sam network dies silently
        A->>A: no renewal within outdated timeout
        A->>A: remove Sam
    end
```

## Test Strategy

## Test scopes and boundaries
| Capability | Levels | Boundary exercised | Why sufficient |
|---|---|---|---|
| presence.room_tracking | unit, integration | Pure awareness encode/decode; real Durable Object sockets and attachments in workerd | Removal after close and hibernation depends on real attachments and socket events |
| presence.identity | unit, ui-component, e2e | Pure generation/validation; rename UI in jsdom; real localStorage in browsers | Persistence across visits only provable in a real browser |
| presence.colors | unit | Pure assignment | Deterministic logic; convergence checked by simulation |
| presence.awareness_client | unit, e2e | Pure `derivePeople` and throttle; real provider in browsers | Cross-zoom positioning and delivery require real browsers and server |
| presence.ui | ui-component, e2e | Components with synthetic people; real rendering | Layout, overflow and outlines are DOM facts; e2e checks pixels |

Timing policy: tests that run over real sockets or real browsers (integration TC-04, TC-06; e2e TC-24 to TC-30) wait up to E2E_EVENTUAL_TIMEOUT_MS (story 3) for the functional outcome and log the measured time against the named budget (CURSOR_LATENCY_BUDGET_MS, PRESENCE_JOIN_BUDGET_MS, PRESENCE_EXISTING_VISIBLE_BUDGET_MS, PRESENCE_CLOSE_REMOVAL_BUDGET_MS). Wall-clock budgets are reported, not asserted, because the model, browsers and server share one machine. Fake-timer unit tests (TC-17, TC-18) still assert exact timing.

## Dimensions crossed
- **D1 Participants**: 1, 2, `MAX_CONCURRENT_EDITORS`, `MAX_CONCURRENT_EDITORS + 1`.
- **D2 Event**: join, cursor move, pointer leave/tab hidden, selection change, rename, clean close, silent drop, room hibernated then close.
- **D3 Identity situation**: fresh browser, returning browser, same identity in two tabs, localStorage unavailable.
- **D4 Viewer camera**: same zoom as sender, different zoom (50% vs 200%), sender cursor outside viewer's viewport.

Classes within each dimension are exhaustive for this story and non-overlapping.

## Coverage table
| TC | Capability | D1 | D2 | D3 | D4 | Action | Expected before → after | Level |
|---|---|---|---|---|---|---|---|---|
| TC-01 | presence.room_tracking | 2 | join | fresh browser | not applicable: server-side bytes | readAwarenessClients on real y-protocols update with 2 clients | map {id1:clock1, id2:clock2} | unit |
| TC-02 | presence.room_tracking | 2 | clean close | fresh browser | not applicable: server-side bytes | encodeAwarenessRemoval then applyAwarenessUpdate on real Awareness | states for those ids removed; others untouched | unit |
| TC-03 | presence.room_tracking | 1 | join | not applicable: bytes only | not applicable | truncated bytes, empty array, unknown JSON | returns null; no throw | unit |
| TC-04 | presence.room_tracking | 2 | clean close | fresh browser | not applicable: integration clients | B closes | A receives removal for B; A's Awareness lacks B; time logged against PRESENCE_CLOSE_REMOVAL_BUDGET_MS | integration |
| TC-05 | presence.room_tracking | 2 | room hibernated then close | fresh browser | not applicable | reconstruct room instance with sockets kept, then B closes | removal broadcast from attachment | integration |
| TC-06 | presence.room_tracking | 3 | join | fresh browser | not applicable | A and B idle; C connects | A and B receive MESSAGE_QUERY_AWARENESS; C ends up with A and B states; time logged against PRESENCE_EXISTING_VISIBLE_BUDGET_MS | integration |
| TC-07 | presence.room_tracking | 2 | join | not applicable: malformed | not applicable | A sends undecodable awareness bytes | bytes relayed to B; attachment unchanged; socket stays open | integration |
| TC-08 | presence.room_tracking | 2 | clean close | fresh browser | not applicable | B closes before sending any awareness | no removal broadcast; no error | integration |
| TC-09 | presence.identity | 1 | join | fresh browser | not applicable: pure | randomGuestName 1,000 times | every name matches /^[A-Z][a-z]+ [A-Z][a-z]+$/, length ≤ NAME_MAX_CHARS | unit |
| TC-10 | presence.identity | 1 | rename | returning browser | not applicable: pure | validateName '', '   ', 1 char, NAME_MAX_CHARS chars, NAME_MAX_CHARS+1 chars, ' Alex ' | false, false, true, true, false, true (trimmed to 'Alex') | unit |
| TC-11 | presence.identity | 1 | join | localStorage unavailable | not applicable: pure | load with throwing storage | identity generated, MemoryOnly, no throw | unit |
| TC-12 | presence.colors | `MAX_CONCURRENT_EDITORS` | join | fresh browser | not applicable: pure | simulate clients joining in random order with simultaneous picks (seeded, 500 runs) | after resolution all indices distinct in every run | unit |
| TC-13 | presence.colors | `MAX_CONCURRENT_EDITORS + 1` | join | fresh browser | not applicable: pure | assign | every client has an index; exactly the overflow client reuses an index | unit |
| TC-14 | presence.colors | 2 | join | returning browser | not applicable: pure | preferred colour free vs taken | free → preferred used; taken → lowest free | unit |
| TC-15 | presence.colors | not applicable: config | not applicable | not applicable | not applicable | assert PRESENCE_COLORS.length >= MAX_CONCURRENT_EDITORS | true | unit |
| TC-16 | presence.awareness_client | 3 | join | same identity in two tabs | not applicable: pure | derivePeople with 2 clientIDs same user.id + own clientID | avatars: one per user.id, own first; cursors exclude own clientID; newest tab's cursor per user.id | unit |
| TC-17 | presence.awareness_client | 2 | cursor move | fresh browser | not applicable: fake timers | 20 pointermoves within CURSOR_BROADCAST_INTERVAL_MS | at most 1 immediate + 1 trailing publish; trailing carries latest position | unit |
| TC-18 | presence.awareness_client | 2 | pointer leave/tab hidden | fresh browser | not applicable: fake timers | pointerleave mid-interval | cursor null published immediately; pending trailing move cancelled | unit |
| TC-19 | presence.ui | `MAX_AVATARS_SHOWN + 2` | join | fresh browser | not applicable: component | render PresenceAvatars | own avatar first marked you; MAX_AVATARS_SHOWN avatars; "+2"; list shows all names and colours | ui-component |
| TC-20 | presence.ui | 1 | join | fresh browser | not applicable: component | alone | only own avatar; no cursors rendered | ui-component |
| TC-21 | presence.identity | 1 | rename | returning browser | not applicable: component | submit NAME_MAX_CHARS+1 chars; then valid name | error text, name unchanged; then label updated and rename called once | ui-component |
| TC-22 | presence.ui | 2 | cursor move | fresh browser | sender cursor outside viewer's viewport | render RemoteCursors with camera excluding point | cursor not rendered; aria-hidden on container | ui-component |
| TC-23 | presence.ui | 2 | selection change | fresh browser | same zoom | render RemoteSelections for remote selection of a note | outline in remote colour + name tag; local useSelection untouched | ui-component |
| TC-24 | presence.awareness_client | 2 | cursor move | fresh browser | different zoom 50% vs 200% | Sam points at a note corner | on Alex, Sam's cursor tip appears within CURSOR_POSITION_TOLERANCE_PX of the corner; delivery time logged against CURSOR_LATENCY_BUDGET_MS | e2e |
| TC-25 | presence.awareness_client | 2 | pointer leave/tab hidden | fresh browser | same zoom | Sam's mouse leaves board | Sam's cursor disappears on Alex; returns on re-entry; time logged against CURSOR_LATENCY_BUDGET_MS | e2e |
| TC-26 | presence.ui | `MAX_CONCURRENT_EDITORS` | join | fresh browser | same zoom | contexts join sequentially | each screen shows MAX_CONCURRENT_EDITORS avatars, all colours distinct; each newcomer appears to others (time logged against PRESENCE_JOIN_BUDGET_MS) | e2e |
| TC-27 | presence.ui | `MAX_CONCURRENT_EDITORS + 1` | join | fresh browser | same zoom | one more context joins | overflow "+1" shown; every person has colour and name; nobody refused | e2e |
| TC-28 | presence.ui | 2 | selection change | fresh browser | same zoom | Sam selects a note while Alex has another selected | Alex sees Sam's outline in Sam's colour; Alex's selection unchanged; Alex can still edit Sam's note | e2e |
| TC-29 | presence.identity | 2 | rename | returning browser | same zoom | Alex renames; reloads page | Sam sees the new name (time logged against PRESENCE_JOIN_BUDGET_MS); after reload Alex keeps new name | e2e |
| TC-30 | presence.awareness_client | 2 | clean close | fresh browser | same zoom | Sam's context closes | avatar, cursor, outline disappear on Alex; time logged against PRESENCE_CLOSE_REMOVAL_BUDGET_MS | e2e |
| TC-31 | presence.awareness_client | 2 | join | same identity in two tabs | same zoom | Alex opens a second tab | Sam still sees one Alex avatar; neither Alex tab draws the other Alex tab's cursor | e2e |

Note on TC-31: the same person's other tab is a different clientID; it is shown as one avatar (dedupe) and its cursor is drawn as a remote cursor only on *other* people's screens; on the person's own tabs, cursors whose `user.id` equals own identity are excluded (presence.self extends to same-identity tabs).

## Boundary values
- Participants: 1, 2, `MAX_CONCURRENT_EDITORS`, `MAX_CONCURRENT_EDITORS + 1`, `MAX_AVATARS_SHOWN + 2` (TC-19, TC-20, TC-26, TC-27).
- Name length: 0, whitespace, 1, `NAME_MAX_CHARS`, `NAME_MAX_CHARS + 1` (TC-10, TC-21).
- Throttle (fake timers): moves within one interval; leave mid-interval (TC-17, TC-18).

## Negative scenarios
| TC | Must not happen | Level |
|---|---|---|
| TC-07 | undecodable awareness must not close the socket or corrupt tracking | integration |
| TC-08 | close without awareness must not broadcast a removal | integration |
| TC-16, TC-31 | own cursor/selection must not be drawn as remote; same person must not appear twice | unit, e2e |
| TC-21 | invalid name must not replace the current name | ui-component |
| TC-23, TC-28 | remote selection must not alter local selection or block editing | ui-component, e2e |
| TC-27 | person beyond capacity must not be refused | e2e |

## Error paths (every contract error has a case)
| Contract error | TC |
|---|---|
| undecodable awareness update (server) | TC-03, TC-07 |
| send to closed socket during query | covered by story 3 TC-31 behaviour; TC-06 runs with one socket closing concurrently (integration) |
| invalid rename | TC-10, TC-21 |
| localStorage throws | TC-11 |
| colour conflict | TC-12 |

## Mock vs real boundaries
| Dependency | Mocked? | Reason |
|---|---|---|
| Durable Object, WebSockets, attachments | Real (workerd via vitest-pool-workers) | Tracking and hibernation-safe removal are the behaviour under test |
| y-protocols Awareness | Real everywhere | Encoded bytes must match what the y-websocket client produces |
| Provider awareness in component tests | Synthetic `RemotePerson[]` props | Components render from derived data; derivation tested separately |
| localStorage | jsdom storage (and a throwing stub for TC-11); real in e2e | Deterministic; real persistence in e2e |
| Timers | Fake in TC-17/18 | Deterministic throttle |

## E2E workflows
1. **Pointing at a note** (TC-24 → TC-25): cursor lands at the right board location across zoom levels and hides when leaving.
2. **Full room** (TC-26 → TC-27): distinct colours at capacity; graceful overflow beyond.
3. **Who's working on what** (TC-28): remote outlines without interference.
4. **Becoming Alex** (TC-29): rename propagates and persists.
5. **Leaving** (TC-30) and **two tabs** (TC-31).

## Fixtures
- Identities from `randomGuestName()` seeded per context; boards created via `POST /api/boards` with 10 realistic notes from story 4 fixtures so outlines have targets.
- Integration awareness clients use real `Awareness` instances with realistic states `{user:{id:'g_…',name:'Brave Heron',color:'#1E88E5'}, cursor:{x:120.5,y:-40}, selection:['<uuid>']}`.

## Not covered
Deliberately not covered by automated tests:
- Silent network death removal within PRESENCE_STALE_REMOVAL_BUDGET_MS (35 s): it depends on y-websocket's own timeout and is not automated.
- Production hibernation timing: TC-05 simulates reconstruction only.
- Screen reader announcements for presence changes (none are made by design).
- Wall-clock delivery times as pass/fail criteria: on a shared machine they are logged, not asserted.

## Room awareness tracking

> Anchor: `presence.room_tracking`

## Contract
```ts
// src/worker/awareness-tracker.ts
export function readAwarenessClients(update: Uint8Array): Map<number, number> | null; // clientId -> clock; null if undecodable
export function encodeAwarenessRemoval(clients: Map<number, number>): Uint8Array;     // entries with same clock and null state
export function mergeTracked(prev: Record<string, number>, next: Map<number, number>): Record<string, number>; // keeps max clock per id; null-state entries removed
```
- **Inputs**: awareness payloads per socket; socket accept, close and error events.
- **Outputs**: unchanged verbatim relay (story 3); on accept, `MESSAGE_QUERY_AWARENESS` to every other open socket; on close/error, `MESSAGE_AWARENESS` removal for the socket's tracked ids to remaining sockets.
- **Errors**: undecodable awareness → relayed but not tracked; sending to a closed socket → socket dropped (story 3 rule).
- **Side effects**: `ws.serializeAttachment({ awareness })` after each decodable awareness message (modification of story 4 BoardRoom `webSocketMessage`, `webSocketClose`, `webSocketError`, `fetch`).

## Implementation
- **Newcomers see everyone quickly (presence.join):** when a person joins, their client publishes its awareness state immediately; the room relays it, so every other connected person's avatar stack shows the newcomer within PRESENCE_JOIN_BUDGET_MS (1 second). At the same time the room sends `MESSAGE_QUERY_AWARENESS` to every other open socket; each existing client — including idle ones that are not moving — answers with its current state, which the room relays to the newcomer, so everyone already present appears in the newcomer's avatar stack within PRESENCE_EXISTING_VISIBLE_BUDGET_MS (2 seconds).
- **People who leave disappear (presence.leave):** when a person closes the tab or navigates away, the socket closes and `webSocketClose` reads the socket's attachment and broadcasts an awareness removal for its client ids, so that person's avatar, cursor and selection outlines disappear from every other screen within PRESENCE_CLOSE_REMOVAL_BUDGET_MS (3 seconds). The attachment survives hibernation, so this also works if the room slept before the close. If a connection dies silently (no close), clients stop receiving that person's awareness renewals and the y-protocols outdated timeout (30 s) removes them locally, within PRESENCE_STALE_REMOVAL_BUDGET_MS (35 seconds).
- Awareness traffic still wakes the object while people are connected; with nobody connected no traffic exists, satisfying the cost constraint.

## Tests
unit: TC-01 to TC-03 (`tests/unit/awareness-tracker.test.ts`). integration: TC-04 to TC-08 (`tests/integration/presence-room.test.ts`). e2e: TC-26, TC-30.

## Guest identity and rename

> Anchor: `presence.identity`

## Contract
```ts
// src/client/identity/names.ts
export function randomGuestName(rng?: () => number): string; // "Adjective Animal"
// src/client/identity/useIdentity.ts
export interface Identity { id: string; name: string; color: string }
export function validateName(raw: string): { ok: true; name: string } | { ok: false; error: 'Name must be 1–32 characters' };
export function loadIdentity(storage: Storage | null): { identity: Identity; persisted: boolean };
export function useIdentity(): { identity: Identity; persisted: boolean; rename(raw: string): { ok: boolean; error?: string } };
```
- **Inputs**: localStorage key `IDENTITY_STORAGE_KEY`; rename input.
- **Outputs**: guest `{ id: 'g_' + 16 random bytes base64url, name, color: PRESENCE_COLORS[random] }` persisted when possible; renamed identity propagated to `usePresence`.
- **Errors**: invalid name → error result, identity unchanged; storage throws → `persisted: false`, identity kept in memory for the visit.
- **Side effects**: localStorage write on create and valid rename.

## Implementation
- **Friendly, remembered, renamable names (presence.names):** the first time a person opens a board in a browser, `loadIdentity` finds nothing stored and creates a guest identity with a random two-word "Adjective Animal" name (e.g. "Curious Otter") from `randomGuestName`, saved under IDENTITY_STORAGE_KEY so the same name is used on every later visit in that browser. When the person renames themself, the new name is saved and `usePresence` republishes the awareness `user` field; the room relays it, so every other connected person sees the new name on the avatar, cursor label and selection tag within 1 second. If the browser blocks storage the name is used for this visit only.
- **Invalid names are rejected (presence.name_validation):** `validateName` trims the input and accepts only 1 to NAME_MAX_CHARS (32) characters. An empty, whitespace-only or longer name is not applied — the current name is kept — and the rename field shows "Name must be 1–32 characters".
- Word lists contain only ASCII words short enough that every combination fits NAME_MAX_CHARS (TC-09). Story 14 later replaces guest identity with signed-in identity using the same `Identity` shape (convention 5).

## Tests
unit: TC-09 to TC-11. ui-component: TC-21. e2e: TC-29.

## Distinct colour assignment

> Anchor: `presence.colors`

## Contract
```ts
// src/client/presence/colors.ts
export interface ColorClaim { clientId: number; colorIndex: number | undefined }
export function assignColorIndex(ownClientId: number, preferredIndex: number, others: ColorClaim[]): number;
export function colorFor(index: number): string; // PRESENCE_COLORS[index % length]
```
- **Inputs**: own clientID, preferred palette index from identity colour, other clients' published `colorIndex` (awareness `user.colorIndex`).
- **Outputs**: palette index to publish.
- **Errors**: none; malformed or missing indices from others are ignored.
- **Side effects**: none (pure).

## Implementation
- **Distinct colours up to capacity (presence.colors):** each client picks its palette index from the indices other connected people have published: its preferred index if nobody holds it, otherwise the lowest free index in `[0, PRESENCE_COLORS.length)`. If two clients pick the same index before seeing each other, the one with the higher clientID re-picks on the next awareness change, so all clients converge. Because PRESENCE_COLORS has at least MAX_CONCURRENT_EDITORS (5, the configured simultaneous-editor capacity) entries, while no more than 5 people are connected every person is shown in a colour different from every other person's, on every screen (every screen renders the same published indices). When more than 5 people are connected, every person still gets a colour (`colorFor(index)` wraps modulo the palette, or `ownClientId % length` once the palette is exhausted) and colours may repeat; the name shown with every avatar, cursor and outline still tells people apart.
- Tests use the MAX_CONCURRENT_EDITORS setting, not a literal 5.

## Tests
unit: TC-12 to TC-15 (`tests/unit/presence-colors.test.ts`). e2e: TC-26, TC-27.

## Awareness publishing and people derivation

> Anchor: `presence.awareness_client`

## Contract
```ts
// src/client/presence/usePresence.ts
export interface RemotePerson { clientId: number; user: { id: string; name: string; color: string }; cursor: { x: number; y: number } | null; selection: string[]; updatedAt: number }
export function derivePeople(states: Map<number, unknown>, ownClientId: number, ownUserId: string): { avatars: RemotePerson[]; cursors: RemotePerson[]; selections: RemotePerson[] };
export function createCursorPublisher(publish: (c: { x: number; y: number } | null) => void, now: () => number): { move(p: { x: number; y: number }): void; hide(): void; dispose(): void };
export function usePresence(provider: WebsocketProvider, camera: Camera, selection: ReadonlySet<string> | string | null, identity: Identity): { avatars: RemotePerson[]; cursors: RemotePerson[]; selections: RemotePerson[]; self: RemotePerson };
```
- **Inputs**: provider awareness change events; pointer events over the board; `visibilitychange`; selection; identity.
- **Outputs**: local awareness fields `user` (with colorIndex), `cursor` (world units or null), `selection` (string[]); derived lists for UI.
- **Errors**: malformed remote states (missing user, non-finite cursor) are skipped, never thrown.
- **Side effects**: awareness publishes over the existing provider.

## Implementation
- **Live cursors at the right board location (presence.cursors):** pointer moves over the board are converted with `screenToWorld(camera, point)`, so the published cursor is a board location independent of the sender's zoom and position. The publisher sends a leading update and at most one trailing update per CURSOR_BROADCAST_INTERVAL_MS (50 ms), well inside CURSOR_LATENCY_BUDGET_MS (500 ms). Each viewer draws the cursor with the sender's name at `worldToScreen(ownCamera, cursor)`, so its tip is at the same board location (within CURSOR_POSITION_TOLERANCE_PX, 2 px) regardless of each viewer's own zoom and position, within 500 ms.
- **Cursor hidden when the pointer leaves (presence.cursor_hide):** `pointerleave` on the board and `visibilitychange` to hidden call `hide()`, which publishes `cursor: null` immediately (not throttled) and cancels any pending trailing move, so the cursor disappears from every other screen within 500 ms; the next pointer move over the board publishes a position again and the cursor reappears.
- **One avatar per person (presence.dedupe):** tabs of the same browser share one identity, so their awareness states carry the same `user.id`; `derivePeople` groups avatars by `user.id` (newest `updatedAt` wins), so that person never appears more than once in anyone's avatar stack.
- **Own presence not drawn as remote (presence.self):** `derivePeople` excludes from `cursors` and `selections` the viewer's own clientID and any state whose `user.id` equals the viewer's identity, so the viewer's own cursor and selection are never drawn as a remote cursor or remote outline on the viewer's own screen.
- Selection is published on every local selection change; rename updates the `user` field; states removed by the provider disappear.

## Tests
unit: TC-16 to TC-18 (`tests/unit/presence-derive.test.ts`). e2e: TC-24, TC-25, TC-30, TC-31 (`tests/e2e/presence.spec.ts`).

## Presence UI: avatars, cursors, selection outlines

> Anchor: `presence.ui`

## Contract
```tsx
// src/client/presence/PresenceAvatars.tsx
export function PresenceAvatars(props: { self: RemotePerson; others: RemotePerson[]; onRename(raw: string): { ok: boolean; error?: string } }): JSX.Element;
// src/client/presence/RemoteCursors.tsx
export function RemoteCursors(props: { cursors: RemotePerson[]; camera: Camera; viewport: Size }): JSX.Element;
// src/client/presence/RemoteSelections.tsx
export function RemoteSelections(props: { selections: RemotePerson[]; objects: ReadonlyMap<string, { x: number; y: number; width: number; height: number }> }): JSX.Element;
```
- **Outputs**: avatar buttons, overflow list, own avatar menu with Rename field; cursors as absolutely positioned SVG arrows + name label, container `aria-hidden`, skipped when off-screen; selection outlines with name tag.
- **Errors**: rename errors rendered inline; selections referencing deleted objects render nothing.
- **Side effects**: none beyond rendering.

## Implementation
- **See who is present (presence.avatars):** while people are connected, the avatar stack (left of the story 5 Share button) shows every connected person as a circle in their colour with their initials, from `derivePeople(...).avatars`; the viewer's own avatar comes first and is marked "you" (accessible name "Curious Otter, you"; others e.g. "Brave Heron"). With 3 people connected each screen shows 3 avatars, exactly one marked "you".
- **Avatar overflow (presence.overflow):** while more than 5 people (MAX_AVATARS_SHOWN = MAX_CONCURRENT_EDITORS) are connected, the stack shows the first 5 avatars with the viewer's own first, then a "+N" button where N is the number not shown; opening it lists the names and colours of all connected people.
- **Other people's selections are visible (presence.selection):** `RemoteSelections` draws, for every other person, an outline in that person's colour around each object they have selected, with their name tag at the top-left corner, updating on awareness changes (within 1 second of their selection change). Outlines are world-layer rectangles with `pointer-events: none` and never write to the viewer's `useSelection`, so another person's selection never changes what the viewer has selected and never prevents the viewer from editing that object.
- Names always accompany colours (accessibility).

## Tests
ui-component: TC-19, TC-20, TC-22, TC-23 (`tests/component/presence-ui.test.tsx`). e2e: TC-26 to TC-28.


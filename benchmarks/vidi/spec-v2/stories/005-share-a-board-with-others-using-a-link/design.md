# Technical Design

Board creation moves server-side: POST /api/boards generates a 128-bit random id and initialises the board's Durable Object via one RPC (no retry loop; an id collision is not a practical event and would fail with 500). GET /api/boards/:id and the WebSocket route reject unknown or malformed boards with 404 without writing storage; legacy boards with saved content count as existing. The client gains a tiny router with Home (New board), Board (existence check with retry while the service is unreachable) and Board not found pages, plus a Share panel that copies the link with a manual-copy fallback.

## Overview

## Context
Builds on story 3 (`src/worker/index.ts`, `src/shared/board-id.ts` with 16-byte base64url ids, `/` redirecting to a client-generated id) and story 4 (`src/worker/board-store.ts`, `BoardRoom` loading from SQLite). This story removes client-side board creation and makes board existence explicit.

## Files
| Path | Change | Purpose |
|---|---|---|
| `src/worker/index.ts` | modified | `POST /api/boards`, `GET /api/boards/:id`, 404 for unknown boards on `/api/rooms/:id` |
| `src/worker/create-board.ts` | added | `createBoard`: new id, `initialize()` RPC |
| `src/worker/board-room.ts` | modified | RPC methods `initialize()` and `exists()`; `fetch` rejects non-existent boards before accepting |
| `src/worker/board-store.ts` | modified | read-only existence query; `migrate()` no longer runs on construct, only on `initialize()` or first `append()` |
| `wrangler.jsonc` | modified | `compatibility_date` at or after the date Durable Object RPC requires |
| `src/shared/config.ts` | modified | settings below |
| `src/client/router.ts` | added | minimal pathname router (`/`, `/b/:id`, anything else → not found) using History API |
| `src/client/pages/HomePage.tsx` | added | New board |
| `src/client/pages/BoardPage.tsx` | added | existence check → board (stories 1–4 UI) / not found / unreachable |
| `src/client/pages/NotFoundPage.tsx` | added | Board not found |
| `src/client/share/SharePanel.tsx` | added | Share button + panel + copy |
| `src/client/api.ts` | added | typed fetch wrappers for board API |
| `index.html` | modified | `<meta name="referrer" content="no-referrer">` (privacy constraint) |
| `src/client/App.tsx` | modified | renders router; story 3 redirect removed |

## Named settings added
```ts
export const CREATE_BUDGET_MS = 2000;              // PRD share.create
export const LINK_COPIED_MS = 2000;
export const BOARD_CHECK_RETRY_BASE_MS = 1000;     // backoff doubles up to RECONNECT_MAX_BACKOFF_MS (story 3)
```
`BOARD_ID_BYTES = 16` from story 3 already satisfies the 128-bit requirement.

## HTTP contract
| Method + path | Success | Errors |
|---|---|---|
| `POST /api/boards` | `201 {"id": string}` | `500 {"error":"create_failed"}` |
| `GET /api/boards/:id` | `200 {"id": string}` | `404 {"error":"not_found"}` for unknown **and** malformed ids (no distinction, nothing leaked) |
| `GET /api/rooms/:id` (WebSocket) | `101` as story 3 | `404` for unknown or malformed id (story 3's 400 for malformed becomes 404); `426` without upgrade |
| other methods on `/api/boards` | — | `405` |

## Existence rule
A board exists if its storage has `storage_meta.created_at`, **or** (legacy, share.legacy_boards) it has at least one row in `updates` or `snapshot_chunks`. The check only reads; for an unknown id no tables exist and nothing is written, so probing links leaves no storage behind.

## Structure diagram
```mermaid
flowchart TD
    subgraph Browser
        Router[router.ts] --> Home[HomePage]
        Router --> BoardPage[BoardPage]
        Router --> NotFound[NotFoundPage]
        Home --> Api[api.ts]
        BoardPage --> Api
        BoardPage --> BoardUI[Board UI stories 1 to 4]
        BoardPage --> Share[SharePanel]
        Share --> Clipboard[navigator.clipboard]
    end
    subgraph Worker
        Entry[index.ts] --> Create[create-board.ts]
        Create --> Ids[board-id.ts]
    end
    subgraph DurableObject
        Room[BoardRoom initialize exists fetch] --> Store[BoardStore]
        Store --> SQL[SQLite]
    end
    Api -->|POST and GET api boards| Entry
    BoardUI -->|WebSocket api rooms id| Entry
    Create -->|RPC initialize| Room
    Entry -->|RPC exists| Room
    Entry -->|fetch upgrade| Room
```

## State diagrams
Board existence (persisted):
```mermaid
stateDiagram-v2
    [*] --> Unknown : any id never created
    Unknown --> Initialized : initialize writes created_at
    Unknown --> Unknown : exists check reads only
    Legacy --> Legacy : has updates or snapshot but no created_at
    Initialized --> Initialized : initialize again returns exists
```
Home page (client, not persisted):
```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Creating : click New board
    Creating --> [*] : 201 navigate to b id
    Creating --> CreateFailed : 500 or network error
    CreateFailed --> Creating : click again
```
Board page (client, not persisted):
```mermaid
stateDiagram-v2
    [*] --> NotFound : id fails pattern no request
    [*] --> Checking : id matches pattern
    Checking --> Ready : 200
    Checking --> NotFound : 404
    Checking --> Unreachable : network error or 5xx
    Unreachable --> Checking : backoff timer
    Ready --> [*] : navigate away
```
Share panel (client, not persisted):
```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Open : click Share
    Open --> Copied : writeText resolves
    Open --> ManualCopy : writeText rejects or unavailable
    Copied --> Open : LINK_COPIED_MS elapsed
    ManualCopy --> Copied : later writeText resolves
    Open --> Closed : Escape or outside click
    Copied --> Closed : Escape or outside click
    ManualCopy --> Closed : Escape or outside click
```

## Sequence: create a board
```mermaid
sequenceDiagram
    participant U as User
    participant H as HomePage
    participant W as Worker
    participant R as BoardRoom
    U->>H: click New board
    H->>W: POST api boards
    W->>W: newBoardId
    W->>R: RPC initialize
    alt RPC threw or returned exists
        W-->>H: 500 create_failed
        H-->>U: could not create message button enabled
    else created
        W-->>H: 201 id
        H->>H: history pushState b id
        H-->>U: empty board opens
    end
    alt network error before response
        H-->>U: could not create message
    end
```

## Sequence: open a board link
```mermaid
sequenceDiagram
    participant U as User
    participant P as BoardPage
    participant W as Worker
    participant R as BoardRoom
    U->>P: open b id
    alt id fails BOARD_ID_PATTERN
        P-->>U: Board not found no request sent
    else valid format
        P->>W: GET api boards id
        alt network error or 5xx
            P-->>U: Could not reach vidi6 Retrying
            P->>P: backoff then retry GET
        else
            W->>R: RPC exists
            alt not initialized and no legacy data
                W-->>P: 404
                P-->>U: Board not found
            else exists
                W-->>P: 200
                P->>W: WebSocket api rooms id
                W->>R: fetch upgrade
                alt board vanished between checks
                    R-->>P: 404 provider retries
                else
                    R-->>P: 101 sync as story 3
                    P-->>U: board ready
                end
            end
        end
    end
```

## Sequence: copy link
```mermaid
sequenceDiagram
    participant U as User
    participant S as SharePanel
    participant C as navigator.clipboard
    U->>S: click Share
    S-->>U: panel with link field
    U->>S: click Copy link
    alt clipboard API missing
        S->>S: select field text
        S-->>U: Press Ctrl C message
    else present
        S->>C: writeText full link
        alt rejected permission or insecure context
            S->>S: select field text
            S-->>U: Press Ctrl C message
        else resolved
            S-->>U: Link copied for LINK_COPIED_MS
        end
    end
```

## Test Strategy

## Test scopes and boundaries
| Capability | Levels | Boundary exercised | Why sufficient |
|---|---|---|---|
| share.board_api | unit, integration, e2e | Id format; real Worker request handling + real Durable Object RPC and SQLite; real browser flows | Status codes and "no storage written" are request-handling and storage facts |
| share.pages | ui-component, e2e | Page state machines with mocked `api.ts`; real API in e2e | Components prove every UI state; e2e proves wiring to the real service |
| share.share_panel | ui-component, e2e | Clipboard success and rejection with stubbed clipboard; real clipboard in Chromium e2e | Clipboard permission behaviour varies by engine, so both paths are forced deterministically |

Timing policy: e2e tests wait up to E2E_EVENTUAL_TIMEOUT_MS (story 3) for functional outcomes and log measured durations against their budgets (CREATE_BUDGET_MS); wall-clock budgets are reported, not asserted, because the model, browsers and server share one machine.

## Dimensions crossed
- **D1 Entry**: home create, open link, share copy, WebSocket connect.
- **D2 Board state**: unknown valid id, malformed id, initialized, legacy (data but no created_at).
- **D3 Service condition**: healthy, RPC failure, unreachable.
- **D4 Clipboard**: allowed, rejected, missing API (share entry only).

Classes are exhaustive and non-overlapping within each dimension. TC numbers are stable; removed cases leave gaps.

## Coverage table
| TC | Capability | D1 | D2 | D3 | D4 | Action | Expected before → after | Level |
|---|---|---|---|---|---|---|---|---|
| TC-04 | share.board_api | home create | not applicable: generator | healthy | not applicable: server | 10,000 newBoardId() | all unique; all 22 chars matching BOARD_ID_PATTERN | unit |
| TC-05 | share.board_api | home create | unknown valid id | healthy | not applicable: server | POST /api/boards | 201 with id matching pattern; GET that id 200; storage created_at set | integration |
| TC-06 | share.board_api | open link | unknown valid id | healthy | not applicable: server | GET /api/boards/<fresh id> | 404; runInDurableObject shows no tables in sqlite_master | integration |
| TC-07 | share.board_api | open link | malformed id | healthy | not applicable: server | GET /api/boards/abc and /api/boards/<23 chars> | 404 each; no RPC call made | integration |
| TC-08 | share.board_api | open link | legacy | healthy | not applicable: server | seed updates row without created_at; GET | 200 | integration |
| TC-09 | share.board_api | WebSocket connect | unknown valid id | healthy | not applicable: server | upgrade /api/rooms/<fresh id> | 404; no socket accepted; no tables created | integration |
| TC-10 | share.board_api | WebSocket connect | initialized | healthy | not applicable: server | upgrade after POST | 101 and story 3 sync works | integration |
| TC-12 | share.board_api | home create | not applicable: no board | RPC failure | not applicable: server | inject initialize throwing | 500 create_failed | integration |
| TC-14 | share.board_api | home create | not applicable | healthy | not applicable: server | PUT /api/boards | 405 | integration |
| TC-15 | share.board_api | home create | initialized | healthy | not applicable: server | initialize() twice on same object | first created, second exists; created_at unchanged | integration |
| TC-16 | share.pages | home create | not applicable: mocked api | healthy | not applicable: page | click New board (api resolves id) | button shows Creating… and is disabled; then navigate to /b/id | ui-component |
| TC-17 | share.pages | home create | not applicable: mocked api | RPC failure (500) and network error (2 runs) | not applicable: page | click | message "Couldn't create a board. Please try again."; button enabled; route still / | ui-component |
| TC-19 | share.pages | open link | malformed id | healthy | not applicable: page | render /b/bad | NotFoundPage; api.getBoard not called | ui-component |
| TC-20 | share.pages | open link | unknown valid id | healthy | not applicable: page | api returns 404 | "Opening board…" then NotFoundPage with New board button | ui-component |
| TC-21 | share.pages | open link | initialized | unreachable then healthy | not applicable: page | api rejects twice then 200; fake timers advance BOARD_CHECK_RETRY_BASE_MS then 2x | "Couldn't reach vidi6. Retrying…" → board rendered; 3 calls | ui-component |
| TC-22 | share.share_panel | share copy | initialized | healthy | allowed | click Share, Copy link; advance LINK_COPIED_MS - 1 then 1 | writeText called with full https link; "Link copied" visible then reverts | ui-component |
| TC-23 | share.share_panel | share copy | initialized | healthy | rejected | writeText rejects | field text fully selected; manual-copy message | ui-component |
| TC-24 | share.share_panel | share copy | initialized | healthy | missing API | navigator.clipboard undefined | same as TC-23 | ui-component |
| TC-25 | share.share_panel | share copy | initialized | healthy | not applicable: close behaviour | open then Escape; open then outside click | panel closed both times | ui-component |
| TC-26 | share.pages | home create + open link | initialized | healthy | allowed (Chromium clipboard-read/write granted) | Maya: create board, add note, copy link; Sam: new context opens clipboard text | new empty board opens after the click (click-to-board time logged against CREATE_BUDGET_MS, not asserted); Sam sees note and can edit it (Maya sees Sam's edit) | e2e |
| TC-27 | share.pages | open link | unknown valid id | healthy | not applicable | open /b/<newBoardId()> never created | Board not found; click New board → new empty board | e2e |
| TC-28 | share.pages | open link | initialized | unreachable then healthy | not applicable | page.route abort /api/boards/* then unroute | retry message then board opens without reload | e2e |
| TC-29 | share.share_panel | share copy | initialized | healthy | rejected (init script stubs writeText to reject) | click Copy link | manual-copy message; selection equals full link | e2e |
| TC-31 | share.pages | open link | legacy | healthy | not applicable | seed legacy board via test hook; open its link | board with seeded notes, not Board not found | e2e |

## Boundary values
- Id length: 21, 22, 23 characters (TC-07 plus story 3 TC-01).
- Copied confirmation: LINK_COPIED_MS - 1 and exactly LINK_COPIED_MS (TC-22).
- Retry: first and second backoff intervals (TC-21).

## Negative scenarios
| TC | Must not happen | Level |
|---|---|---|
| TC-06, TC-09 | probing an unknown link must not create storage or a board | integration |
| TC-07, TC-19 | malformed ids must not reach the Durable Object | integration, ui-component |
| TC-15 | an existing board must never be re-initialised | integration |
| TC-17 | failed creation must not navigate away | ui-component |
| TC-32 | board page must not send the board link as a Referer to external origins: assert meta referrer no-referrer present in served index.html | integration |

## Error paths (every contract error has a case)
| Contract error | TC |
|---|---|
| 500 create_failed (RPC throws) | TC-12, TC-17 |
| 404 unknown or malformed id (HTTP and WebSocket) | TC-06, TC-07, TC-09, TC-20, TC-27 |
| 405 wrong method | TC-14 |
| clipboard rejected / missing | TC-23, TC-24, TC-29 |
| network unreachable on check | TC-21, TC-28 |

## Mock vs real boundaries
| Dependency | Mocked? | Reason |
|---|---|---|
| Durable Object RPC + SQLite | Real in integration and e2e | Existence rule and no-write guarantee depend on real storage |
| RPC failure | Injected throwing stub (TC-12) | Cannot force real RPC failure on demand |
| `api.ts` in ui-component tests | Mocked | Page state machines are under test, not the network |
| Clipboard | Stubbed in ui-component and TC-29; real (granted) in TC-26 Chromium | Permission behaviour is engine-specific |
| Network outage | Playwright request routing abort (TC-28) | Deterministic |

## E2E workflows
1. **Create, share, join** (TC-26): asserts board creation (time logged against CREATE_BUDGET_MS), correct copied link, second person joins and both edit live.
2. **Bad link recovery** (TC-27): not found page, then create a fresh board from it.
3. **Flaky service on open** (TC-28): retry message then board opens without reload.
4. **Clipboard blocked** (TC-29): manual copy fallback.
5. **Pre-existing board** (TC-31): legacy board still opens.

## Fixtures
- Ids always from `newBoardId()` except explicit malformed cases (`abc`, 21 and 23 character strings, a string containing `/`).
- Legacy board fixture: real Yjs updates from `tests/fixtures/boards.ts` (story 4) written as `updates` rows with no `created_at`.

## Not covered
Deliberately not covered by automated tests:
- Clipboard behaviour in real Safari and Firefox (e2e forces the fallback path deterministically instead).
- Brute-force probing of the id space: made infeasible by 128-bit ids, not tested.
- Id collisions: with 128 random bits a collision is not a practical event; if `initialize()` ever returns `exists` for a fresh id, creation fails with 500 rather than retrying.
- Chat-app link rendering (whether links survive Slack and email unchanged).
- Wall-clock creation time as a pass/fail criterion: on a shared machine it is logged (TC-26), not asserted.

## Board creation and existence API

> Anchor: `share.board_api`

## Contract
```ts
// src/worker/create-board.ts
export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };
export async function createBoard(env: Env): Promise<CreateResult>;
// src/worker/board-room.ts (RPC, callable on the stub)
initialize(): Promise<'created' | 'exists'>;   // migrate + set created_at if absent
exists(): Promise<boolean>;                     // read-only: created_at, or any updates/snapshot rows
// src/worker/board-store.ts
existsReadOnly(): boolean;                      // queries sqlite_master first; never creates tables
```
- **Inputs**: HTTP requests per the Overview contract.
- **Outputs**: responses per the HTTP contract; `created_at` (epoch ms) written once per board.
- **Errors**: RPC throws, or `initialize()` returns `exists` for a freshly generated id → 500; unknown/malformed id → 404 on GET and on WebSocket upgrade.
- **Side effects**: storage writes only in `initialize()`; none for GET or rejected WebSocket.

## Implementation
- `createBoard` generates one id with `newBoardId()` and calls `initialize()`; there is no retry loop, because a collision between 128-bit random ids is not a practical event (share.unguessable).
- share.create timing: creation is one id generation plus one RPC and one small SQLite write, so the POST fits comfortably inside CREATE_BUDGET_MS (2 s, click to board visible); TC-26 logs the full click-to-board time in a real browser against that budget without asserting it.
- `index.ts` validates the id with `isValidBoardId` before touching the namespace, so malformed ids never instantiate an object (TC-07).
- `BoardRoom.fetch` calls `this.store.existsReadOnly()` before accepting; unknown boards return 404, so story 3/4 rooms can no longer be created implicitly by connecting (share.not_found).
- Story 4 change: `BoardStore.load()` treats missing tables as an empty board without creating them; `migrate()` runs inside `initialize()` and lazily before the first `append()` (legacy boards already have tables, share.legacy_boards).
- Link unguessability relies on story 3's `newBoardId()` (16 bytes from `crypto.getRandomValues`, base64url); ids are never derived from time, counters or other ids.
- The story 3 client redirect from `/` to a random id is deleted.

## Tests
unit: TC-04 (`tests/unit/create-board.test.ts`). integration: TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32 (`tests/integration/board-api.test.ts`). e2e: TC-26, TC-27, TC-31.

## Home, board and not-found pages

> Anchor: `share.pages`

## Contract
```ts
// src/client/api.ts
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };
export function createBoardRequest(): Promise<CreateResponse>;   // network errors -> failed
export function checkBoard(id: string): Promise<CheckResponse>;  // network errors and 5xx -> unreachable
// src/client/router.ts
export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };
export function useRoute(): Route; export function navigate(path: string): void;
// src/client/pages/state.ts
export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: "Couldn't create a board. Please try again." };
export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };
export function nextBoardPageState(state: BoardPageState, result: CheckResponse, attempt: number): BoardPageState;
// src/client/pages/*.tsx
export function HomePage(): JSX.Element;
export function BoardPage(props: { id: string }): JSX.Element;
export function NotFoundPage(): JSX.Element;
```
- **Inputs**: pathname; API responses.
- **Outputs**: `HomePageState` / `BoardPageState` values per the Overview state diagrams, rendered with the exact PRD copy for each message; `BoardPage` mounts the stories 1–4 board (and its `connectBoard`) only in `ready`.
- **Errors**: create failure / unreachable handled as page states, never thrown to the user.
- **Side effects**: `history.pushState` on successful create; retry timers cleared on unmount.

## Implementation
- **Create (share.create):** New board moves `HomePageState` to `creating` ("Creating…", button disabled) while `createBoardRequest` runs; on `created` the page navigates to `/b/<id>` and the empty board opens within CREATE_BUDGET_MS (2 s).
- **Creation failure (share.create_failure):** on `failed` (500 or network error) the state becomes `create_failed`: the person stays on the Home page (no navigation), the message "Couldn't create a board. Please try again." appears under the button, and the New board button is enabled again.
- **Open link / not found / unreachable (share.open_link, share.not_found, share.unreachable):** `BoardPage` checks `isValidBoardId` first (malformed → `not_found`, no request), then `checkBoard`; `exists` → `ready`, opening the board with full editing and no sign-in; `not_found` → Board not found with a New board button (reusing `HomePage`'s create action), creating nothing; `unreachable` → "Couldn't reach vidi6. Retrying…" and a retry after `nextRetryMs` (exponential from `BOARD_CHECK_RETRY_BASE_MS`, capped at `RECONNECT_MAX_BACKOFF_MS`), reaching `ready` or `not_found` without a reload.
- No router library: three routes do not justify a dependency.

## Tests
ui-component: TC-16, TC-17, TC-19 to TC-21 (`tests/component/pages.test.tsx`). e2e: TC-26 to TC-28, TC-31 (`tests/e2e/share.spec.ts`).

## Share panel

> Anchor: `share.share_panel`

## Contract
```tsx
// src/client/share/SharePanel.tsx
export function boardLink(origin: string, id: string): string;   // `${origin}/b/${id}`
export function SharePanel(props: { boardId: string }): JSX.Element;
```
- **Inputs**: board id, `window.location.origin`, clicks and Escape.
- **Outputs**: `button` "Share" (top-right); panel `role="dialog"` `aria-label="Share board"` containing `input[readonly]` with the full link, `button` "Copy link" (text becomes "Link copied" for `LINK_COPIED_MS`), note "Anyone with this link can view and edit this board.", and in manual-copy state the text "Press Ctrl+C (Cmd+C on Mac) to copy".
- **Errors**: `navigator.clipboard` missing or `writeText` rejecting → ManualCopy state (select entire input value, focus input).
- **Side effects**: clipboard write; focus management (focus returns to Share button on close).

## Implementation
Clicking the input selects all text (`input.select()`), satisfying the PRD field behaviour. The panel closes on Escape and outside pointerdown. Opening the copied link lands on `BoardPage`, completing share.open_link with no extra step.

## Tests
ui-component: TC-22 to TC-25 (`tests/component/SharePanel.test.tsx`). e2e: TC-26, TC-29.


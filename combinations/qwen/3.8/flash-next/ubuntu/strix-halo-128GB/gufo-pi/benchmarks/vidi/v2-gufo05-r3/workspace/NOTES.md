# Story 5 — Notes on decisions, deviations and test adaptations

Everything the design asked for is implemented. Where I diverged from the design
or had to adapt existing tests, it is written down here.

## Implementation

- **Board id** (`src/shared/board-id.ts`): unchanged, already correct. 22-character
  base64url (128 bits) with a strict reader. The last character carries only 2 of
  the 6 nominal bits, so the randomness test compares the first 21 characters and
  the full string across 100 ids (`tests/unit/create-board.test.ts` → TC-04).
- **Board API** (`src/worker/index.ts`): `POST /api/boards` (201 `{id}` / 500) and
  `GET /api/boards/:id` (200 / 404). `GET /api/rooms/:id` returns 404 when the
  board does not exist, before the WebSocket upgrade.
- **Create** (`src/worker/create-board.ts`): generates the id, asks the board's own
  Durable Object to create it over in-cluster RPC (`stub.initialize()`), and never
  guesses success.
- **Existence** (`src/worker/board-store.ts`, `board-room.ts`): a read-only SQLite
  check for a creation marker row (or any board row). No table is created by a
  check; a board with a malformed id is reported identically to an unknown one.
- **Client**: `router.ts`, `api.ts`, `pages/state.ts` + `HomePage`, `BoardPage`,
  `NotFoundPage`, `share/SharePanel`, and `Root.tsx` / `main.tsx` wiring.
- **Config** (`src/shared/config.ts`): `CREATE_BUDGET_MS`, `LINK_COPIED_MS`,
  `BOARD_CHECK_RETRY_BASE_MS`. All timing-sensitive tests read these.

## Deviations from the design, and why

1. **`App.tsx` stays the board renderer; the router lives in `Root.tsx`
   (`main.tsx` renders `<Root/>`).** The design suggested routing in `App.tsx`,
   but the existing component tests for stories 1–4 render `<App doc={…} />` and
   `<App boardId={…} />` directly (`boardHarness.tsx`, `BoardLoadFailure.test.tsx`).
   Turning `App` into the router would break those tests, which the task forbids.
   `App`'s props and behaviour are unchanged; the router is a thin layer above it,
   so the shipped behaviour matches the design exactly.

2. **`nextBoardPageState` has an optional fourth argument (`boardId`).** The design
   contract lists three; the fourth records which board became ready so
   `SharePanel` and the board know the id. The three-argument contract still works
   (the `ready.boardId` tests call it with three and get `undefined`).

3. **The Durable Object no longer migrates when it is merely constructed.**
   Previously `loadBoard()` created the SQLite tables on first sight, which meant
   a single probe would materialise a board. Now: tables are created only by
   `initialize()` (creation) or lazily on the first `append()`; `load()` and
   `stats()` are guarded so a never-created board reads as empty without creating
   anything. Migration therefore happens when a board is created and on the first
   write, satisfying "migration only on creation".

4. **A malformed board id now returns 404, not 400.** The design's
   `share.not_found` requires that a probe cannot tell a made-up code from a
   mistyped one. Returning 400 for malformed ids leaked that distinction, so
   malformed and unknown both give 404.

5. **`<meta name="referrer" content="no-referrer">` added to `index.html`.** With
   boards addressed by a secret-in-the-URL id, the whole URL is a capability. The
   spec's board-survival test asserts the id never leaves the app; this guarantees
   it is not forwarded to any external asset.

## Adaptations to existing tests (all faithful to the stories, none weakened)

- **`tests/integration/ws-client.ts`**: the harness now calls
  `ensureBoard(boardId)` (a `POST /api/boards` that adopts the generated id) before
  a WebSocket connects. The WebSocket protocol has no request/response, so a
  connecting client no longer creates a board — a test that wants a board must
  create one first, exactly as the app does. It is memoised per id so a
  connection-only test (TC-13, "routing economy") still sees a single DO
  instantiation.

- **`tests/integration/worker.test.ts`**: two assertions changed 400 → 404 (the
  malformed-id case, per deviation 4). Two tests that relied on "opening a board
  creates it" now create the board first ("upgrades a valid board id", and the
  capacity test, which watches the id before connecting). The rules they assert —
  a valid id upgrades, an unknown id is 404, two paths to one board are one room —
  are unchanged.

- **E2E `gotoBoard`** (`tests/e2e/helpers/board.ts`) now clicks **New board** on the
  home page instead of opening `/`, because `/` is no longer a board.

- **E2E create helper** (`tests/e2e/helpers/participants.ts`): `createBoard(request)`
  makes a board over the API. `live-collaboration.spec.ts`,
  `board-survival.spec.ts`, `storage-hooks-not-in-production.spec.ts` and the
  (non-default) `live-collaboration-nightly.spec.ts` create a board before opening
  `/b/:id`, because opening an unknown id now shows Board not found. The board
  **content, editing and collaboration** assertions are untouched — only how the
  board comes to exist.

- **Persistence: `legacy-board.spec.ts` (TC-31)** runs in the `persistence` project
  (test hooks on) and seeds a board through the seed hook, which writes board rows
  without a creation marker — a pre-feature board — then opens its link. It checks
  the board opens with its content and is not reported as missing. (The design
  placed TC-31 in the share spec; it belongs in the hooks-enabled project, same
  behaviour tested.)

- **Clipboard in tests**: the copy and manual-copy paths are asserted at component
  level (`tests/component/share.test.tsx`, TC-22/23/24/25) and the manual path again
  in e2e (TC-29). The e2e golden path (TC-26) reads the link from the panel's input
  (`data-testid="share-link"`) rather than the system clipboard, so it stays
  deterministic across browsers while still proving a second person joins the very
  board the first one shared.

- **Component jsdom URL kept at the default.** I first pointed the component project
  at an `https` origin so the Share panel would assemble an `https` link, but that
  broke `ConnectionStatus.test.tsx`, which asserts the provider URL derived from the
  jsdom origin. Instead the Share test asserts the assembled link against
  `window.location.origin` and checks the `https` shape directly on `boardLink`,
  which is where the guarantee actually lives.

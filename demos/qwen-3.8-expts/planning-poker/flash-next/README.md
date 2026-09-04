# Planning Poker (clone of planningpokeronline.com)

Real-time, multiplayer agile estimation. Vite + React frontend, Node WebSocket backend (no external realtime service).

## Run

```
npm run setup        # npm install (idempotent). BUILD=1 npm run setup also builds.
npm run dev          # resilient dev: starts WS server (:8788) + Vite (:5173)
```

Open http://localhost:5173. Open a second browser / incognito tab and Join with the game code (or "Copy invite link") to test multiplayer.

`npm run dev` is **resilient to servers already running**:
- port already hosting our game server → **reused**, not duplicated
- port held by a foreign service (e.g. wrangler on 8787) → **aborts with guidance** instead of an EADDRINUSE crash
- ports free → starts everything

Override ports: `WS_PORT=9000 WEB_PORT=4000 npm run dev` (the Vite `/ws` proxy follows `WS_PORT` automatically).

## Production

```
npm start            # builds dist/ if missing, then serves it + WS on :8788
```
Skip the build step with `SKIP_BUILD=1 npm start`. Reuse a running instance automatically, or run your own: `PORT=9000 npm start`.

## Bash wrappers

The install and start flows also have standalone bash wrappers (same behaviour as the `.mjs` scripts, usable without npm):

```
./scripts/install.sh [--build]     # deps; --build also does the production build
./scripts/start.sh                 # resilient production run on $PORT (default 8788)
./scripts/start.sh --dev           # delegate to the resilient dev orchestrator
PORT=9000 SKIP_BUILD=1 ./scripts/start.sh
```

`start.sh` uses `curl` (compatibility) + `nc`/`/dev/tcp` (occupancy) and reuses the three-way rule: free → start, our server already up → reuse, foreign service → abort. It requires `bash` (macOS/Linux); use the `.mjs` scripts on Windows.

## Stopping

```
npm run stop         # frees our ports; leaves foreign services on them untouched
```

## Tests

```
npm test             # 8 tests: game rules + end-to-end multiplayer over real WebSocket
```

## Layout

- `server/game.mjs` — pure, testable game state + rules (decks, hidden votes, reveal, tally, role permissions).
- `server/server.js` — HTTP static + WebSocket room server. Server is authoritative; broadcasts a per-member sanitized view (other players' votes hidden until reveal).
- `src/` — React client. `useRoom.js` is the WS hook (connect, receive state, send actions).

## How it works

- Create game → generates a room id; the creator connects as `facilitator` (`host=1`), which creates the room server-side.
- Join → connect to an existing room as `player` (can vote) or `spectator` (read-only). Joining a non-existent room is rejected.
- During the voting phase, a player's card is hidden from everyone else (`publicView`). Reveal flips the phase and shows every vote + a tally.
- Only the facilitator can reveal, reset, change deck, and manage/advance issues (enforced server-side in `handleAction`).

## Scope / known limits (not yet built)

- Rooms are in-memory only, wiped on restart, deleted 5 min after everyone leaves. No DB, no resuming past games.
- No auth/paid tiers, no CSV/Jira/Linear import, no per-user avatars or chat.
- Single Node process: no cross-instance WS fan-out (would need a Redis/DO pub-sub to scale horizontally).
- `identity` is a client-generated id in localStorage; not tamper-proof. A real product would need session auth before the role check is trustworthy.

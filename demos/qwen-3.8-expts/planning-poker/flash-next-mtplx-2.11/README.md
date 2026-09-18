# Planning Poker — real-time estimating clone

A no-signup, no-payment clone of planningpokeronline.com: create a room, share the URL,
and estimate stories together. Everyone picks a card; cards flip at the same time on reveal.

## Stack
- Vite + React 19 + Tailwind 4 (client)
- Node `ws` server with a pure, tested game state machine (`server/game.mjs`)
- Real-time sync over WebSocket; room state is authoritative server-side

## Run
```
bun install
bun run dev            # starts ws server + vite (proxy /ws -> :8787)
```
Open the printed Vite URL in two browser tabs to simulate a team.

## Test
```
bun run test           # node:test for server + vitest for client
```

## How a game works
1. Enter a name -> Create game generates a room code and connect URL.
2. Each player picks a card (1/2 … 55, ?, coffee). Selection stays hidden (face-down).
3. When everyone locks in, the round auto-reveals (or the host hits "reveal").
   Cards flip simultaneously with a staggered 3D animation; a results bar shows the spread.
4. Host clicks "Next round" to clear votes and advance.

## Structure
- `server/game.mjs`    pure room state machine + tests
- `server/server.js`   WebSocket transport + auto-reveal wiring + tests
- `src/poker.js`       shared client helpers (deck, distribution, averaging)
- `src/components.jsx` FlipCard / PlayerSeat / MyDeck / ResultsBar
- `src/App.jsx`        landing + game table
- `src/useRoom.js`     WebSocket hook

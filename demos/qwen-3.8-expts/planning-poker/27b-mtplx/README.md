# Planning Poker

A clone of planningpokeronline.com: real-time story-point estimation with a shared game link.

## Stack

- **Cloudflare Worker + Durable Objects** — one DO per game room, WebSocket sync, state persisted to DO storage
- **React + Vite** — SPA served as Worker assets with single-page-app fallback
- **Vitest** with the Cloudflare Workers pool for unit + DO tests

## Game flow

1. Facilitator starts a game, gets a shareable link (`/game/<id>`)
2. Players join by name (first joiner is the facilitator)
3. Facilitator starts a round — either a **quick vote** (no setup) or by adding issues and picking one
4. Everyone picks a Fibonacci card (0–100); cards reveal together when all have voted
5. Consensus (all equal) → estimate recorded; otherwise re-vote or skip to the next issue

## Quick start

```bash
./scripts/install.sh   # npm install + frontend build
./scripts/run.sh       # → http://localhost:8787 (port overridable: ./scripts/run.sh 9000)
```

## Develop

```bash
npm run dev:worker    # wrangler dev → http://localhost:8787 (API + built assets)
npm run dev:frontend  # vite with HMR → http://localhost:5173 (proxies /api to 8787)
```

`npm run smoke` runs an end-to-end game (2 WS clients, vote → reveal → consensus) against a running `wrangler dev`.

## Test / typecheck / build

```bash
npm test
npm run typecheck
npm run build
```

## Deploy

```bash
npm run deploy   # builds frontend, deploys worker + assets via wrangler
```

## Layout

- `src/worker.ts` — HTTP routes (`POST /api/games`, `GET /api/games/:id/ws`), static assets
- `src/game.ts` — `GameRoom` Durable Object (WebSocket handler, persistence)
- `src/rules.ts` — pure game-state reducer (all rules, unit-tested)
- `src/types.ts` — shared types
- `frontend/` — React app
- `test/` — vitest (Workers pool)

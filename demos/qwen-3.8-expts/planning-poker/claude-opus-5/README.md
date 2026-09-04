# Pointing Poker

Real-time planning poker on Cloudflare Workers. Share a link, everyone plays a card at the
same time, nobody sees a number until the reveal.

Built with `/cf-starter` conventions, with one deliberate departure — see
[Why a Durable Object](#why-a-durable-object).

## What it does

- **Rooms from a link.** `POST /api/rooms` mints a spoken-friendly code (`abc-def-ghi`).
  No accounts, no installs.
- **Hidden votes.** A card that has not been revealed never leaves the Durable Object.
  Other players receive `hasVoted: true` and nothing else, so the secret cannot be read
  out of the network tab.
- **Decks.** Fibonacci, modified Fibonacci, powers of two, T-shirt sizes, sequential,
  risk, plus custom decks. `?` and `☕` are counted in the distribution but excluded from
  the average.
- **Reveal.** Manual, or automatic once every connected estimator has played.
- **Round stats.** Average, median, unanimity, distribution, and the low/high spread —
  the number that tells you whether to re-vote or move on.
- **Backlog.** Paste a list of tickets (plain lines, `KEY, Title`, or a CSV export with a
  header row), walk them one at a time, commit the agreed estimate, export as CSV.
- **Facilitator controls.** Rename the room, change the deck, reveal, start a round,
  promote someone else, remove a player. Facilitation transfers automatically if the
  facilitator disappears.
- **Roles.** Estimator or observer, switchable mid-session.
- **Resilience.** Reconnects with exponential backoff; a refresh reclaims the same seat
  and the same hidden card via a stable browser id.
- **Keyboard.** Number keys play the matching card, `r` reveals, `n` starts a round.

Not built: accounts, billing, SSO, and the Jira/Linear integrations. Those are the
commercial shell around the product, not the product.

## Architecture

```
Browser ──HTTP──▶ Worker ──▶ D1        room registry + round history (best effort)
   │                 │
   │                 └──▶ PokerRoom (Durable Object)   live room state, one per room code
   └──WebSocket──────────▶ (same object, hibernating)
```

| Path | Owner |
| --- | --- |
| `worker/index.ts` | Routing, validation, security headers, request id |
| `worker/room.ts` | `PokerRoom` Durable Object — the whole game engine |
| `worker/stats.ts` | Round maths (pure, unit-tested) |
| `worker/rooms.ts` | Room codes and the D1 registry |
| `shared/` | Wire protocol, decks and sanitisation, imported by both sides |
| `src/` | Vite + React SPA, served by Workers Static Assets |

### Why a Durable Object

`/cf-starter` is built around request → auth → D1 → response. That shape does not fit a
room where six browsers watch one piece of mutable state and a vote must stay secret until
a specific moment. D1 would need polling, and polling either leaks votes or feels dead.

A Durable Object is a single-threaded actor with its own storage and its own WebSockets, so
the room *is* the consistency boundary. Hidden votes never appear in a payload; the
snapshot is serialised per connection. Hibernation means an idle room costs nothing while
its sockets stay open.

D1 keeps the jobs it is actually good at: knowing a room code existed after the object is
evicted, and storing round history. Both writes are best effort — if D1 is down, the
session still runs.

## Running locally

```bash
./scripts/install.sh     # dependencies, local D1 schema, first build
./scripts/run.sh         # worker + SPA on one port
```

`run.sh` takes a mode:

| Command | What it does |
| --- | --- |
| `./scripts/run.sh` | Serves the built SPA and API from one worker |
| `./scripts/run.sh dev` | Vite hot reload on :5173, proxying `/api` to the worker |
| `./scripts/run.sh test` | Starts a server, runs unit + e2e suites against it, shuts down |

`PORT=9000 ./scripts/run.sh` pins the port; otherwise it scans upward from 8787 for a free
one. `./scripts/install.sh --force` discards `node_modules` and reinstalls.

Both scripts are written for bash 3.2 (the version stock macOS ships), depend only on
bash builtins plus node and npm, retry transient network and D1 failures, refuse to wait
on a server process that has already died, and tear down the whole worker process tree —
including the `workerd` child that wrangler forks — on every exit path including Ctrl-C.

## Tests

```bash
npm test                 # 25 unit tests: round maths, CSV parsing, room codes, sanitisation
./scripts/run.sh test    # the above, plus e2e against a real server it starts and stops
```

The e2e suite drives real WebSocket clients through a full round. It asserts the property
that matters most — a hidden vote is never sent to another player — along with facilitator
permissions, spectator rules, reveal, deck changes and estimate commits.

To run it against a server you started yourself:

```bash
E2E_BASE_URL=http://127.0.0.1:8787 npm run test:e2e
```

## Deploying

Both environments need a D1 database and its id pasted into `wrangler.toml`:

```bash
npx wrangler d1 create pointing-poker-staging
npx wrangler d1 create pointing-poker-production
```

Then:

```bash
./scripts/deploy.sh staging
./scripts/deploy.sh production v1.0.0
```

The script scans pending migrations for irreversible SQLite patterns (`CHECK (`,
`DROP TABLE`, `DROP COLUMN`, `ADD CONSTRAINT`) and refuses production if it finds any,
skips a redeploy when `/health` already reports the current SHA, retries `wrangler deploy`
with backoff, verifies `/health` afterwards, tags the commit, and appends to
`.deploy-log.csv`.

## Operations

`GET /health` returns status, version, environment, git SHA, deploy time, and whether D1
is bound. Every API response carries `X-Request-Id`, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, a `frame-ancestors` CSP, and `Cache-Control: no-store`.

## Known limits

- **No authentication.** Anyone with a room code can join, and any joiner can be promoted
  to facilitator. Treat a room link like a meeting link. Adding auth means adding the
  `/cf-starter` API-key or session middleware in front of the WebSocket upgrade.
- **50 players per room**, 500 issues per room (`shared/protocol.ts`).
- **Empty rooms are deleted after 24 hours**; disconnected players are pruned after 45
  seconds.
- **Room codes are random, not reserved.** A code collides with probability ~1 in 31^9;
  there is no uniqueness check on creation.
- **History is best effort.** A D1 failure is logged and swallowed rather than interrupting
  a live round.

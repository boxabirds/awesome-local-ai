# vidi6

A shared board for thinking together.

A collaborative whiteboard: sticky notes on an infinite canvas, synced live over
Yjs, stored per board in a Durable Object, reachable through a link.

## Running it

```bash
npm install
npm run dev      # wrangler dev — API, rooms and the built client on one origin
npm run build    # client bundle into dist/client (the worker serves it)
```

Board links are `/b/<22 character code>`. The code is 16 random bytes: anyone
who has the link can view and edit that board, so a link is a secret.

## Tests

```bash
npm test                       # unit + component + integration + e2e
npm run test:unit              # pure logic: id generation, create retries, settings parity
npm run test:component         # pages and Share panel in jsdom, APIs mocked
npm run test:integration       # Worker, Durable Object SQLite and the room protocol inside workerd
npm run test:e2e               # Chromium against `wrangler dev`, real sockets and storage
```

`npm run typecheck` covers the client and the worker (with the generated
`worker-configuration.d.ts`).

The e2e suite starts its own `wrangler dev` on port 8787 with a throwaway state
directory and `TEST_HOOKS:1`, which enables `/__test/seed-legacy-board` — the
only way to build a board that has content but no `created_at` marker.

The design calls for the dead-link and clipboard-refusal flows in Firefox and
WebKit as well. Those projects are added automatically on a host that has the
GTK libraries (`npx playwright install --with-deps firefox webkit`); where they
are missing the run says so and continues with Chromium rather than failing.

## Layout

```
src/shared/    code both sides use: board ids, the Yjs board model, protocol, settings
src/worker/    Worker entry, BoardRoom Durable Object, its SQLite store, board creation
src/client/    React app: router, pages, canvas, notes, sync, share panel
tests/         unit, component, integration, e2e
spec/          stories, PRDs and designs
```

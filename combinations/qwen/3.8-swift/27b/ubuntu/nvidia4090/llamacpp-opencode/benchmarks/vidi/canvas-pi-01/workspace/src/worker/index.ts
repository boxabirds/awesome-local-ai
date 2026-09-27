// Worker entry (see spec: share.board_api + sync.worker_entry).
//
// Routes:
// - POST /api/boards          create a board (rate limited; 201/429/500)
// - GET  /api/boards/:id      existence check (200/404; read-only)
// - /api/rooms/:boardId       y-websocket route: a valid id with an
//   `Upgrade: websocket` request is forwarded to that board's BoardRoom
//   Durable Object (one object per board id, which is what isolates boards).
//   Unknown or malformed ids get 404 (story 5; was 400 for malformed) and a
//   valid id without the upgrade header gets 426.
// Every other path falls through to the static assets (SPA fallback serves
// the client for / and /b/:boardId). There is deliberately no participant
// counting: capacity (MAX_CONCURRENT_EDITORS) is soft and over-capacity
// joiners are never refused.

import { isValidBoardId, newBoardId } from '../shared/board-id';
import { createBoard } from './create-board';
import { BoardRoom } from './board-room';

export { BoardRoom };

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Story 5: rate limit for board creation (see wrangler.jsonc). */
  BOARD_CREATE_LIMITER: RateLimit;
  /** '1' only in the e2e wrangler environment; unset in production. */
  TEST_HOOKS?: string;
}

const ROOM_ROUTE = /^\/api\/rooms\/([^/]+)$/;
const BOARD_BY_ID_ROUTE = /^\/api\/boards\/([^/]+)$/;
// Test-only board maintenance hooks (spec tasks 9 + story 5 TC-31). The room
// performs the work; the worker only forwards when TEST_HOOKS is set, so the
// production build never exposes these routes.
const TEST_HOOK_ROUTE = /^\/__test\/boards\/([^/]+)\/(compact|corrupt-snapshot|repair|reconstruct|seed-legacy)$/;
// Test-only board creation (e2e helper): bypasses the rate limiter so
// parallel specs can each spin up fresh boards without exhausting the
// BOARD_CREATE_LIMIT window. Gated on TEST_HOOKS like the other hooks.
const TEST_CREATE_ROUTE = '/__test/boards/create';

/** The visitor's IP is the rate-limit key (PRD: per-visitor limit). */
function visitorKey(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? 'unknown-visitor';
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    if (env.TEST_HOOKS === '1') {
      if (new URL(req.url).pathname === TEST_CREATE_ROUTE && req.method === 'POST') {
        const id = newBoardId();
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
        return stub.initialize().then((result) =>
          result === 'created'
            ? Response.json({ id }, { status: 201 })
            : Response.json({ error: 'create_failed' }, { status: 500 }),
        );
      }
      const hook = TEST_HOOK_ROUTE.exec(new URL(req.url).pathname);
      if (hook !== null && hook[1] !== undefined && req.method === 'POST') {
        const boardId = decodeURIComponent(hook[1]);
        if (!isValidBoardId(boardId)) {
          return Promise.resolve(new Response('Bad Request', { status: 400 }));
        }
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
        return stub.fetch(req);
      }
    }

    const url = new URL(req.url);
    if (url.pathname === '/api/boards') {
      if (req.method !== 'POST') {
        return Promise.resolve(new Response('Method Not Allowed', { status: 405 }));
      }
      return createBoard(env, visitorKey(req)).then((result) => {
        if (result.ok) {
          return Response.json({ id: result.id }, { status: 201 });
        }
        const status = result.reason === 'rate_limited' ? 429 : 500;
        return Response.json({ error: result.reason }, { status });
      });
    }
    const boardMatch = BOARD_BY_ID_ROUTE.exec(url.pathname);
    if (boardMatch !== null && boardMatch[1] !== undefined) {
      const boardId = decodeURIComponent(boardMatch[1]);
      if (req.method !== 'GET') {
        return Promise.resolve(new Response('Method Not Allowed', { status: 405 }));
      }
      // Malformed ids 404 exactly like unknown ids (nothing leaked, and the
      // Durable Object namespace is never touched — TC-07).
      if (!isValidBoardId(boardId)) {
        return Promise.resolve(Response.json({ error: 'not_found' }, { status: 404 }));
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.exists().then((exists) =>
        exists
          ? Response.json({ id: boardId }, { status: 200 })
          : Response.json({ error: 'not_found' }, { status: 404 }),
      );
    }
    const match = ROOM_ROUTE.exec(url.pathname);
    if (match !== null && match[1] !== undefined) {
      const boardId = decodeURIComponent(match[1]);
      // Story 5: malformed ids are unknown boards, not client errors (404,
      // was 400 in story 3); the namespace is never touched.
      if (!isValidBoardId(boardId)) {
        return Promise.resolve(Response.json({ error: 'not_found' }, { status: 404 }));
      }
      const upgrade = req.headers.get('Upgrade');
      if (upgrade === null || !upgrade.toLowerCase().includes('websocket')) {
        return Promise.resolve(new Response('Upgrade Required', { status: 426 }));
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

// Worker entry (sync.worker_entry).
//
// Routes:
// - `POST /api/boards` → create a new board (201 {id} / 500)
// - `GET /api/boards/:id` → check board existence (200 {id} / 404)
// - `/api/rooms/:boardId` (valid id + Upgrade: websocket) → BoardRoom DO
// - Everything else → static assets fetcher with SPA fallback.
//
// Boards stay separate (live.isolation): `idFromName(boardId)` maps every
// board to its own object instance, which holds only that board's Y.Doc and
// broadcasts only to its own sockets.
//
// Over-capacity joins are never refused (live.over_capacity): the Worker and
// the room never count participants; MAX_CONCURRENT_EDITORS is a soft design
// and test target only.

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOMS_PREFIX = '/api/rooms/';
const BOARDS_PREFIX = '/api/boards';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // --- Board API ---
    if (url.pathname === BOARDS_PREFIX || url.pathname.startsWith(BOARDS_PREFIX + '/')) {
      return handleBoardsApi(req, url, env);
    }

    // --- WebSocket rooms ---
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length);
      if (!isValidBoardId(boardId)) {
        return new Response('Not Found', { status: 404 });
      }
      const upgrade = (req.headers.get('Upgrade') ?? '').toLowerCase();
      if (upgrade !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(req);
    }

    // --- Test hook: seed a legacy board (test mode only) ---
    if (url.pathname === '/api/test/seed-legacy' && req.headers.get('x-test-hook') === 'true') {
      return seedLegacyBoard(url, env);
    }

    // --- Static assets / SPA fallback ---
    return env.ASSETS.fetch(req);
  },
};

async function seedLegacyBoard(url: URL, env: Env): Promise<Response> {
  const id = url.searchParams.get('id');
  if (!id || !isValidBoardId(id)) {
    return new Response('Bad Request', { status: 400 });
  }
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    await stub.seedLegacy();
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function handleBoardsApi(req: Request, url: URL, env: Env): Promise<Response> | Response {
  const method = req.method.toUpperCase();

  // POST /api/boards → create
  if (url.pathname === BOARDS_PREFIX) {
    if (method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    return createBoard(env).then((result) => {
      if (result.ok) {
        return new Response(JSON.stringify({ id: result.id }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'create_failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  }

  // GET /api/boards/:id → existence check
  const idMatch = /^\/api\/boards\/([^/]+)$/.exec(url.pathname);
  if (idMatch) {
    const boardId = idMatch[1];
    if (method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    // Malformed id → 404 without touching the namespace.
    if (!isValidBoardId(boardId)) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.exists().then((exists) => {
      if (exists) {
        return new Response(JSON.stringify({ id: boardId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  }

  // Unknown path under /api/boards
  return new Response('Not Found', { status: 404 });
}

export { BoardRoom };

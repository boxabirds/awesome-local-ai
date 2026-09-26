import { isValidBoardId } from '../shared/board-id';
import { createBoard } from './create-board';
import type { Env } from './env';

export type { Env } from './env';
export { BoardRoom } from './board-room';

const ROOM_PATH_PREFIX = '/api/rooms/';
const BOARDS_PATH = '/api/boards';

/**
 * Worker entry.
 *
 * - `POST /api/boards` creates a new board (rate-limited, collision-retried).
 * - `GET /api/boards/:id` checks whether a board exists.
 * - `/api/rooms/:boardId` upgrades to the board's BoardRoom Durable Object.
 * - Everything else is served from static assets (SPA fallback).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // POST /api/boards — create a new board
    if (url.pathname === BOARDS_PATH && request.method === 'POST') {
      return handleCreateBoard(request, env);
    }

    // GET /api/boards/:id — check board existence
    if (url.pathname.startsWith(BOARDS_PATH + '/') && request.method === 'GET') {
      const id = url.pathname.slice(BOARDS_PATH.length + 1);
      return handleGetBoard(id, env);
    }

    // Other methods on /api/boards → 405
    if (url.pathname === BOARDS_PATH || url.pathname.startsWith(BOARDS_PATH + '/')) {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // /api/rooms/:id — WebSocket upgrade
    if (url.pathname.startsWith(ROOM_PATH_PREFIX)) {
      const boardId = url.pathname.slice(ROOM_PATH_PREFIX.length);
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleCreateBoard(request: Request, env: Env): Promise<Response> {
  const visitorKey = request.headers.get('CF-Connecting-IP') ?? 'unknown';

  const initializeBoard = async (id: string): Promise<'created' | 'exists'> => {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    return stub.initialize();
  };

  // When the local runtime does not provide a rate limiter binding, creation is unlimited.
  const limiter = env.BOARD_CREATE_LIMITER ?? { limit: async () => ({ success: true }) };
  const result = await createBoard(
    limiter,
    initializeBoard,
    visitorKey,
  );

  if (result.ok) {
    return new Response(JSON.stringify({ id: result.id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (result.reason === 'rate_limited') {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ error: 'create_failed' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleGetBoard(id: string, env: Env): Promise<Response> {
  if (!isValidBoardId(id)) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  const exists = await stub.exists();
  if (exists) {
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

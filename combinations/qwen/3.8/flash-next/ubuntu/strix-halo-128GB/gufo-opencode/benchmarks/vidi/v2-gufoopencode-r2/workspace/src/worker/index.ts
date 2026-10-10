// Worker entry: board creation/existence on `/api/boards`, WebSocket
// upgrades for `/api/rooms/:boardId` routed to the board's BoardRoom
// Durable Object, everything else served from static assets
// (single-page-application fallback). `idFromName(boardId)` keeps boards
// separate; participants are never counted (capacity 5 is a design
// target, never enforced — over-capacity joiners are accepted like anyone
// else). Unknown or malformed ids are 404 everywhere, and a request that
// only asks "does this board exist?" never writes storage.

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { maybeHandleTestHook } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  // Set to '1' by the e2e/dev workers (wrangler dev --var TEST_HOOKS:1) to
  // enable the storage-corruption test hooks. Never set in production.
  TEST_HOOKS?: string;
}

const ROOM_ROUTE = /^\/api\/rooms\/([^/?]+)$/;
const BOARDS_COLLECTION = '/api/boards';
const BOARD_ITEM_ROUTE = /^\/api\/boards\/([^/?]+)$/;

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function decodeId(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === BOARDS_COLLECTION) {
      if (req.method !== 'POST') {
        return jsonError(405, 'method_not_allowed');
      }
      const result = await createBoard(env);
      if (!result.ok) {
        return jsonError(500, result.reason);
      }
      return new Response(JSON.stringify({ id: result.id }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }

    const boardMatch = BOARD_ITEM_ROUTE.exec(url.pathname);
    if (boardMatch !== null) {
      if (req.method !== 'GET') {
        return jsonError(405, 'method_not_allowed');
      }
      const boardId = decodeId(boardMatch[1]);
      // Malformed ids never touch the namespace (no object instantiated,
      // no RPC); unknown and malformed both answer the same 404.
      if (boardId === null || !isValidBoardId(boardId)) {
        return jsonError(404, 'not_found');
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const exists = await stub.exists();
      return exists
        ? new Response(JSON.stringify({ id: boardId }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : jsonError(404, 'not_found');
    }

    const match = ROOM_ROUTE.exec(url.pathname);
    if (match !== null) {
      const boardId = decodeId(match[1]);
      if (boardId === null || !isValidBoardId(boardId)) {
        return jsonError(404, 'not_found');
      }
      const upgrade = req.headers.get('Upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(req);
    }

    const hookResponse = await maybeHandleTestHook(req, env);
    if (hookResponse !== null) return hookResponse;
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };

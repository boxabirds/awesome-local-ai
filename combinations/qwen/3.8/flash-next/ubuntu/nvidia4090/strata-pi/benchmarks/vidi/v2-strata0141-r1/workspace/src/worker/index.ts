/**
 * Worker entry (anchors `sync.worker_entry`, `share.board_api`).
 *
 * Three jobs:
 *
 *   POST /api/boards                create a board: 201 {"id": "..."}
 *   GET  /api/boards/:boardId       does this board exist? 200 or 404
 *   GET  /api/rooms/:boardId  (Upgrade: websocket)  -> that board's BoardRoom
 *   everything else                 -> the static client
 *
 * Board existence is explicit from story 5 on (`share.not_found`): a bad or
 * unknown address is answered with 404 without touching a room, and connecting
 * to a board that has never been created no longer makes one.
 *
 * Boards stay separate (`live.isolation`) because `idFromName(boardId)` sends
 * every connection for a board to that board's own object, which holds only
 * that board's document and broadcasts only to its own sockets.
 *
 * More than MAX_CONCURRENT_EDITORS people are never refused
 * (`live.over_capacity`): neither the Worker nor the room counts participants.
 */

import { isValidBoardId } from '../shared/board-id';
import { BOARD_API_PREFIX, ROOM_ROUTE_PREFIX } from '../shared/config';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleTestHook, TEST_HOOK_PREFIX } from './test-hooks';

export interface Env {
  /** One BoardRoom instance per board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client (single-page application). */
  ASSETS: Fetcher;
  /**
   * `1` only on the `wrangler dev` command an e2e run starts. It is the single
   * switch for the storage test hooks (`src/worker/test-hooks.ts`) and it is
   * deliberately absent from `wrangler.jsonc`, so a deployed Worker has no hook
   * branch and serves the client build for those addresses.
   */
  TEST_HOOKS?: string;
}

// The route prefix is a named setting in shared config, imported rather than
// re-exported: the Worker entry may only export its handler and its Durable
// Object classes, because the runtime reads every export of this module.

const isWebSocketUpgrade = (req: Request): boolean =>
  (req.headers.get('upgrade') ?? '').toLowerCase() === 'websocket';

const json = (value: unknown, status: number): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * The board API: `POST /api/boards` and `GET /api/boards/:id`.
 *
 * Returns `null` when this request is not a board API request at all, so the
 * caller falls through to the room route and then to the client build.
 */
async function handleBoardApi(req: Request, path: string, env: Env): Promise<Response | null> {
  if (path !== BOARD_API_PREFIX && !path.startsWith(`${BOARD_API_PREFIX}/`)) {
    return null;
  }

  // No id: only creation lives here, and every other method is refused.
  if (path === BOARD_API_PREFIX) {
    if (req.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }
    const result = await createBoard(env);
    return result.ok
      ? json({ id: result.id }, 201)
      : json({ error: 'create_failed' }, 500);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const boardId = path.slice(BOARD_API_PREFIX.length + 1);
  // A malformed id is answered exactly like an unknown one: nothing is leaked
  // about what the id space looks like, and no room object is ever touched
  // (TC-07).
  if (!isValidBoardId(boardId)) {
    return json({ error: 'not_found' }, 404);
  }

  const namespace = env.BOARD_ROOM;
  const exists = await namespace.get(namespace.idFromName(boardId)).exists();
  return exists ? json({ id: boardId }, 200) : json({ error: 'not_found' }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;

    const boardApi = await handleBoardApi(req, path, env);
    if (boardApi !== null) {
      return boardApi;
    }

    if (path === '/api/rooms' || path.startsWith(ROOM_ROUTE_PREFIX)) {
      const boardId = path.slice(ROOM_ROUTE_PREFIX.length);
      // A bad address never reaches a room, so no object is ever created for it.
      // Story 5 made this a 404 rather than story 3's 400: a malformed address
      // and an unknown one are the same answer to a person following a link.
      if (!isValidBoardId(boardId)) {
        return new Response('Board not found', { status: 404 });
      }
      if (!isWebSocketUpgrade(req)) {
        return new Response('Upgrade Required', { status: 426 });
      }
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
    }

    // Test-only storage hooks (src/worker/test-hooks.ts). With `TEST_HOOKS`
    // unset `handleTestHook` returns `null` for every address, so a deployed
    // Worker serves the client build for these paths just as it does for any
    // other unknown one.
    if (path.startsWith(TEST_HOOK_PREFIX)) {
      const hooked = await handleTestHook(req, env);
      if (hooked !== null) {
        return hooked;
      }
    }

    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };

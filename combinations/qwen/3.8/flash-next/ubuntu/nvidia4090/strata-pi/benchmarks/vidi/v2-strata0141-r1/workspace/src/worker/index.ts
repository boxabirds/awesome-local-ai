/**
 * Worker entry (anchor `sync.worker_entry`).
 *
 * Two jobs and nothing else:
 *
 *   GET /api/rooms/:boardId  (Upgrade: websocket)  -> that board's BoardRoom
 *   everything else                                 -> the static client
 *
 * Boards stay separate (`live.isolation`) because `idFromName(boardId)` sends
 * every connection for a board to that board's own object, which holds only
 * that board's document and broadcasts only to its own sockets.
 *
 * More than MAX_CONCURRENT_EDITORS people are never refused
 * (`live.over_capacity`): neither the Worker nor the room counts participants.
 */

import { isValidBoardId } from '../shared/board-id';
import { ROOM_ROUTE_PREFIX } from '../shared/config';
import { BoardRoom } from './board-room';
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;

    if (path === '/api/rooms' || path.startsWith(ROOM_ROUTE_PREFIX)) {
      const boardId = path.slice(ROOM_ROUTE_PREFIX.length);
      // A bad address never reaches a room, so no object is ever created for it.
      if (!isValidBoardId(boardId)) {
        return new Response('Invalid board id', { status: 400 });
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

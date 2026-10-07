import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';

/**
 * Bindings configured in `wrangler.jsonc`: the room namespace (one Durable
 * Object per board) and the built client.
 */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

/** `/api/rooms/:boardId` — the one path the Worker handles itself. */
const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;

/**
 * Requests that are not a room connection are static assets, so `/`, `/b/<id>`
 * and every other client route fall through to the SPA fallback configured in
 * `wrangler.jsonc`.
 *
 * Boards stay separate (PRD live.isolation) because `idFromName(boardId)` routes
 * each board to its own object, which only knows its own sockets and its own
 * document.
 *
 * Nothing here counts participants, so the 6th person on a board is accepted
 * like anyone else (PRD live.over_capacity): `MAX_CONCURRENT_EDITORS` is a
 * design and test target, never enforced.
 */
async function routeRoom(request: Request, env: Env): Promise<Response | null> {
  const match = ROOM_PATH.exec(new URL(request.url).pathname);
  if (!match) return null;

  const boardId = decodeURIComponent(match[1]!);
  if (!isValidBoardId(boardId)) {
    return new Response('invalid board id', { status: 400 });
  }
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('expected a websocket connection', { status: 426 });
  }

  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return room.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await routeRoom(request, env)) ?? env.ASSETS.fetch(request);
  },
};

// The class lives in its own module; re-exported here so wrangler can find the
// `BoardRoom` named in `durable_objects.bindings`.
export { BoardRoom } from './board-room';

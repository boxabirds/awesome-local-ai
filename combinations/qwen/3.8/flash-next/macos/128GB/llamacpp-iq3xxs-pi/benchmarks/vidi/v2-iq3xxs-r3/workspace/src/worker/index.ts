/**
 * Worker entry (sync.worker_entry): the only network front door of the product.
 *
 * `/api/rooms/:boardId` is the WebSocket endpoint of one board; everything else
 * is the static client. The Worker itself keeps no state — no participant
 * counting, no connection limit — so a 6th or 60th person is accepted exactly
 * like the first (live.over_capacity).
 */
import { BoardRoom } from './board-room';
import { isValidBoardId } from '../shared/board-id';

/**
 * Bindings this Worker needs, i.e. what `wrangler.jsonc` gives it. Declared in
 * `env.d.ts` (as `Cloudflare.Env`) so `import { env } from 'cloudflare:test'`
 * in the integration tests is the same type.
 */
export interface Env extends Cloudflare.Env {}

/** `/api/rooms/<boardId>` — the whole path is the id, nothing after it. */
const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;

/**
 * True when the request asks for a WebSocket handshake. Compared
 * case-insensitively because headers are case-insensitive by contract.
 */
function wantsUpgrade(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

async function handleRooms(
  request: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  // A bad id never reaches the namespace, so no object is ever created for it.
  if (!isValidBoardId(boardId)) {
    return new Response('invalid board id', { status: 400 });
  }
  if (!wantsUpgrade(request)) {
    return new Response('expected a websocket upgrade', { status: 426 });
  }
  // idFromName(boardId) is what keeps boards separate (live.isolation): all
  // connections of one id land in that id's own object, and nowhere else.
  const roomId = env.BOARD_ROOM.idFromName(boardId);
  return env.BOARD_ROOM.get(roomId).fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const room = ROOM_PATH.exec(pathname);
    if (room !== null) return handleRooms(request, env, room[1] ?? '');
    return env.ASSETS.fetch(request);
  },
};

// The Durable Object class lives in its own module; exporting it here is how
// wrangler finds it.
export { BoardRoom };

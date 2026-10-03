// Worker entry: route WebSocket upgrades for a board to that board's BoardRoom
// Durable Object, and serve everything else from the static assets binding.
//
// Routing rules (sync.worker_entry contract):
//   GET /api/rooms/:boardId + Upgrade: websocket  -> that board's BoardRoom
//   GET /api/rooms/:boardId with a malformed id   -> 400 Bad Request
//   GET /api/rooms/:boardId without an upgrade    -> 426 Upgrade Required
//   anything else                                 -> env.ASSETS.fetch (SPA)
//
// Isolation (live.isolation): `idFromName(boardId)` gives every board its own
// BoardRoom instance, holding only that board's document and broadcasting only
// to its own sockets.
//
// Soft capacity (live.over_capacity): nothing here counts participants and there
// is no connection limit, so a 6th (or 60th) person is never refused.

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  /** This board's room: one Durable Object per board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served with an SPA fallback (see wrangler.jsonc). */
  ASSETS: Fetcher;
}

/** Everything under this prefix is a board room WebSocket endpoint. (Not exported:
 * a Worker module may only export handlers/classes, so it stays module-private.) */
const ROOM_ROUTE_PREFIX = '/api/rooms/';
const ROOM_ROUTE_ROOT = '/api/rooms';

/** The requested board id, '' for a room route with a missing/too-deep id, or
 * null when the path is not a room route at all (so the site root never matches). */
function boardIdFromPathname(pathname: string): string | null {
  if (pathname === ROOM_ROUTE_ROOT) return '';
  if (!pathname.startsWith(ROOM_ROUTE_PREFIX)) return null;
  const id = pathname.slice(ROOM_ROUTE_PREFIX.length);
  if (id.includes('/')) return '';
  try {
    return decodeURIComponent(id);
  } catch {
    return id; // malformed escape sequence: isValidBoardId rejects it
  }
}

/** True for an HTTP request asking to switch protocols to WebSocket. */
function isUpgradeToWebsocket(request: Request): boolean {
  const upgrade = request.headers.get('Upgrade');
  return upgrade !== null && upgrade.trim().toLowerCase() === 'websocket';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const boardId = boardIdFromPathname(url.pathname);
    if (boardId === null) return env.ASSETS.fetch(request);

    if (!isValidBoardId(boardId)) {
      // Never instantiate an object for a malformed or missing id.
      return new Response('Invalid board id', { status: 400 });
    }
    if (!isUpgradeToWebsocket(request)) {
      return new Response('Upgrade: websocket required', { status: 426 });
    }

    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return room.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// Re-exported so `wrangler.jsonc` can bind the class by name.
export { BoardRoom };

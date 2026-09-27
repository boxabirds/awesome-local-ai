/**
 * vidi6 entry Worker.
 *
 * Routes the live-board WebSocket endpoint `/api/rooms/:boardId` to the `BoardRoom`
 * Durable Object that owns that board, and serves everything else from the built
 * client (the single-page-application fallback comes from `assets.not_found_handling`).
 *
 * A board id that fails {@link isValidBoardId} is a client error (400) and never
 * touches a Durable Object, and a valid id without a WebSocket upgrade is answered
 * 426. `idFromName(boardId)` gives every board its own object, which is what keeps
 * boards isolated; there is deliberately no participant-count check — the capacity
 * setting is soft, so an over-capacity joiner is never refused.
 */
import { isValidBoardId } from '../shared/board-id.js';
import { BoardRoom } from './board-room.js';

export { BoardRoom };

export interface Env {
  /** The per-board room object namespace (`durable_objects.bindings: BOARD_ROOM`). */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client (`assets.binding: ASSETS`). */
  ASSETS: Fetcher;
}

/** The path prefix of the live-board WebSocket endpoint. */
const ROOM_PREFIX = '/api/rooms/';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(ROOM_PREFIX)) {
      const boardId = decodeURIComponent(url.pathname.slice(ROOM_PREFIX.length));
      if (!isValidBoardId(boardId)) {
        return new Response('Invalid board id', { status: 400 });
      }
      const upgrade = request.headers.get('Upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }
      // One object per board id isolates boards and, with no count check, never
      // refuses an over-capacity joiner.
      const id = env.BOARD_ROOM.idFromName(boardId);
      return env.BOARD_ROOM.get(id).fetch(request);
    }
    // Every other path is the client, served from static assets with the
    // single-page-application fallback configured in wrangler.jsonc.
    return env.ASSETS.fetch(request);
  },
} satisfies { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> };

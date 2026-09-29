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
  /**
   * When exactly `'1'`, the room exposes a test-only storage corrupt/repair endpoint. The
   * production and default dev config never set it, so the route is inert in every real run.
   */
  TEST_HOOKS?: string;
}

/** The path prefix of the live-board WebSocket endpoint. */
const ROOM_PREFIX = '/api/rooms/';

/** The path prefix of the TEST-ONLY board storage control endpoint. */
const TEST_PREFIX = '/__test/board/';

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
    // TEST-ONLY (gated on env.TEST_HOOKS === '1'): drive a board's storage into a genuine
    // load failure and back, so a black-box e2e can prove the honest load-failure badge.
    if (String(env.TEST_HOOKS) === '1' && url.pathname.startsWith(TEST_PREFIX)) {
      const rest = decodeURIComponent(url.pathname.slice(TEST_PREFIX.length));
      const slash = rest.indexOf('/');
      const boardId = slash === -1 ? rest : rest.slice(0, slash);
      const op = slash === -1 ? '' : rest.slice(slash + 1);
      if (!isValidBoardId(boardId)) return new Response('Invalid board id', { status: 400 });
      if (op !== 'corrupt' && op !== 'repair') return new Response('Not found', { status: 404 });
      const id = env.BOARD_ROOM.idFromName(boardId);
      return env.BOARD_ROOM
        .get(id)
        .fetch(new Request(`https://do.internal/__test/${op}`, { method: 'POST' }));
    }
    // Every other path is the client, served from static assets with the
    // single-page-application fallback configured in wrangler.jsonc.
    return env.ASSETS.fetch(request);
  },
} satisfies { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> };

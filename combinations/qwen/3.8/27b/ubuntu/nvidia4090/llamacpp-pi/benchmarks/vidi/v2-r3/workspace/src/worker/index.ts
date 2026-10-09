import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { testHookRequest } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** '1' enables the /__test hook routes (test wrangler processes only). */
  TEST_HOOKS?: string;
}

export { BoardRoom };

const ROOMS_PREFIX = '/api/rooms/';
const BOARDS_API = '/api/boards';

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Story 5 (share.board_api): POST /api/boards creates a board (201 {id});
 * GET /api/boards/:id answers the page's existence check (200 {id} or
 * 404 {error:'not_found'}). Any other shape or method is a 404/405 —
 * nothing here ever materializes storage for a nonexistent board.
 */
async function boardsApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.slice(BOARDS_API.length).replace(/^\/+/, '');
  if (path === '') {
    if (req.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }
    const result = await createBoard(env);
    return result.ok
      ? json({ id: result.id }, 201)
      : json({ error: result.reason }, 500);
  }
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  const id = decodeURIComponent(path);
  if (!isValidBoardId(id)) {
    return json({ error: 'not_found' }, 404);
  }
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  const exists = await room.exists();
  return exists ? json({ id }, 200) : json({ error: 'not_found' }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (env.TEST_HOOKS === '1' && url.pathname.startsWith('/__test/')) {
      return testHookRequest(req, env, url.pathname);
    }
    if (url.pathname.startsWith(BOARDS_API) && (url.pathname === BOARDS_API || url.pathname.startsWith(BOARDS_API + '/'))) {
      return boardsApi(req, env, url);
    }
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = decodeURIComponent(url.pathname.slice(ROOMS_PREFIX.length));
      if (!isValidBoardId(boardId)) {
        // Story 5: malformed ids are no longer distinguishable from unknown
        // ones — both are 404 (and neither upgrades a room).
        return new Response('Not Found', { status: 404 });
      }
      const upgrade = req.headers.get('Upgrade');
      if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      // One BoardRoom object per board id: boards stay separate.
      // No participant counting: the 6th+ joiner is never refused (soft capacity).
      const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return room.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

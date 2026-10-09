import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleServe, handleUpload } from './assets';
import { testHookRequest } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Story 12: board image assets. */
  ASSETS_BUCKET: R2Bucket;
  /** '1' enables the /__test hook routes (test wrangler processes only). */
  TEST_HOOKS?: string;
}

export { BoardRoom };

const ROOMS_PREFIX = '/api/rooms/';
const BOARDS_API = '/api/boards';
const ASSETS_API = '/api/assets';

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
  const segments = path.split('/');
  // Story 12: POST /api/boards/:id/assets — upload one image for the board.
  if (segments.length === 2 && segments[1] === 'assets') {
    if (req.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }
    const id = decodeURIComponent(segments[0]);
    if (!isValidBoardId(id)) {
      return json({ error: 'not_found' }, 404);
    }
    return handleUpload(req, env, id);
  }
  if (segments.length !== 1) {
    return json({ error: 'not_found' }, 404);
  }
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  const id = decodeURIComponent(segments[0]);
  if (!isValidBoardId(id)) {
    return json({ error: 'not_found' }, 404);
  }
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  const exists = await room.exists();
  return exists ? json({ id }, 200) : json({ error: 'not_found' }, 404);
}

/**
 * Story 12 (image.serve): GET /api/assets/:boardId/:assetId serves a stored
 * image with immutable caching. Any other method is 405; malformed or
 * unknown keys are 404 (the worker never lists or creates here).
 *
 * `rawPath` is the request path exactly as sent (no WHATWG-URL dot-segment
 * normalization): '../' and '%2E%2E' reach this check and fail the id
 * patterns, so a traversal can never be resolved against the bucket.
 */
async function assetsApi(req: Request, env: Env, rawPath: string): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  const segments = rawPath.slice(ASSETS_API.length).split('/').filter(Boolean);
  if (segments.length !== 2) {
    return json({ error: 'not_found' }, 404);
  }
  let boardId: string;
  let assetId: string;
  try {
    boardId = decodeURIComponent(segments[0]);
    assetId = decodeURIComponent(segments[1]);
  } catch {
    return json({ error: 'not_found' }, 404);
  }
  if (!isValidBoardId(boardId) || !/^[A-Za-z0-9_-]{22}$/.test(assetId)) {
    return json({ error: 'not_found' }, 404);
  }
  return handleServe(env, boardId, assetId);
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
    // The assets route is matched on the raw request path (see assetsApi):
    // a normalized URL would silently resolve '../' segments before the
    // id patterns could reject them.
    const rawPath = (() => {
      const idx = req.url.indexOf('/', 8); // after the scheme://host part
      return idx === -1 ? '/' : req.url.slice(idx);
    })();
    if (rawPath === ASSETS_API || rawPath.startsWith(ASSETS_API + '/')) {
      return assetsApi(req, env, rawPath);
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

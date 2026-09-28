// Worker entry (stories 3 and 5): routes /api/rooms/:boardId to the board's
// BoardRoom Durable Object, serves the board creation/existence API on
// /api/boards, and everything else to the static assets. Each board id maps
// to its own object instance, which is what isolates boards (PRD
// live.isolation). There is deliberately no connection limit check: the
// capacity is soft (MAX_CONCURRENT_EDITORS) and over-capacity joiners are
// never refused (PRD live.over_capacity).
//
// Story 5 (share.board_api):
// - POST /api/boards creates a board server-side (128-bit id, Durable
//   Object initialised via RPC behind the BOARD_CREATE_LIMITER rate limit).
// - GET /api/boards/:id answers the board page's existence check.
// - Unknown boards are rejected with 404 on BOTH routes; malformed ids are
//   rejected before the namespace is ever touched, so probing links leaves
//   no storage behind (share.not_found).

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { handleServe, handleUpload } from './assets';
import { createBoard } from './create-board';
import { testHookRoute } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Story 12 (assets.api): R2 bucket for board images. */
  ASSETS_BUCKET: R2Bucket;
  /** Platform rate limiter for board creation (wrangler.jsonc ratelimits).
   *  Absent in local runtimes without ratelimit support; createBoard then
   *  uses its in-memory stand-in (same limit and period). */
  BOARD_CREATE_LIMITER?: RateLimit;
  /** Story 12 (image.rate_limit): platform rate limiter for image uploads;
   *  absent in local runtimes, where assets.ts uses its stand-in. */
  ASSET_UPLOAD_LIMITER?: RateLimit;
  /** '1' only in the e2e dev env file (tests/e2e/helpers); enables
   *  /_test/ hooks. Production config never sets it. */
  TEST_HOOKS?: string;
}

const ROOMS_PREFIX = '/api/rooms/';
const BOARDS_PATH = '/api/boards';
const BOARDS_PREFIX = '/api/boards/';
const ASSETS_UPLOAD_SUFFIX = '/assets';
const ASSETS_SERVE_PREFIX = '/api/assets/';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length);
      // Malformed ids get 404 like unknown ids (story 5 contract: no
      // distinction, nothing leaked) and never instantiate an object.
      if (!isValidBoardId(boardId)) {
        return json(404, { error: 'not_found' });
      }
      if (!req.headers.get('Upgrade')?.toLowerCase().includes('websocket')) {
        return Promise.resolve(new Response('Upgrade Required', { status: 426 }));
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      return env.BOARD_ROOM.get(id).fetch(req);
    }
    if (url.pathname === BOARDS_PATH) {
      if (req.method !== 'POST') {
        return json(405, { error: 'method_not_allowed' });
      }
      // The visitor key is the edge-provided IP; absent locally (empty key),
      // which keeps the limiter per-browser-session in dev.
      const visitorKey = req.headers.get('CF-Connecting-IP') ?? '';
      const result = await createBoard(env, visitorKey);
      if (result.ok) return json(201, { id: result.id });
      if (result.reason === 'rate_limited') return json(429, { error: 'rate_limited' });
      return json(500, { error: 'create_failed' });
    }
    // Story 12 (assets.api): POST /api/boards/:boardId/assets uploads one
    // image (board must exist; sniffed type; 10 MB; per-IP rate limit).
    // Checked before the plain /api/boards/:id branch, which is GET-only.
    if (
      req.method === 'POST' &&
      url.pathname.startsWith(BOARDS_PREFIX) &&
      url.pathname.endsWith(ASSETS_UPLOAD_SUFFIX)
    ) {
      const boardId = url.pathname.slice(BOARDS_PREFIX.length, -ASSETS_UPLOAD_SUFFIX.length);
      return handleUpload(req, env, boardId);
    }
    // Story 12 (assets.api): GET /api/assets/:boardId/:assetId serves a
    // stored image (immutable, nosniff, null CSP).
    if (url.pathname.startsWith(ASSETS_SERVE_PREFIX)) {
      if (req.method !== 'GET') {
        return json(405, { error: 'method_not_allowed' });
      }
      const key = decodeURIComponent(url.pathname.slice(ASSETS_SERVE_PREFIX.length));
      return handleServe(env, key);
    }
    if (url.pathname.startsWith(BOARDS_PREFIX)) {
      if (req.method !== 'GET') {
        return json(405, { error: 'method_not_allowed' });
      }
      const boardId = url.pathname.slice(BOARDS_PREFIX.length);
      if (!isValidBoardId(boardId)) {
        return json(404, { error: 'not_found' });
      }
      const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
      return exists ? json(200, { id: boardId }) : json(404, { error: 'not_found' });
    }
    if (env.TEST_HOOKS === '1') {
      // Story 4/5 e2e hooks; 404 in production.
      const parts = url.pathname.split('/').filter(Boolean);
      const boardId = parts[1] ?? '';
      if (isValidBoardId(boardId)) {
        const room = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
        return testHookRoute(req, room);
      }
    }
    return Promise.resolve(env.ASSETS.fetch(req));
  },
};

export { BoardRoom };

/**
 * Worker entry: routes /api/boards/:id/assets to image storage, /api/assets/* to
 * the stored images, /api/boards for creation and existence checks,
 * /api/rooms/:boardId to the BoardRoom Durable Object,
 * everything else to static assets.
 */
import { isValidBoardId } from '../shared/board-id';
import { matchTestHook } from './test-hooks';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { assetKeyFromUrl, handleServe, handleUpload } from './assets';

export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Uploaded images (story 12), keyed `<boardId>/<assetId>`. */
  ASSETS_BUCKET: R2Bucket;
  BOARD_CREATE_LIMITER: RateLimiter;
  /** Separate budget for image uploads: one drop can be 20 files. */
  ASSET_UPLOAD_LIMITER: RateLimiter;
  /**
   * Set to '1' by the e2e wrangler process only (`--var TEST_HOOKS:1`). Enables
   * the /__test/boards/:id/* storage hooks; never set in wrangler.jsonc.
   */
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Test-only storage hooks, forwarded to the board's Durable Object.
    if (env.TEST_HOOKS === '1') {
      const route = matchTestHook(url.pathname, url.searchParams);
      if (route !== null && isValidBoardId(route.boardId)) {
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(route.boardId));
        return stub.fetch(req);
      }
    }

    // `POST /api/boards/:boardId/assets` — upload one image for an existing
    // board. Matched before the boards API so that API keeps one job.
    const uploadMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/assets$/);
    if (uploadMatch !== null) {
      if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleUpload(req, env, decodeBoardSegment(uploadMatch[1]));
    }

    // `GET /api/assets/:boardId/:assetId` — serve a stored image. Checked before
    // the ASSETS fallback, which would answer these with the SPA shell.
    if (url.pathname.startsWith('/api/assets/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 });
      }
      const assetKey = assetKeyFromUrl(url.pathname);
      if (assetKey === null) return new Response('Not found', { status: 404 });
      return handleServe(env, assetKey);
    }

    // Board creation and existence API
    if (url.pathname === '/api/boards' || url.pathname.startsWith('/api/boards/')) {
      return handleBoardsApi(req, env, url);
    }

    // Route WebSocket upgrade to Durable Object
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);

      // Strip any trailing path segments (e.g. /api/rooms/id/ws)
      const idPart = boardId.split('/')[0];

      if (!isValidBoardId(idPart)) {
        return new Response('Not found', { status: 404 });
      }

      const upgradeHeader = req.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      const doId = env.BOARD_ROOM.idFromName(idPart);
      const stub = env.BOARD_ROOM.get(doId);

      // Check existence before forwarding
      const exists = await stub.exists();
      if (!exists) {
        return new Response('Not found', { status: 404 });
      }

      return stub.fetch(req);
    }

    // Everything else: serve static assets (SPA fallback)
    return env.ASSETS.fetch(req);
  },
};

async function handleBoardsApi(req: Request, env: Env, url: URL): Promise<Response> {
  // POST /api/boards — create a new board
  if (req.method === 'POST' && url.pathname === '/api/boards') {
    const visitorKey = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const result = await createBoard(env, visitorKey);
    if (result.ok) {
      return Response.json({ id: result.id }, { status: 201 });
    }
    if (result.reason === 'rate_limited') {
      return Response.json({ error: 'rate_limited' }, { status: 429 });
    }
    return Response.json({ error: 'create_failed' }, { status: 500 });
  }

  // GET /api/boards/:id — check existence
  if (req.method === 'GET' && url.pathname.startsWith('/api/boards/')) {
    const id = url.pathname.slice('/api/boards/'.length).split('/')[0];
    if (!isValidBoardId(id)) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const doId = env.BOARD_ROOM.idFromName(id);
    const stub = env.BOARD_ROOM.get(doId);
    const exists = await stub.exists();
    if (!exists) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    return Response.json({ id }, { status: 200 });
  }

  // Any other method on /api/boards → 405
  return new Response('Method not allowed', { status: 405 });
}

/** Percent-decode a path segment; a malformed escape is simply an unknown id. */
function decodeBoardSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export { BoardRoom };

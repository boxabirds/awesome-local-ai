/**
 * Worker entry (story 5).
 *
 * Routes:
 *   POST /api/boards          → create a new board (rate-limited, collision-retried)
 *   GET  /api/boards/:id      → check if a board exists (404 for unknown/malformed)
 *   /api/rooms/:boardId       → WebSocket (404 for unknown/malformed, 426 without upgrade)
 *   everything else           → static client build (SPA fallback)
 *
 * Ids are validated with isValidBoardId before touching the namespace, so
 * malformed ids never instantiate a Durable Object (TC-07).
 */
import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard, type Limiter } from './create-board';
import { handleTestHook } from './test-hooks';
import { handleUpload, handleServe } from './assets';

/** No-op limiter used when the real binding is absent (tests, local dev). */
const NOOP_LIMITER: Limiter = {
  async checkAndConsume(): Promise<boolean> {
    return true;
  },
};

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * Rate limiter for board creation (share.rate_limit).
   * Present in production (wrangler.jsonc ratelimits binding); absent in
   * the vitest pool (no local rate limiter support) — the worker falls
   * back to a no-op limiter.
   */
  BOARD_CREATE_LIMITER?: Limiter;
  /**
   * R2 bucket for image assets (story 12).
   * Present in production and the vitest pool (wrangler r2_buckets binding).
   */
  ASSETS_BUCKET: R2Bucket;
  /**
   * Rate limiter for image uploads (story 12).
   * Present in production; absent in the vitest pool — the worker falls
   * back to a no-op limiter.
   */
  ASSET_UPLOAD_LIMITER?: {
    limit(opts: { key: string }): Promise<{ success: boolean }>;
  };
  /** Test hooks are enabled only when this is exactly '1' (the e2e env). */
  TEST_HOOKS?: string;
}

/** Resolve the rate limiter, falling back to a no-op when absent. */
function getLimiter(env: Env): Limiter {
  return env.BOARD_CREATE_LIMITER ?? NOOP_LIMITER;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const hookResponse = await handleTestHook(req, url, env);
    if (hookResponse !== null) return hookResponse;

    // --- POST /api/boards: create a new board --------------------------------
    if (url.pathname === '/api/boards') {
      if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const visitorKey = req.headers.get('cf-connecting-ip') ?? 'unknown';
      const result = await createBoard(
        { ...env, BOARD_CREATE_LIMITER: getLimiter(env) },
        visitorKey,
      );
      if (result.ok) {
        return Response.json({ id: result.id }, { status: 201 });
      }
      if (result.reason === 'rate_limited') {
        return Response.json({ error: 'rate_limited' }, { status: 429 });
      }
      return Response.json({ error: 'create_failed' }, { status: 500 });
    }

    // --- GET /api/boards/:id: check if a board exists -------------------------
    const boardMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
    if (boardMatch !== null) {
      if (req.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const boardId = boardMatch[1];
      // Malformed ids get 404 without touching the namespace (TC-07).
      if (!isValidBoardId(boardId)) {
        return Response.json({ error: 'not_found' }, { status: 404 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const exists = await stub.exists();
      if (exists) {
        return Response.json({ id: boardId });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    // --- POST /api/boards/:boardId/assets: upload an image (story 12) ---------
    const assetUploadMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/assets$/);
    if (assetUploadMatch !== null) {
      if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const boardId = assetUploadMatch[1];
      const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
      return handleUpload(req, env, boardId, ip);
    }

    // --- GET /api/assets/:boardId/:assetId: serve an image (story 12) --------
    const assetServeMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/([^/]+)$/);
    if (assetServeMatch !== null) {
      if (req.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const key = `${assetServeMatch[1]}/${assetServeMatch[2]}`;
      return handleServe(env, key);
    }

    // --- /api/rooms/:boardId: WebSocket ---------------------------------------
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomMatch !== null) {
      const boardId = roomMatch[1];
      // Story 5: malformed ids get 404 (was 400 in story 3).
      if (!isValidBoardId(boardId)) {
        return new Response('Not Found', { status: 404 });
      }
      const upgrade = req.headers.get('upgrade');
      if (upgrade === null || !upgrade.toLowerCase().includes('websocket')) {
        return new Response('Upgrade Required', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(req);
    }

    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };

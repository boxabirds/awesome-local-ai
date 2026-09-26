import { BoardRoom } from './board-room';
import { createBoard, type CreateOpts } from './create-board';
import { handleUpload, handleServe } from './assets';
import { isValidBoardId } from '@/shared/board-id';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
  /**
   * Story 5: the platform rate-limit binding (declared in wrangler.jsonc as
   * the `ratelimits` entry BOARD_CREATE_LIMITER). Present in production; the
   * pinned local workerd runtime does not expose it, in which case
   * createBoard falls back to an in-memory fixed-window limiter.
   */
  BOARD_CREATE_LIMITER?: {
    limit(opts: { key: string; limit?: number; periodSeconds?: number }): Promise<{ success: boolean }>;
  };
  /**
   * Story 12: R2 bucket for board image assets (declared in wrangler.jsonc as
   * the `r2_buckets` entry ASSETS_BUCKET). Bound to a real Miniflare bucket in
   * local dev and a real Cloudflare R2 bucket in production.
   */
  ASSETS_BUCKET: R2Bucket;
  /**
   * Story 12: platform rate-limit binding for asset uploads (wrangler.jsonc
   * `ratelimits` entry ASSET_UPLOAD_LIMITER). Present in production; absent
   * locally, in which case assets.ts falls back to an in-memory limiter.
   */
  ASSET_UPLOAD_LIMITER?: {
    limit(opts: { key: string; limit?: number; periodSeconds?: number }): Promise<{ success: boolean }>;
  };
}

/** A JSON response helper. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The visitor's rate-limit key. In production this is the Cloudflare
 * connecting IP. On TEST_HOOKS dev servers the x-test-visitor header may
 * override it, so tests can pin or vary the key deterministically.
 */
function visitorKeyFor(env: Env, request: Request): string {
  if (env.TEST_HOOKS === '1') {
    const override = request.headers.get('x-test-visitor');
    if (override) return override;
  }
  const ip = request.cf?.connectingIP;
  return typeof ip === 'string' && ip.length > 0 ? ip : 'unknown';
}

/** Test-only creation injections (honoured only on TEST_HOOKS dev servers). */
function testCreateOpts(env: Env, request: Request): CreateOpts {
  if (env.TEST_HOOKS !== '1') return {};
  const opts: CreateOpts = {};
  const ids = request.headers.get('x-test-create-ids');
  if (ids) opts.testIds = ids.split(',').filter((s) => s.length > 0);
  if (request.headers.get('x-test-fail-initialize') === '1') opts.failInitialize = true;
  return opts;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Test hooks (only enabled on dev servers via --var TEST_HOOKS:1).
    if (env.TEST_HOOKS === '1') {
      const hook = url.pathname.match(/^\/__test\/boards\/([^/]+)\/([a-z-]+)$/);
      if (hook) {
        const boardId = hook[1];
        if (!isValidBoardId(boardId)) return new Response('Invalid board id', { status: 400 });
        return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
      }
    }

    // Story 5: board creation and existence.
    if (url.pathname === '/api/boards') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const result = await createBoard(env, visitorKeyFor(env, request), testCreateOpts(env, request));
      if (result.ok) return json({ id: result.id }, 201);
      return json({ error: result.reason }, result.reason === 'rate_limited' ? 429 : 500);
    }
    // Story 12: image asset upload for an existing board.
    const assetUploadPath = url.pathname.match(/^\/api\/boards\/([^/]+)\/assets$/);
    if (assetUploadPath) {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const boardId = assetUploadPath[1];
      if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);
      return handleUpload(request, env, boardId);
    }
    // Story 12: serving a stored image asset (immutable). The key is the FULL
    // remainder of the path (a valid key is exactly `<boardId>/<assetId>`); it
    // is validated against ASSET_KEY_PATTERN inside handleServe, which also
    // rejects traversal/malformed keys with 404. Capturing the remainder (not
    // two fixed segments) keeps odd paths (e.g. `..%2Fx`) from bypassing the
    // check or leaking to the SPA fallback.
    const assetServePath = url.pathname.match(/^\/api\/assets\/(.+)$/);
    if (assetServePath) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      return handleServe(env, assetServePath[1]);
    }

    const boardPath = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
    if (boardPath) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const boardId = boardPath[1];
      // Invalid ids never reach the namespace: no Durable Object is
      // instantiated and no storage is created (share.invalid_links).
      if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const exists = await stub.exists();
      return exists ? json({ id: boardId }, 200) : json({ error: 'not_found' }, 404);
    }

    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (match) {
      const boardId = match[1];
      // Story 5: invalid ids answer 404 (was 400) and never instantiate a DO.
      if (!isValidBoardId(boardId)) return new Response('Board not found', { status: 404 });
      const isUpgrade = (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
      if (!isUpgrade) return new Response('Upgrade required', { status: 426 });
      // WebSocket upgrade: hand the request to the board's Durable Object.
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }

    // Static assets (the client SPA).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { BoardRoom };

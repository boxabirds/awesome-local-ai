import { newBoardId } from '@/shared/board-id';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '@/shared/image-format';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
  IMAGE_UPLOAD_LIMIT,
  IMAGE_UPLOAD_PERIOD_SECONDS,
} from '@/shared/config';
import type { Env } from './index';

/**
 * Story 12 — image asset storage and serving (assets.api, assets.serve).
 *
 *  - `handleUpload` stores one image for an EXISTING board at an unguessable
 *    key `<boardId>/<assetId>` (assetId = newBoardId(); keys NEVER change, so
 *    serving is immutable). The MIME type comes from CONTENT sniffing
 *    (sniffImageType on the first bytes) — the client's Content-Type header is
 *    ignored. Checks run in the design order: rate limit → exists() RPC →
 *    size → sniff → put. NOTHING is written on any error path.
 *  - `handleServe` serves a stored object with `nosniff` + `CSP default-src
 *    'none'` + immutable long caching. A malformed key or a missing object
 *    both return 404 (the client then shows "Image unavailable").
 *
 * Mock vs real: the R2 bucket and the exists() RPC are REAL (Miniflare local
 * dev / production). The rate limiter is the real `ASSET_UPLOAD_LIMITER`
 * platform binding when the runtime exposes it; the pinned local workerd does
 * not expose ratelimits bindings, so local dev and the test suite run against
 * an in-memory fixed-window limiter with the same `limit({key})` interface.
 */

/** A small JSON response helper. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The visitor's rate-limit key: CF-Connecting-IP, or an `x-test-visitor`
 * override when the server runs with TEST_HOOKS=1 (same convention as
 * story 5's board-creation limiter).
 */
function assetVisitorKey(env: Env, request: Request): string {
  if (env.TEST_HOOKS === '1') {
    const override = request.headers.get('x-test-visitor');
    if (override) return override;
  }
  const ip = request.cf?.connectingIP;
  return typeof ip === 'string' && ip.length > 0 ? ip : 'unknown';
}

/**
 * In-memory fixed-window limiter with the same `limit({key})` interface as
 * the platform `ratelimits` binding. Used when the local runtime does not
 * expose the binding (see the module doc).
 */
function createMemoryLimiter(limit: number, periodSeconds: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    limit({ key }: { key: string; limit?: number; periodSeconds?: number }): Promise<{ success: boolean }> {
      const windowMs = periodSeconds * 1000;
      const now = Date.now();
      const w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return Promise.resolve({ success: true });
      }
      if (w.count >= limit) return Promise.resolve({ success: false });
      w.count += 1;
      return Promise.resolve({ success: true });
    },
  };
}

const memoryAssetLimiter = createMemoryLimiter(IMAGE_UPLOAD_LIMIT, IMAGE_UPLOAD_PERIOD_SECONDS);

interface LimiterLike {
  limit(opts: { key: string; limit?: number; periodSeconds?: number }): Promise<{ success: boolean }>;
}

function assetLimiterFor(env: Env): LimiterLike {
  return (env as { ASSET_UPLOAD_LIMITER?: LimiterLike }).ASSET_UPLOAD_LIMITER ?? memoryAssetLimiter;
}

/**
 * POST /api/boards/:boardId/assets — upload one image asset for `boardId`.
 * Returns 201 `{ assetKey, contentType }` on success, else 404/413/415/429/500
 * per the design (nothing is written on any error path).
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Rate limit (image.rate_limit) by visitor key.
  const { success } = await assetLimiterFor(env).limit({
    key: assetVisitorKey(env, req),
    limit: IMAGE_UPLOAD_LIMIT,
    periodSeconds: IMAGE_UPLOAD_PERIOD_SECONDS,
  });
  if (!success) return json({ error: 'rate_limited' }, 429);

  // 2. The board must exist (image constraint: only boards that exist receive
  //    uploads). Real exists() RPC through the story 5 board room.
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) return json({ error: 'not_found' }, 404);

  // 3. Size (image.size_limit): Content-Length first, then the actual bytes.
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);

  // 4. Type from CONTENT only (image.types) — never the client Content-Type.
  const contentType = sniffImageType(bytes.slice(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return json({ error: 'unsupported_type' }, 415);

  // 5. Store (unguessable, immutable key). A storage failure is surfaced as
  //    500 so the uploader can retry (image.upload_failure).
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    // Test hook (TEST_HOOKS servers only): force a storage failure for TC-15.
    if (env.TEST_HOOKS === '1' && req.headers.get('x-test-fail-asset-put') === '1') {
      throw new Error('injected asset put failure (test hook)');
    }
    await env.ASSETS_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
  } catch {
    return json({ error: 'storage_failure' }, 500);
  }

  return json({ assetKey: key, contentType }, 201);
}

/**
 * GET /api/assets/:boardId/:assetId — serve a stored image. 200 with
 * `nosniff` + CSP + immutable caching, or 404 for a malformed key / missing
 * object (image.unavailable).
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return new Response('Not found', { status: 404 });
  const obj = await env.ASSETS_BUCKET.get(key);
  if (obj === null) return new Response('Not found', { status: 404 });
  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';
  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}

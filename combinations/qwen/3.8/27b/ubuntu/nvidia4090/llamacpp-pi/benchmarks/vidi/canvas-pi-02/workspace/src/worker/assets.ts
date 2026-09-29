/**
 * Asset upload and serve handlers (story 12, assets.api).
 *
 * `handleUpload`:
 *  1. Validate boardId pattern → 404
 *  2. Rate limit by CF-Connecting-IP → 429
 *  3. exists() RPC → 404
 *  4. Content-Length > IMAGE_MAX_BYTES → 413
 *  5. Read body; byte length > IMAGE_MAX_BYTES → 413
 *  6. sniffImageType (content only) → 415 for anything not accepted
 *  7. R2 put → 201 or 500 on failure
 *
 * `handleServe`:
 *  1. ASSET_KEY_PATTERN → 404
 *  2. R2 get → 404 if missing
 *  3. 200 with immutable caching, nosniff, CSP
 */

import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_UPLOAD_LIMIT,
  IMAGE_UPLOAD_PERIOD_SECONDS,
} from '../shared/config';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import type { BoardRoom } from './board-room';

/** Minimal limiter interface (same shape as Cloudflare's rate limit binding). */
export interface AssetLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** No-op limiter for when the binding is absent (vitest pool). */
const NOOP_ASSET_LIMITER: AssetLimiter = {
  async limit(): Promise<{ success: boolean }> { return { success: true }; },
};

export interface AssetEnv {
  ASSETS_BUCKET: R2Bucket;
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSET_UPLOAD_LIMITER?: AssetLimiter;
}

function getAssetLimiter(env: AssetEnv): AssetLimiter {
  return env.ASSET_UPLOAD_LIMITER ?? NOOP_ASSET_LIMITER;
}

/**
 * POST /api/boards/:boardId/assets handler.
 *
 * @param req - the raw request (body is the image bytes)
 * @param env - worker env with R2 bucket and DO namespace
 * @param boardId - the board id from the URL
 * @param ip - the CF-Connecting-IP (or 'unknown')
 */
export async function handleUpload(
  req: Request,
  env: AssetEnv,
  boardId: string,
  ip: string,
): Promise<Response> {
  // 1. Validate boardId pattern (before any other work).
  if (!isValidBoardId(boardId)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // 2. Rate limit.
  const limiter = getAssetLimiter(env);
  const limitResult = await limiter.limit({ key: ip });
  if (!limitResult.success) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  // 3. Board existence check.
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // 4. Content-Length check (fast path; avoids reading a huge body).
  const contentLength = req.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > IMAGE_MAX_BYTES) {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }

  // 5. Read the body.
  const bodyBytes = new Uint8Array(await req.arrayBuffer());
  if (bodyBytes.length > IMAGE_MAX_BYTES) {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }

  // 6. Sniff the type from content (never trust the client header).
  const head = bodyBytes.subarray(0, Math.min(IMAGE_SNIFF_BYTES, bodyBytes.length));
  const contentType = sniffImageType(head);
  if (contentType === null) {
    return Response.json({ error: 'unsupported_type' }, { status: 415 });
  }

  // 7. Store in R2.
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await env.ASSETS_BUCKET.put(key, bodyBytes, {
      httpMetadata: { contentType },
    });
  } catch {
    return Response.json({ error: 'storage_failed' }, { status: 500 });
  }

  return Response.json({ assetKey: key, contentType }, { status: 201 });
}

/**
 * GET /api/assets/:boardId/:assetId handler.
 *
 * Serves the stored image bytes with immutable caching, nosniff, and
 * a restrictive CSP so the file can never execute.
 */
export async function handleServe(env: AssetEnv, key: string): Promise<Response> {
  // Validate the key pattern (rejects traversal, malformed ids).
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  const obj = await env.ASSETS_BUCKET.get(key);
  if (obj === null) {
    return new Response('Not Found', { status: 404 });
  }

  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';
  const body = await obj.arrayBuffer();

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

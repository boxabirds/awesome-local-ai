import { isValidBoardId, newBoardId } from '../shared/board-id';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_SNIFF_BYTES } from '../shared/config';
import type { Env } from './index';

export interface Limiter {
  limit({ key }: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Handle POST /api/boards/:boardId/assets
 * Upload an image file to R2.
 */
export async function handleUpload(
  req: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  // 1. Validate board id
  if (!isValidBoardId(boardId)) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Rate limit by CF-Connecting-IP
  const visitorKey = req.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const limiter = env.ASSET_UPLOAD_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: visitorKey });
    if (!success) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // 3. Check board exists via BoardRoom RPC
  const doId = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(doId) as unknown as { exists(): Promise<boolean> };
  const exists = await stub.exists();
  if (!exists) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 4. Check Content-Length header
  const contentLength = req.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 5. Read body
  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch {
    return new Response(JSON.stringify({ error: 'read_failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 6. Check actual byte length
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 7. Sniff content type from first IMAGE_SNIFF_BYTES
  const head = new Uint8Array(body, 0, Math.min(body.byteLength, IMAGE_SNIFF_BYTES));
  const contentType = sniffImageType(head);
  if (!contentType) {
    return new Response(JSON.stringify({ error: 'unsupported_type' }), {
      status: 415,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 8. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);

  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'storage_failure' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ assetKey: key, contentType }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle GET /api/assets/:boardId/:assetId
 * Serve an image from R2 with immutable caching and security headers.
 */
export async function handleServe(
  env: Env,
  key: string,
): Promise<Response> {
  // Validate key pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response(null, { status: 404 });
  }

  // Get from R2
  const obj = await env.ASSETS_BUCKET.get(key);
  if (!obj) {
    return new Response(null, { status: 404 });
  }

  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

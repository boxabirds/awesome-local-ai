import type { Env } from './env';
import { isValidBoardId, newBoardId } from '@shared/board-id';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '@shared/config';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '@shared/image-format';

export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

class MemoryRateLimiter implements Limiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async limit(opts: { key: string }): Promise<{ success: boolean }> {
    const now = Date.now();
    const bucket = this.buckets.get(opts.key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(opts.key, { count: 1, resetAt: now + 60_000 });
      return { success: true };
    }
    bucket.count++;
    return { success: bucket.count <= 60 };
  }
}

let fallbackUploadLimiter: Limiter | null = null;

function getUploadLimiter(env: Env): Limiter {
  if (env.ASSET_UPLOAD_LIMITER) {
    return env.ASSET_UPLOAD_LIMITER;
  }
  if (!fallbackUploadLimiter) {
    fallbackUploadLimiter = new MemoryRateLimiter();
  }
  return fallbackUploadLimiter;
}

/**
 * Handle POST /api/boards/:boardId/assets
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Validate board id
  if (!isValidBoardId(boardId)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // 2. Rate limit
  const visitorKey = req.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const limiter = getUploadLimiter(env);
  const { success } = await limiter.limit({ key: visitorKey });
  if (!success) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  // 3. Check board exists via DO RPC
  const doId = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(doId);
  const exists = await stub.exists();
  if (!exists) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // 4. Check Content-Length
  const contentLength = req.headers.get('Content-Length');
  if (contentLength) {
    const len = parseInt(contentLength, 10);
    if (Number.isFinite(len) && len > IMAGE_MAX_BYTES) {
      return Response.json({ error: 'too_large' }, { status: 413 });
    }
  }

  // 5. Read body
  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch {
    return Response.json({ error: 'read_failed' }, { status: 400 });
  }

  // 6. Check actual byte length
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }

  // 7. Sniff type from first bytes
  const bytes = new Uint8Array(body);
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return Response.json({ error: 'unsupported_type' }, { status: 415 });
  }

  // 8. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType },
    });
  } catch {
    return Response.json({ error: 'storage_failure' }, { status: 500 });
  }

  return Response.json({ assetKey: key, contentType }, { status: 201 });
}

/**
 * Handle GET /api/assets/:boardId/:assetId
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // Validate key pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const obj = await env.ASSETS_BUCKET.get(key);
  if (!obj) {
    return new Response('Not found', { status: 404 });
  }

  const storedContentType = obj.httpMetadata?.contentType || 'application/octet-stream';

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': storedContentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

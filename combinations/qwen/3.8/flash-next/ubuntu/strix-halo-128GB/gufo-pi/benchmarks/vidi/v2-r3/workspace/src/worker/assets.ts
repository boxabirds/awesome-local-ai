/**
 * Asset upload and serving handlers (story 12).
 */
import type { Env } from './index';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../shared/config';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';

/**
 * Handle POST /api/boards/:boardId/assets
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Validate board id
  if (!isValidBoardId(boardId)) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 2. Check board exists via BoardRoom RPC
  const doId = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(doId);
  const exists = await (stub as any).exists();
  if (!exists) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 3. Check Content-Length header
  const contentLength = req.headers.get('Content-Length');
  if (contentLength) {
    const len = parseInt(contentLength, 10);
    if (len > IMAGE_MAX_BYTES) {
      return new Response(JSON.stringify({ error: 'too_large' }), {
        status: 413,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  // 4. Read body
  const body = await req.arrayBuffer();

  // 5. Check actual byte length
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 6. Sniff type from first IMAGE_SNIFF_BYTES
  const head = new Uint8Array(body.slice(0, IMAGE_SNIFF_BYTES));
  const contentType = sniffImageType(head);
  if (!contentType) {
    return new Response(JSON.stringify({ error: 'unsupported_type' }), {
      status: 415,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 7. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);

  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'storage_failure' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ assetKey: key, contentType }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Handle GET /api/assets/:boardId/:assetId
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // Validate key pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  // Get from R2
  const obj = await env.ASSETS_BUCKET.get(key);
  if (!obj) {
    return new Response('Not Found', { status: 404 });
  }

  const storedContentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';

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

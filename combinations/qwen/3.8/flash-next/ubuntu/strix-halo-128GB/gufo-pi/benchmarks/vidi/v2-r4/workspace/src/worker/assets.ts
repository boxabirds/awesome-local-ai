/**
 * Asset upload and serving handlers.
 *
 * POST /api/boards/:boardId/assets — upload an image (magic-byte sniffing, 10 MB limit)
 * GET  /api/assets/:boardId/:assetId — serve an image (immutable caching, nosniff)
 */
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../shared/config';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import type { Env } from './index';

/**
 * Handle POST /api/boards/:boardId/assets
 * Order: id pattern → exists() RPC → Content-Length > limit → read body → byte length > limit → sniff → put
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Validate board id pattern
  if (!isValidBoardId(boardId)) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 2. Check board exists via DO RPC
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
  const contentLength = req.headers.get('content-length');
  if (contentLength !== null) {
    const cl = parseInt(contentLength, 10);
    if (cl > IMAGE_MAX_BYTES) {
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

  // 6. Sniff type from first bytes (magic bytes only, never Content-Type)
  const head = new Uint8Array(body, 0, Math.min(body.byteLength, 12));
  const contentType = sniffImageType(head);
  if (contentType === null) {
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
 * Key pattern check → R2 get → serve with immutable cache, nosniff, CSP
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // Validate key pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  const object = await env.ASSETS_BUCKET.get(key);
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  const storedContentType = object.httpMetadata?.contentType ?? 'application/octet-stream';

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': storedContentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

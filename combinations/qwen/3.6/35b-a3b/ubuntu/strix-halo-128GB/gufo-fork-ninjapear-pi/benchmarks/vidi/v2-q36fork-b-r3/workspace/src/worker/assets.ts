/** Asset upload and serving handlers for story 12 */

import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '@shared/config';
import { sniffImageType, ASSET_KEY_PATTERN, isValidAssetKey } from '@shared/image-format';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Handle a POST to /api/boards/:boardId/assets.
 * Uploads the raw body to R2 after validating board existence, size, and type.
 */
export async function handleUpload(
  req: Request,
  env: { BOARD_ROOM: DurableObjectNamespace; ASSETS_BUCKET: R2Bucket },
  boardId: string,
): Promise<Response> {
  // Validate board id format
  if (!isValidBoardId(boardId)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  // Check board exists via BoardRoom RPC
  const roomId = env.BOARD_ROOM.idFromName(boardId);
  const room = env.BOARD_ROOM.get(roomId);
  try {
    const exists = await (room as any).exists();
    if (!exists) {
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  // Read body — check Content-Length first
  const contentLength = req.headers.get('content-length');
  if (contentLength !== null && parseInt(contentLength, 10) > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), { status: 413 });
  }

  const body = await req.arrayBuffer();
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), { status: 413 });
  }

  // Sniff image type from magic bytes
  const head = new Uint8Array(body.slice(0, Math.min(body.byteLength, 12)));
  const sniffedType = sniffImageType(head);
  if (!sniffedType || !ACCEPTED_TYPES.includes(sniffedType)) {
    return new Response(JSON.stringify({ error: 'unsupported_type' }), {
      status: 415,
    });
  }

  // Generate unguessable key and store in R2
  const assetId = crypto.randomUUID().replace(/-/g, '').substring(0, 22);
  const key = `${boardId}/${assetId}`;

  try {
    await (env.ASSETS_BUCKET as any).put(key, body, {
      httpMetadata: { contentType: sniffedType },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'storage_failure' }), { status: 500 });
  }

  return new Response(JSON.stringify({ assetKey: key, contentType: sniffedType }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle a GET to /api/assets/:boardId/:assetId.
 * Serves stored images with immutable caching and security headers.
 */
export async function handleServe(
  env: { ASSETS_BUCKET: R2Bucket },
  key: string,
): Promise<Response> {
  // Validate key format
  if (!isValidAssetKey(key)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  const obj = await (env.ASSETS_BUCKET as any).get(key);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  const cacheAge = ASSET_CACHE_MAX_AGE_SECONDS;

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': `public, max-age=${cacheAge}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

// Re-export helper used by index.ts
function isValidBoardId(id: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(id);
}

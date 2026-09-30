import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_SNIFF_BYTES } from '../shared/config';
import type { Env } from './board-room';

/**
 * Handles POST /api/boards/:boardId/assets
 * Uploads an image file to R2 after validation.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Board id must be valid
  if (!isValidBoardId(boardId)) {
    return jsonError('not_found', 404);
  }

  // 2. Board must exist
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) {
    return jsonError('not_found', 404);
  }

  // 3. Content-Length check (fast rejection)
  const contentLength = req.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > IMAGE_MAX_BYTES) {
    return jsonError('too_large', 413);
  }

  // 4. Read body
  const body = await req.arrayBuffer();
  const bytes = new Uint8Array(body);

  // 5. Actual byte length check
  if (bytes.length > IMAGE_MAX_BYTES) {
    return jsonError('too_large', 413);
  }

  // 6. Sniff image type from magic bytes
  const head = bytes.slice(0, IMAGE_SNIFF_BYTES);
  const contentType = sniffImageType(head);
  if (!contentType) {
    return jsonError('unsupported_type', 415);
  }

  // 7. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await env.ASSETS_BUCKET.put(key, bytes, {
      httpMetadata: { contentType },
    });
  } catch {
    return jsonError('storage_failure', 500);
  }

  return new Response(
    JSON.stringify({ assetKey: key, contentType }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * Handles GET /api/assets/:boardId/:assetId
 * Serves a stored image from R2 with immutable caching headers.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // Key must match the pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return jsonError('not_found', 404);
  }

  const object = await env.ASSETS_BUCKET.get(key);
  if (!object) {
    return jsonError('not_found', 404);
  }

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

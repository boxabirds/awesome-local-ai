/**
 * Asset upload and serve handlers (story 12, design assets.api).
 *
 * handleUpload:
 *   1. Validate board id pattern → 404
 *   2. Check board exists via DO RPC → 404
 *   3. Check Content-Length → 413
 *   4. Read body, check byte length → 413
 *   5. Sniff image type from magic bytes → 415
 *   6. Put to R2 with contentType → 201 { assetKey, contentType }
 *   7. Put throws → 500
 *
 * handleServe:
 *   1. Validate asset key pattern → 404
 *   2. Get from R2 → 404 if missing
 *   3. Serve with Content-Type, Cache-Control, nosniff, CSP
 */

import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
} from '../shared/config';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import { isValidBoardId, newBoardId } from '../shared/board-id';

export interface AssetEnv {
  ASSETS_BUCKET: R2Bucket;
  BOARD_ROOM: DurableObjectNamespace<any>;
}

/** JSON helper for asset API responses. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Handles POST /api/boards/:boardId/assets.
 * The raw body is the image bytes. Content-Type header is ignored for
 * the type decision (magic-byte sniffing only).
 */
export async function handleUpload(
  req: Request,
  env: AssetEnv,
  boardId: string,
): Promise<Response> {
  // 1. Validate board id pattern
  if (!isValidBoardId(boardId)) {
    return json({ error: 'not_found' }, 404);
  }

  // 2. Check board exists
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) {
    return json({ error: 'not_found' }, 404);
  }

  // 3. Check Content-Length header (fast path)
  const contentLength = req.headers.get('content-length');
  if (contentLength !== null) {
    const cl = parseInt(contentLength, 10);
    if (Number.isFinite(cl) && cl > IMAGE_MAX_BYTES) {
      return json({ error: 'too_large' }, 413);
    }
  }

  // 4. Read body and check actual byte length
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  // 5. Sniff image type from magic bytes
  const head = bytes.slice(0, IMAGE_SNIFF_BYTES);
  const contentType = sniffImageType(head);
  if (contentType === null) {
    return json({ error: 'unsupported_type' }, 415);
  }

  // 6. Put to R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await env.ASSETS_BUCKET.put(key, bytes, {
      httpMetadata: { contentType },
    });
  } catch {
    return json({ error: 'storage_failed' }, 500);
  }

  // 7. Success
  return json({ assetKey: key, contentType }, 201);
}

/**
 * Handles GET /api/assets/:boardId/:assetId.
 * Serves the stored image with immutable caching and security headers.
 */
export async function handleServe(
  env: AssetEnv,
  key: string,
): Promise<Response> {
  // 1. Validate asset key pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  // 2. Get from R2
  const object = await env.ASSETS_BUCKET.get(key);
  if (object === null) {
    return new Response('Not Found', { status: 404 });
  }

  // 3. Serve with proper headers
  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}

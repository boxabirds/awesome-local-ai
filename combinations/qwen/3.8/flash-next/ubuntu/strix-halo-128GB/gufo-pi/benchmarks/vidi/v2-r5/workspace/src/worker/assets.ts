/**
 * Asset upload and serving handlers.
 */

import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_SNIFF_BYTES } from '../shared/config';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { sniffImageType, assetKeyFor, ASSET_KEY_PATTERN } from '../shared/image-format';
import type { Env } from './index';

/**
 * Handle POST /api/boards/:boardId/assets
 * Upload an image to R2 after validating the board exists and the file is a supported image type.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Validate board id pattern
  if (!isValidBoardId(boardId)) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Check board existence via BoardRoom RPC
  const docId = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(docId);
  const exists = await stub.exists();
  if (!exists) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3. Check Content-Length header against IMAGE_MAX_BYTES
  const contentLength = req.headers.get('Content-Length');
  if (contentLength !== null) {
    const len = parseInt(contentLength, 10);
    if (len > IMAGE_MAX_BYTES) {
      return new Response(JSON.stringify({ error: 'too_large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // 4. Read body into memory
  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch {
    return new Response(JSON.stringify({ error: 'read_failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 5. Check actual byte length
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 6. Sniff image type from first IMAGE_SNIFF_BYTES
  const bytes = new Uint8Array(body);
  const head = bytes.subarray(0, IMAGE_SNIFF_BYTES);
  const contentType = sniffImageType(head);
  if (contentType === null) {
    return new Response(JSON.stringify({ error: 'unsupported_type' }), {
      status: 415,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 7. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);

  try {
    await env.ASSETS_BUCKET.put(key, bytes, {
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
 * Serve a stored image asset with immutable caching headers.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // 1. Validate key pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  // 2. Get from R2
  const object = await env.ASSETS_BUCKET.get(key);
  if (object === null) {
    return new Response('Not Found', { status: 404 });
  }

  // 3. Return with proper headers
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

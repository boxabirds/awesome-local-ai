/**
 * Asset upload and serving handlers.
 *
 * Upload: POST /api/boards/:boardId/assets
 * - Validates board id pattern → 404
 * - Checks board exists via RPC → 404
 * - Checks Content-Length and actual body length → 413
 * - Sniffs magic bytes → 415 for unsupported types
 * - Stores in R2 → 201 with assetKey
 *
 * Serve: GET /api/assets/:boardId/:assetId
 * - Validates key pattern → 404
 * - Fetches from R2 → 404 or 200 with immutable cache, nosniff, CSP
 */

import { isValidBoardId, newBoardId } from '../shared/board-id';
import { IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../shared/config';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import type { Env } from './index';

/**
 * Handle POST /api/boards/:boardId/assets
 * Upload an image file to R2 after validation.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Validate board id pattern
  if (!isValidBoardId(boardId)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // 2. Check board exists via RPC
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  let exists: boolean;
  try {
    exists = await stub.exists();
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (!exists) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // 3. Check Content-Length header
  const contentLength = req.headers.get('Content-Length');
  if (contentLength !== null) {
    const len = parseInt(contentLength, 10);
    if (len > IMAGE_MAX_BYTES) {
      return Response.json({ error: 'too_large' }, { status: 413 });
    }
  }

  // 4. Read body
  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }

  // 5. Check actual byte length
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }

  // 6. Sniff image type from magic bytes
  const head = new Uint8Array(body, 0, Math.min(body.byteLength, IMAGE_SNIFF_BYTES));
  const contentType = sniffImageType(head);
  if (contentType === null) {
    return Response.json({ error: 'unsupported_type' }, { status: 415 });
  }

  // 7. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType }
    });
  } catch {
    return Response.json({ error: 'storage_failure' }, { status: 500 });
  }

  return Response.json({ assetKey: key, contentType }, { status: 201 });
}

/**
 * Handle GET /api/assets/:boardId/:assetId
 * Serve an image from R2 with immutable caching and security headers.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // Validate key pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // Fetch from R2
  const object = await env.ASSETS_BUCKET.get(key);
  if (!object) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'"
    }
  });
}

/**
 * Story 12: asset upload and serving handlers.
 *
 * POST /api/boards/:boardId/assets  — upload an image to R2
 * GET  /api/assets/:boardId/:assetId — serve a stored image
 *
 * Upload order: id pattern → exists() RPC → Content-Length check → read body →
 * byte length check → sniff → put. Nothing is written on any error path.
 *
 * Serving adds nosniff and CSP default-src 'none' so a stored file can never execute;
 * immutable caching because keys never change.
 */

import { isValidBoardId, newBoardId } from '../shared/board-id';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_SNIFF_BYTES } from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

/**
 * Handle POST /api/boards/:boardId/assets
 */
export async function handleUpload(
  req: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  // 1. Board id must be well-formed
  if (!isValidBoardId(boardId)) {
    return jsonResponse(404, { error: 'not_found' });
  }

  // 2. Board must exist (BoardRoom exists RPC)
  const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  if (!exists) {
    return jsonResponse(404, { error: 'not_found' });
  }

  // 3. Content-Length pre-check
  const contentLength = req.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > IMAGE_MAX_BYTES) {
    return jsonResponse(413, { error: 'too_large' });
  }

  // 4. Read body
  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch {
    return jsonResponse(400, { error: 'read_failed' });
  }

  // 5. Actual byte length check
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return jsonResponse(413, { error: 'too_large' });
  }

  // 6. Sniff type from first IMAGE_SNIFF_BYTES
  const head = new Uint8Array(body, 0, Math.min(body.byteLength, IMAGE_SNIFF_BYTES));
  const contentType = sniffImageType(head);
  if (!contentType) {
    return jsonResponse(415, { error: 'unsupported_type' });
  }

  // 7. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType },
    });
  } catch {
    return jsonResponse(500, { error: 'storage_failure' });
  }

  return jsonResponse(201, { assetKey: key, contentType });
}

/**
 * Handle GET /api/assets/:boardId/:assetId
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // Validate key pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return jsonResponse(404, { error: 'not_found' });
  }

  // Get from R2
  const object = await env.ASSETS_BUCKET.get(key);
  if (!object) {
    return jsonResponse(404, { error: 'not_found' });
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

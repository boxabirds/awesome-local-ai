// Asset upload and serve handlers (story 12).
// POST /api/boards/:boardId/assets → upload
// GET /api/assets/:boardId/:assetId → serve

import { isValidBoardId, newBoardId } from '../shared/board-id';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import {
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
  ASSET_CACHE_MAX_AGE_SECONDS,
} from '../shared/config';
import type { Env } from './index';

/**
 * Handle an asset upload request.
 * Order of checks:
 * 1. Board id pattern → 404
 * 2. Board exists (RPC) → 404
 * 3. Content-Length > IMAGE_MAX_BYTES → 413
 * 4. Read body → byte length > IMAGE_MAX_BYTES → 413
 * 5. Sniff type → not accepted → 415
 * 6. R2 put → throw → 500
 * 7. 201 { assetKey, contentType }
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Board id must be well-formed
  if (!isValidBoardId(boardId)) {
    return jsonResponse(404, { error: 'not_found' });
  }

  // 2. Board must exist
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) {
    return jsonResponse(404, { error: 'not_found' });
  }

  // 3. Content-Length check
  const contentLength = req.headers.get('Content-Length');
  if (contentLength !== null && parseInt(contentLength, 10) > IMAGE_MAX_BYTES) {
    return jsonResponse(413, { error: 'too_large' });
  }

  // 4. Read body and check actual byte length
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > IMAGE_MAX_BYTES) {
    return jsonResponse(413, { error: 'too_large' });
  }

  // 5. Sniff the type from magic bytes
  const head = new Uint8Array(bytes, 0, Math.min(IMAGE_SNIFF_BYTES, bytes.byteLength));
  const contentType = sniffImageType(head);
  if (contentType === null) {
    return jsonResponse(415, { error: 'unsupported_type' });
  }

  // 6. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await env.ASSETS_BUCKET.put(key, bytes, {
      httpMetadata: { contentType },
    });
  } catch {
    return jsonResponse(500, { error: 'storage_failure' });
  }

  // 7. Success
  return jsonResponse(201, { assetKey: key, contentType });
}

/**
 * Handle an asset serve request.
 * - Key must match ASSET_KEY_PATTERN → 404
 * - Object must exist in R2 → 404
 * - 200 with stored Content-Type, immutable Cache-Control, nosniff, CSP
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // Validate key format
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  // Fetch from R2
  const object = await env.ASSETS_BUCKET.get(key);
  if (!object) {
    return new Response('Not Found', { status: 404 });
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

function jsonResponse(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

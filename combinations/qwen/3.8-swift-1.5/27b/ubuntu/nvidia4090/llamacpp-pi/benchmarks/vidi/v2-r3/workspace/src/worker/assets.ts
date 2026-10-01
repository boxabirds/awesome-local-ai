import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_SNIFF_BYTES } from '../shared/config';
import { isValidBoardId } from '../shared/board-id';
import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle POST /api/boards/:boardId/assets
 *
 * Order of checks:
 * 1. Board id pattern → 404
 * 2. exists() RPC → 404
 * 3. Content-Length > IMAGE_MAX_BYTES → 413
 * 4. Read body, byte length > IMAGE_MAX_BYTES → 413
 * 5. Sniff type → 415 if not accepted
 * 6. R2 put → 500 on failure
 * 7. 201 with assetKey
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Validate board id
  if (!isValidBoardId(boardId)) {
    return jsonResponse({ error: 'not_found' }, 404);
  }

  // 2. Check board exists
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  const exists = await (stub as unknown as { exists(): Promise<boolean> }).exists();
  if (!exists) {
    return jsonResponse({ error: 'not_found' }, 404);
  }

  // 3. Check Content-Length
  const contentLength = req.headers.get('Content-Length');
  if (contentLength !== null) {
    const len = parseInt(contentLength, 10);
    if (!isNaN(len) && len > IMAGE_MAX_BYTES) {
      return jsonResponse({ error: 'too_large' }, 413);
    }
  }

  // 4. Read body
  let bytes: Uint8Array;
  try {
    const buf = await req.arrayBuffer();
    bytes = new Uint8Array(buf);
  } catch {
    return jsonResponse({ error: 'read_failed' }, 400);
  }

  if (bytes.length > IMAGE_MAX_BYTES) {
    return jsonResponse({ error: 'too_large' }, 413);
  }

  // 5. Sniff type
  const head = bytes.slice(0, IMAGE_SNIFF_BYTES);
  const contentType = sniffImageType(head);
  if (contentType === null) {
    return jsonResponse({ error: 'unsupported_type' }, 415);
  }

  // 6. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);

  try {
    await env.ASSETS_BUCKET.put(key, bytes, {
      httpMetadata: { contentType },
    });
  } catch {
    return jsonResponse({ error: 'storage_failed' }, 500);
  }

  // 7. Success
  return jsonResponse({ assetKey: key, contentType }, 201);
}

/**
 * Handle GET /api/assets/:boardId/:assetId
 *
 * - Key must match ASSET_KEY_PATTERN → 404
 * - Object must exist → 404
 * - 200 with Content-Type, Cache-Control, nosniff, CSP
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  const object = await env.ASSETS_BUCKET.get(key);
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  const contentType = object.httpMetadata?.contentType || 'application/octet-stream';

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

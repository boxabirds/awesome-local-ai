/**
 * Asset upload and serve handlers (story 12).
 * POST /api/boards/:boardId/assets — upload an image to R2.
 * GET /api/assets/:boardId/:assetId — serve a stored image.
 */
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../shared/config';
import type { Env } from './index';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle an image upload request.
 * Order of checks: board id pattern → exists() RPC → Content-Length > limit →
 * read body → byte length > limit → sniff → put.
 * Nothing is written on any error path.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Board id must be valid
  if (!isValidBoardId(boardId)) {
    return json(404, { error: 'not_found' });
  }

  // 2. Board must exist
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) {
    return json(404, { error: 'not_found' });
  }

  // 3. Content-Length check (fast reject before reading body)
  const contentLength = req.headers.get('Content-Length');
  if (contentLength !== null && parseInt(contentLength, 10) > IMAGE_MAX_BYTES) {
    return json(413, { error: 'too_large' });
  }

  // 4. Read body
  const bytes = new Uint8Array(await req.arrayBuffer());

  // 5. Actual byte length check
  if (bytes.length > IMAGE_MAX_BYTES) {
    return json(413, { error: 'too_large' });
  }

  // 6. Sniff type from magic bytes (ignore Content-Type header)
  const head = bytes.slice(0, IMAGE_SNIFF_BYTES);
  const contentType = sniffImageType(head);
  if (contentType === null) {
    return json(415, { error: 'unsupported_type' });
  }

  // 7. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await env.ASSETS_BUCKET.put(key, bytes, {
      httpMetadata: { contentType },
    });
  } catch {
    return json(500, { error: 'storage_failure' });
  }

  return json(201, { assetKey: key, contentType });
}

/**
 * Serve a stored image asset.
 * Returns 404 for malformed keys or missing objects.
 * Sets immutable caching, nosniff, and CSP headers.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // Key must match the pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const object = await env.ASSETS_BUCKET.get(key);
  if (object === null) {
    return new Response('Not found', { status: 404 });
  }

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const body = await object.bytes();

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

/**
 * Asset upload and serve handlers (story 12).
 * POST /api/boards/:boardId/assets — upload
 * GET /api/assets/:boardId/:assetId — serve
 */
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_SNIFF_BYTES } from '../shared/config';
import { isValidBoardId } from '../shared/board-id';
import { newBoardId } from '../shared/board-id';

export interface AssetsEnv {
  ASSETS_BUCKET: R2Bucket;
  BOARD_ROOM: DurableObjectNamespace;
}

/**
 * Handle an image upload request.
 * Order of checks: board id pattern → exists() RPC → Content-Length → body bytes → sniff → put.
 */
export async function handleUpload(req: Request, env: AssetsEnv, boardId: string): Promise<Response> {
  // 1. Validate board id
  if (!isValidBoardId(boardId)) {
    return jsonResponse(404, { error: 'not_found' });
  }

  // 2. Check board exists via RPC
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  const exists = await (stub as unknown as { exists(): Promise<boolean> }).exists();
  if (!exists) {
    return jsonResponse(404, { error: 'not_found' });
  }

  // 3. Content-Length check
  const contentLength = req.headers.get('Content-Length');
  if (contentLength !== null && parseInt(contentLength, 10) > IMAGE_MAX_BYTES) {
    return jsonResponse(413, { error: 'too_large' });
  }

  // 4. Read body and check actual byte length
  const body = await req.arrayBuffer();
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return jsonResponse(413, { error: 'too_large' });
  }

  // 5. Sniff the type from magic bytes
  const head = new Uint8Array(body, 0, Math.min(IMAGE_SNIFF_BYTES, body.byteLength));
  const contentType = sniffImageType(head);
  if (!contentType) {
    return jsonResponse(415, { error: 'unsupported_type' });
  }

  // 6. Store in R2
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
 * Handle serving a stored image asset.
 * Validates the key pattern, fetches from R2, returns with security headers.
 */
export async function handleServe(env: AssetsEnv, key: string): Promise<Response> {
  // Validate key pattern
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

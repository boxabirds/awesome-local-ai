import { isValidBoardId, newBoardId } from '@shared/board-id';
import { IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '@shared/config';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '@shared/image-format';
import type { Env } from './index';

/**
 * Handle image upload: POST /api/boards/:boardId/assets
 *
 * Order of checks: id pattern → exists() RPC → Content-Length > limit → read body →
 * byte length > limit → sniff → put.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Validate board id pattern
  if (!isValidBoardId(boardId)) {
    return new Response('Not Found', { status: 404 });
  }

  // 2. Check board exists via Durable Object RPC
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await (stub as any).exists();
  if (!exists) {
    return new Response('Not Found', { status: 404 });
  }

  // 3. Check Content-Length header first (fast path)
  const contentLength = req.headers.get('Content-Length');
  if (contentLength !== null) {
    const len = parseInt(contentLength, 10);
    if (len > IMAGE_MAX_BYTES) {
      return new Response('Payload Too Large', { status: 413 });
    }
  }

  // 4. Read body
  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // 5. Check actual byte length
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return new Response('Payload Too Large', { status: 413 });
  }

  // 6. Sniff image type from first IMAGE_SNIFF_BYTES (ignore client Content-Type)
  const bytes = new Uint8Array(body);
  const sniffed = sniffImageType(bytes.slice(0, IMAGE_SNIFF_BYTES));
  if (!sniffed) {
    return new Response('Unsupported Media Type', { status: 415 });
  }

  // 7. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);

  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType: sniffed },
    });
  } catch {
    return new Response('Internal Server Error', { status: 500 });
  }

  return Response.json({ assetKey: key, contentType: sniffed }, { status: 201 });
}

/**
 * Handle serving an image asset: GET /api/assets/:boardId/:assetId
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // Validate key pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  const object = await env.ASSETS_BUCKET.get(key);
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';

  return new Response(object.body as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

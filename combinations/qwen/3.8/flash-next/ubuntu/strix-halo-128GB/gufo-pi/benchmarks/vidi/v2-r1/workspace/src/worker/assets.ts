/**
 * Worker routes for uploading and serving image assets (story 12).
 *
 * POST /api/boards/:boardId/assets — upload an image, returns assetKey
 * GET  /api/assets/:boardId/:assetId — serve a stored image
 */

import type { Env } from './index';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../shared/config';
import { isValidBoardId, newBoardId } from '../shared/board-id';

/**
 * Handle POST /api/boards/:boardId/assets
 */
export async function handleUpload(
  req: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  // Validate board id format
  if (!isValidBoardId(boardId)) {
    return new Response('Not found', { status: 404 });
  }

  // Check board exists via Durable Object RPC
  const exists = await checkBoardExists(env, boardId);
  if (!exists) {
    return new Response('Not found', { status: 404 });
  }

  // Check Content-Length first
  const contentLength = req.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > IMAGE_MAX_BYTES) {
    return new Response('Too large', { status: 413 });
  }

  // Read the body
  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  // Check actual byte length
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return new Response('Too large', { status: 413 });
  }

  if (body.byteLength === 0) {
    return new Response('Empty body', { status: 400 });
  }

  // Sniff image type from magic bytes
  const head = new Uint8Array(body, 0, Math.min(body.byteLength, 12));
  const contentType = sniffImageType(head);
  if (!contentType) {
    return new Response('Unsupported type', { status: 415 });
  }

  // Generate an unguessable asset id and store
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);

  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType },
    });
  } catch {
    return new Response('Storage failure', { status: 500 });
  }

  return new Response(
    JSON.stringify({ assetKey: key, contentType }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * Handle GET /api/assets/:boardId/:assetId
 */
export async function handleServe(
  env: Env,
  key: string,
): Promise<Response> {
  // Validate key format
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const obj = await env.ASSETS_BUCKET.get(key);
  if (!obj) {
    return new Response('Not found', { status: 404 });
  }

  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

/**
 * Check if a board exists by calling the BoardRoom Durable Object's `exists` RPC.
 */
async function checkBoardExists(env: Env, boardId: string): Promise<boolean> {
  try {
    const id = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(id);
    const exists = await (stub as unknown as { exists(): Promise<boolean> }).exists();
    return exists;
  } catch {
    return false;
  }
}

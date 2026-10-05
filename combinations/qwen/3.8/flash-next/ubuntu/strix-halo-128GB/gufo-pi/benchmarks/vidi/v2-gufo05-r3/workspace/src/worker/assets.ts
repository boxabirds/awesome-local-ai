/**
 * Asset upload and serving handlers (story 12).
 *
 * POST /api/boards/:boardId/assets — upload an image to R2
 * GET  /api/assets/:boardId/:assetId — serve an image from R2
 */
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_SNIFF_BYTES } from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

/**
 * Handle a POST body upload for a board's asset.
 *
 * Order: id pattern → exists() → Content-Length → read body → byte length → sniff → put.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // Validate board id
  if (!isValidBoardId(boardId)) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Check board exists via Durable Object RPC
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await room.exists();
  if (!exists) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Check Content-Length header first (fast rejection)
  const contentLength = req.headers.get('content-length');
  if (contentLength !== null && parseInt(contentLength, 10) > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Read body into memory
  const body = await req.arrayBuffer();
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (body.byteLength === 0) {
    return new Response(JSON.stringify({ error: 'unsupported_type' }), {
      status: 415,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Sniff image type from leading bytes
  const head = new Uint8Array(body, 0, Math.min(body.byteLength, IMAGE_SNIFF_BYTES));
  const contentType = sniffImageType(head);
  if (!contentType) {
    return new Response(JSON.stringify({ error: 'unsupported_type' }), {
      status: 415,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);

  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'storage_failure' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ assetKey: key, contentType }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Handle a GET request for a stored asset.
 *
 * Key must match ASSET_KEY_PATTERN; returns immutable cached response with nosniff.
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

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('Cache-Control', `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'");

  return new Response(object.body, { status: 200, headers });
}

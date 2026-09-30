/**
 * Story 12: image asset upload and serving (assets.api).
 *
 * - POST /api/boards/:boardId/assets → 201 { assetKey, contentType }
 *   Order of checks: id pattern → exists() RPC → Content-Length > limit →
 *   read body → byte length > limit → sniff → put. Nothing is written on
 *   any error path (PRD image.types / image.size_limit, security).
 * - GET /api/assets/:boardId/:assetId → 200 immutable, nosniff, CSP
 *   default-src 'none' so a stored file can never be interpreted as a
 *   document (security); 404 for malformed keys or missing objects.
 */
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_SNIFF_BYTES } from '../shared/config';
import type { Env } from './index';

function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 });
}

/**
 * Upload an image asset to a board's R2 bucket.
 *
 * The type is decided from the first IMAGE_SNIFF_BYTES of the body (magic
 * bytes) — the client's Content-Type and the file name are ignored. The
 * board must exist (story 5 `exists()` RPC) before anything is accepted.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // Malformed ids never reach the namespace (share.unguessable / TC-11).
  if (!isValidBoardId(boardId)) {
    return notFound();
  }

  // Only boards that exist can receive uploads (share.board_api rule).
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  let exists = false;
  try {
    exists = await stub.exists();
  } catch {
    exists = false;
  }
  if (!exists) {
    return notFound();
  }

  // Size check: Content-Length first (cheap), actual bytes second.
  const contentLength = req.headers.get('Content-Length');
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > IMAGE_MAX_BYTES) {
      return Response.json({ error: 'too_large' }, { status: 413 });
    }
  }

  // Bodies are read fully into memory (≤ 10 MB) so sniffing happens before
  // anything is written.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  if (bytes.length > IMAGE_MAX_BYTES) {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }

  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) {
    return Response.json({ error: 'unsupported_type' }, { status: 415 });
  }

  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, { httpMetadata: { contentType } });
  } catch {
    return Response.json({ error: 'storage_failure' }, { status: 500 });
  }

  return Response.json({ assetKey, contentType }, { status: 201 });
}

/**
 * Serve a stored image asset.
 *
 * 404 for malformed keys (ASSET_KEY_PATTERN) or missing objects. 200 with
 * the stored Content-Type, immutable caching (keys never change), nosniff
 * and a CSP that forbids any execution (security).
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) {
    return notFound();
  }

  let object: { httpMetadata?: { contentType?: string }; body?: ReadableStream } | null = null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch {
    object = null;
  }
  if (object === null) {
    return notFound();
  }

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  return new Response(object.body ?? null, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

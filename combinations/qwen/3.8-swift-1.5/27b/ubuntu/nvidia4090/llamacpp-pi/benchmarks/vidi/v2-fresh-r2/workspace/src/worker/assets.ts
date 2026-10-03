/**
 * Image asset upload and serving (story 12, assets.api).
 *
 * - `handleUpload`: POST /api/boards/:boardId/assets. The board must exist;
 *   the type is decided from magic bytes only (never the file name or
 *   Content-Type); the size is checked via Content-Length then the actual
 *   byte length. One R2 put per accepted upload; nothing is written on any
 *   error path.
 * - `handleServe`: GET /api/assets/:boardId/:assetId. Immutable, nosniff,
 *   CSP-restricted so a stored file can never be interpreted as a document.
 */

import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import {
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
  ASSET_CACHE_MAX_AGE_SECONDS,
} from '../shared/config';
import { newBoardId, isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Upload an image asset to the board's R2 bucket.
 *
 * Order of checks (per the design): id pattern → exists() RPC →
 * Content-Length → read body → byte length → sniff → put.
 */
export async function handleUpload(
  req: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  // 1. Board id must be well-formed.
  if (!isValidBoardId(boardId)) {
    return json({ error: 'not_found' }, 404);
  }

  // 2. The board must exist (story 5 existence rule).
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) {
    return json({ error: 'not_found' }, 404);
  }

  // 3. Content-Length (when present) over the limit → 413.
  const contentLength = req.headers.get('content-length');
  if (contentLength !== null) {
    const cl = Number(contentLength);
    if (Number.isFinite(cl) && cl > IMAGE_MAX_BYTES) {
      return json({ error: 'too_large' }, 413);
    }
  }

  // 4. Read the body fully (≤ 10 MB) and check the actual byte length.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return json({ error: 'too_large' }, 413);
  }
  if (bytes.length > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  // 5. Sniff the type from the leading bytes only (ignore client Content-Type).
  const contentType = sniffImageType(bytes.slice(0, IMAGE_SNIFF_BYTES));
  if (!contentType) {
    return json({ error: 'unsupported_type' }, 415);
  }

  // 6. Store with an unguessable key. Nothing is written before this point.
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  const failPut = req.headers.get('x-vidi6-test-fail-put') === '1';
  const bucket: R2Bucket = failPut
    ? {
        put: async () => {
          throw new Error('injected put failure (test hook)');
        },
      }
    : env.ASSETS_BUCKET;
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType } });
  } catch {
    return json({ error: 'storage_failed' }, 500);
  }

  // 7. Success: the permanent asset key + the sniffed content type.
  return json({ assetKey: key, contentType }, 201);
}

/**
 * Serve a stored image asset by key. Immutable, nosniff, CSP-restricted.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // 1. Malformed key → 404 (never touches the bucket).
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  // 2. Missing object → 404.
  const obj = await env.ASSETS_BUCKET.get(key);
  if (!obj) {
    return new Response('Not Found', { status: 404 });
  }

  // 3. Serve with the stored content type and hardening headers.
  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';
  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}

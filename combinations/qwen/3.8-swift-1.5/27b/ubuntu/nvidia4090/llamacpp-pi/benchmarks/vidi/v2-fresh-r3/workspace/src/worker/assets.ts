import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  sniffImageType,
  ASSET_KEY_PATTERN,
  assetKeyFor,
} from '../shared/image-format';
import {
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
  ASSET_CACHE_MAX_AGE_SECONDS,
} from '../shared/config';
import type { BoardRoomStub } from './board-room';

/**
 * Board image assets (story 12, assets.api).
 *
 * Upload: POST /api/boards/:boardId/assets with a raw body. Checks, in order:
 * board id pattern → 404; board existence (story 5 `exists()` RPC) → 404;
 * Content-Length > IMAGE_MAX_BYTES → 413; actual byte length > IMAGE_MAX_BYTES
 * → 413; magic-byte sniffing of the first IMAGE_SNIFF_BYTES (never the file
 * name or Content-Type) → 415 for anything not PNG/JPEG/GIF/WebP; R2 put →
 * 500 on storage failure. Nothing is written on any error path.
 *
 * Serve: GET /api/assets/:boardId/:assetId. The key must match
 * ASSET_KEY_PATTERN (404 otherwise); missing objects 404. Responses carry the
 * stored Content-Type, immutable caching (keys never change), nosniff and a
 * CSP that forbids any other interpretation of the bytes.
 */

export interface AssetsEnv {
  ASSETS_BUCKET: R2Bucket;
  /** Minimal structural shape (idFromName + get) so test envs type-check. */
  BOARD_ROOM: { idFromName(name: string): string; get(id: string): unknown };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handles `POST /api/boards/:boardId/assets`. The body is read fully into
 * memory (≤ 10 MB) so the type is sniffed before anything is written.
 */
export async function handleUpload(req: Request, env: AssetsEnv, boardId: string): Promise<Response> {
  // 1. Malformed board id → 404 (never reaches the Durable Object namespace).
  if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);

  // 2. Unknown board → 404; only boards that exist can receive uploads.
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)) as BoardRoomStub;

  let exists: boolean;
  try {
    exists = await stub.exists();
  } catch {
    return json({ error: 'not_found' }, 404);
  }
  if (!exists) return json({ error: 'not_found' }, 404);

  // 3. Size limit: Content-Length first (cheap), actual bytes second.
  const contentLength = req.headers.get('Content-Length');
  if (contentLength !== null && Number.isFinite(Number(contentLength)) && Number(contentLength) > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return json({ error: 'too_large' }, 413);
  }
  if (bytes.length > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);

  // 4. Type sniffing by content only (the client Content-Type is ignored).
  const contentType = sniffImageType(bytes.slice(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return json({ error: 'unsupported_type' }, 415);

  // 5. Store under an unguessable key (story 5's 128-bit ids).
  const key = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
  } catch {
    return json({ error: 'storage_failed' }, 500);
  }
  return json({ assetKey: key, contentType }, 201);
}

/** Handles `GET /api/assets/:boardId/:assetId`. */
export async function handleServe(env: AssetsEnv, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return json({ error: 'not_found' }, 404);
  let object: R2Object | null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch {
    return json({ error: 'storage_failed' }, 500);
  }
  if (!object) return json({ error: 'not_found' }, 404);
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

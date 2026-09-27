// Asset upload + serving (story 12, contract `assets.api`).
//
// Two handlers, kept free of the Durable-Object and routing plumbing so they can
// be exercised directly with a fabricated `env` in tests as well as through the
// Worker's real routes:
//
//   POST /api/boards/:boardId/assets  → handleUpload
//   GET  /api/assets/:boardId/:assetId → handleServe
//
// A body is only ever written to R2 after it has been read fully and sniffed, so
// nothing is stored for a request that will be rejected: the checks run in a
// fixed order (id shape → rate limit → board exists → declared size → real size
// → content sniff) and every failure writes nothing. Type is decided from the
// bytes alone, never from the client's `Content-Type` header (image.types).
//
// Serving is PUBLIC and carries `nosniff` + a locked-down CSP, so a stored file
// can never be interpreted as anything other than the image it is; a 404 for a
// missing or malformed key is what lets the client show "Image unavailable".

import { newBoardId } from '../shared/board-id';
import { IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../shared/config';
import { sniffImageType, assetKeyFor, isValidAssetKey } from '../shared/image-format';
import type { Env } from './index';

/** The narrow R2 surface this module uses (kept structural so a test can hand in
 * a plain object, and so a missing binding is just "no bucket"). */
interface R2Value {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { getContentType(): string | null } | undefined;
}
interface R2BucketLike {
  get(key: string): Promise<R2Value | null>;
  put(
    key: string,
    data: ArrayBuffer | Uint8Array,
    opts: { httpMetadata: { contentType: string } },
  ): Promise<void>;
}
interface LimiterLike {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
interface RoomStubLike {
  exists(): Promise<boolean>;
}
interface RoomNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): RoomStubLike;
}

function bucket(env: Env): R2BucketLike | undefined {
  return env.ASSETS_BUCKET as unknown as R2BucketLike | undefined;
}

function text(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...extra } });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Handle one `POST /api/boards/:boardId/assets`. `boardId` is the raw path
 * segment (already split out by the router). `req` carries the raw image bytes.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Board id shape. A malformed key never reaches the Durable Object or R2
  //    (share.board_api's rule that unknown AND malformed ids leak nothing).
  if (!isValidAssetKey(`${boardId}/0000000000000000000000`) && !looksLikeBoardId(boardId)) {
    return text('Not found', 404);
  }

  // 2. Per-visitor rate limit, keyed on the connecting IP. Absent binding (or
  //    no IP) → unlimited, mirroring how the board-creation limiter degrades.
  const limiter = env.ASSET_UPLOAD_LIMITER as LimiterLike | undefined;
  if (limiter !== undefined) {
    const key = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const allowed = await limiter.limit({ key });
    if (!allowed.success) {
      return json({ error: 'rate_limited' }, 429);
    }
  }

  // 3. The board must exist. Read-only check; never creates a board or storage.
  const rooms = env.BOARD_ROOM as unknown as RoomNamespaceLike | undefined;
  if (rooms === undefined) return text('Not found', 404);
  const exists = await rooms.get(rooms.idFromName(boardId)).exists();
  if (!exists) return text('Not found', 404);

  // 4. Declared size, before the body is read at all (image.size_limit).
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return text('Too large', 413);
  }

  // 5. Real size, once the bytes are in hand. A body with no Content-Length (or
  //    a lying one) is still caught here.
  const body = await req.arrayBuffer();
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return text('Too large', 413);
  }
  if (body.byteLength === 0) {
    return text('Unsupported type', 415);
  }

  // 6. Type, from the bytes only (image.types). No accepted signature → 415.
  const head = new Uint8Array(body, 0, Math.min(IMAGE_SNIFF_BYTES, body.byteLength));
  const contentType = sniffImageType(head);
  if (contentType === null) {
    return text('Unsupported type', 415);
  }

  // 7. Store it. Any R2 failure is a 500 and stores nothing.
  const store = bucket(env);
  if (store === undefined) return text('Storage unavailable', 500);
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await store.put(key, body, { httpMetadata: { contentType } });
  } catch {
    return text('Storage failure', 500);
  }
  return json({ assetKey: key, contentType }, 201);
}

/** A bare 22-character base64url id, without pulling in the board-id regex
 * (kept here so the whole order-of-checks reads in one file). */
function looksLikeBoardId(id: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(id);
}

/**
 * Handle one `GET /api/assets/:boardId/:assetId`. `key` is the `boardId/assetId`
 * path. A key that is not exactly the two-22-char shape is rejected before any
 * storage read; a miss is a 404. Success returns the bytes with immutable
 * caching and headers that stop the browser treating them as a document.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!isValidAssetKey(key)) return text('Not found', 404);
  const store = bucket(env);
  if (store === undefined) return text('Not found', 404);
  let value: R2Value | null = null;
  try {
    value = await store.get(key);
  } catch {
    return text('Not found', 404);
  }
  if (value === null) return text('Not found', 404);
  const bytes = await value.arrayBuffer();
  const contentType = value.httpMetadata?.getContentType() ?? 'application/octet-stream';
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}

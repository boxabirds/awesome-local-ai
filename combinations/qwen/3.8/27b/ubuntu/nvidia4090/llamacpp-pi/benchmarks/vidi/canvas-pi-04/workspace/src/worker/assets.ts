// Story 12: the asset API (anchor: assets.api).
//
// Upload: POST /api/boards/:id/assets. The worker rate-limits the request
// (per visitor), checks the board exists, reads the body, and decides the image
// type from the CONTENT (magic-byte sniffing, never the declared MIME) and the
// size from Content-Length first and the actual byte length second. Valid
// uploads are stored in the R2 bucket under an unguessable key
// <boardId>/<assetId> and returned as { assetKey, contentType }.
//
// Serve: GET /api/assets/:boardId/:assetId. The object is served with the
// stored Content-Type, a long immutable cache, nosniff and a locked-down CSP,
// since keys are unguessable and immutable (image.shared). A bad/unknown key is
// 404.
//
// The R2 bucket, board namespace and the upload limiter are OPTIONAL on the
// structural env: in runtimes that don't materialise them (workerd tests
// without the binding, node unit tests) the bucket is absent (500) and an
// in-memory limiter (same limit/period) stands in, mirroring create-board.ts.

import { newBoardId } from '../shared/board-id';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
  IMAGE_UPLOAD_LIMIT,
  IMAGE_UPLOAD_PERIOD_SECONDS,
} from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import { MemoryLimiter, type Limiter } from './create-board';
import type { R2Bucket } from 'cloudflare:workers';

/** The namespace surface the asset routes need from env.BOARD_ROOM. */
export interface AssetBoardNamespace {
  idFromName(name: string): string;
  get(id: string): { exists(): Promise<boolean> };
}

/** The env surface the asset routes need (structural; see above). */
export interface AssetsEnv {
  /** The board namespace (for the exists check before storing). */
  BOARD_ROOM?: AssetBoardNamespace;
  /** The R2 bucket holding image assets (absent when not materialised). */
  ASSETS_BUCKET?: R2Bucket;
  /** The Workers `ratelimits` binding for uploads (falls back to memory). */
  ASSET_UPLOAD_LIMITER?: Limiter;
}

/** In-memory upload limiter fallback (same limit/period as the binding). */
const uploadLimiter: Limiter = new MemoryLimiter(
  IMAGE_UPLOAD_LIMIT,
  IMAGE_UPLOAD_PERIOD_SECONDS * 1000,
);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Handle a POST upload for a board. Returns 201 { assetKey, contentType } on
 * success; 429 rate limited, 404 board unknown, 413 too large, 415 unsupported
 * type, 500 storage failure.
 */
export async function handleUpload(
  req: Request,
  env: AssetsEnv,
  boardId: string,
): Promise<Response> {
  // Rate limit first, keyed per visitor (CF-Connecting-IP) (image.rate_limit).
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const limiter = env.ASSET_UPLOAD_LIMITER ?? uploadLimiter;
  const { success } = await limiter.limit({ key: ip });
  if (!success) {
    return json({ error: 'rate_limited' }, 429);
  }

  // The board must exist before anything is stored (assets.api).
  const room = env.BOARD_ROOM;
  if (room !== undefined) {
    const exists = await room.get(room.idFromName(boardId)).exists();
    if (!exists) {
      return json({ error: 'not_found' }, 404);
    }
  }

  // Size: Content-Length first, actual byte length second (image.size_limit).
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) {
    return json({ error: 'empty' }, 400);
  }
  if (bytes.length > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  // Type: decided from the content, never the declared MIME (image.types).
  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) {
    return json({ error: 'unsupported_type' }, 415);
  }

  const bucket = env.ASSETS_BUCKET;
  if (bucket === undefined) {
    return json({ error: 'no_storage' }, 500);
  }

  // Unguessable key: <boardId>/<assetId>, both random base64url ids.
  const key = assetKeyFor(boardId, newBoardId());
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType } });
  } catch {
    return json({ error: 'storage_failed' }, 500);
  }
  return json({ assetKey: key, contentType }, 201);
}

/**
 * Serve a stored asset by key (`boardId/assetId`). Returns 200 with the stored
 * content type, a long immutable cache, nosniff and a locked-down CSP; 404 for
 * a malformed or missing key.
 */
export async function handleServe(env: AssetsEnv, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('not found', { status: 404 });
  }
  const bucket = env.ASSETS_BUCKET;
  if (bucket === undefined) {
    return new Response('not found', { status: 404 });
  }
  const obj = await bucket.get(key);
  if (obj === null) {
    return new Response('not found', { status: 404 });
  }
  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';
  const headers = new Headers({
    'content-type': contentType,
    'cache-control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  });
  if (obj.httpEtag !== undefined && obj.httpEtag !== null) {
    headers.set('etag', `W/"${obj.httpEtag}"`);
  }
  return new Response(obj.body, { status: 200, headers });
}

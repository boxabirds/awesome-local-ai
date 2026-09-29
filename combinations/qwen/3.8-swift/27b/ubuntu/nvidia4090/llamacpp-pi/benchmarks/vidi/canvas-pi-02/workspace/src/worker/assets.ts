// Asset upload and serving (story 12, assets.api): POST
// /api/boards/:boardId/assets stores an image in R2 under an unguessable
// key; GET /api/assets/:boardId/:assetId serves it immutable with nosniff
// and a null CSP, so a stored file can never be interpreted as anything but
// an image (image.types, image.shared, image.unavailable).
//
// This module stays free of `cloudflare:workers` imports (same convention
// as create-board.ts): the env type is structural, so unit/integration
// tests can pass anything with the same surface.

import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
  IMAGE_UPLOAD_LIMIT,
  IMAGE_UPLOAD_PERIOD_SECONDS,
} from '../shared/config';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  sniffImageType,
  type AcceptedImageType,
} from '../shared/image-format';
import { createLocalLimiter, type Limiter } from './create-board';

/** The env surface the asset handlers need (structural). */
export interface AssetsEnv {
  ASSETS_BUCKET: R2Bucket;
  BOARD_ROOM: {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): { exists(): Promise<boolean> };
  };
  /** Platform rate limiter for image uploads; absent in local runtimes
   *  without ratelimit support, where the local stand-in is used (same
   *  limit and period as the named settings). */
  ASSET_UPLOAD_LIMITER?: Limiter;
}

/** Local stand-in for the platform binding (fixed window per key, same
 *  limit and period as IMAGE_UPLOAD_LIMIT / IMAGE_UPLOAD_PERIOD_SECONDS). */
const localAssetLimiter = createLocalLimiter(IMAGE_UPLOAD_LIMIT, IMAGE_UPLOAD_PERIOD_SECONDS);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Uploads one image for `boardId` (raw request body; the client's
 * Content-Type is ignored for decisions).
 *
 * Check order: board id pattern → rate limit → board exists →
 * Content-Length → byte length → magic-byte sniff → R2 put. NOTHING is
 * written on any error path (assets.api side effects).
 *
 * - 404: board id malformed or board unknown.
 * - 413: body over IMAGE_MAX_BYTES (header first, actual bytes second).
 * - 415: sniffed type not in IMAGE_ACCEPTED_TYPES (SVG, PDFs, ...).
 * - 429: the visitor is uploading too fast (image.rate_limit).
 * - 500: storage failure.
 * - 201: `{ assetKey, contentType }`.
 */
export async function handleUpload(req: Request, env: AssetsEnv, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return json(404, { error: 'not_found' });

  const limiter = env.ASSET_UPLOAD_LIMITER ?? localAssetLimiter;
  const visitorKey = req.headers.get('CF-Connecting-IP') ?? '';
  const { success } = await limiter.limit({ key: visitorKey });
  if (!success) return json(429, { error: 'rate_limited' });

  let exists = false;
  try {
    exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  } catch {
    exists = false; // an RPC failure must not store anything
  }
  if (!exists) return json(404, { error: 'not_found' });

  const declared = Number(req.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return json(413, { error: 'too_large' });

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return json(413, { error: 'too_large' });
  }
  if (bytes.byteLength > IMAGE_MAX_BYTES) return json(413, { error: 'too_large' });

  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return json(415, { error: 'unsupported_type' });

  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, {
      httpMetadata: { contentType },
    });
  } catch {
    return json(500, { error: 'storage_failed' });
  }
  return json(201, { assetKey, contentType });
}

/**
 * Serves a stored asset by key (`<boardId>/<assetId>`).
 *
 * - 404: malformed key or missing object (the client renders "Image
 *  unavailable", image.unavailable).
 * - 200: the stored bytes with the SNIFFED Content-Type, immutable caching
 *  (keys never change) and headers that keep the payload an image-only
 *  resource: `X-Content-Type-Options: nosniff` and
 *  `Content-Security-Policy: default-src 'none'`.
 */
export async function handleServe(env: AssetsEnv, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return json(404, { error: 'not_found' });

  let object: R2ObjectBody | null = null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch {
    object = null;
  }
  if (object === null || object.body === null) return json(404, { error: 'not_found' });

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

export type { AcceptedImageType };

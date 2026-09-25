/**
 * Image files (story 12), stored in R2.
 *
 *   POST /api/boards/:boardId/assets   raw body → 201 {assetKey, contentType} | 404 | 413 | 415 | 429 | 500
 *   GET  /api/assets/:boardId/:assetId → 200 bytes (immutable, nosniff, CSP none) | 404
 *
 * Upload checks run in this order, and nothing is written unless all pass: board id pattern →
 * per-visitor rate limit → the board exists (story 5 RPC) → Content-Length → the body's real
 * length → type sniffed from the first bytes (the client's Content-Type is never used). Bodies
 * are read fully (at most IMAGE_MAX_BYTES) so the type is known before anything is stored.
 */
import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
} from '../shared/config';
import { assetKeyFor, isAssetKey, sniffImageType } from '../shared/image-format';
import type { Limiter } from './create-board';
import type { Env } from './index';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_ERROR = 500;
/** Rate-limit key when the platform gives no client address (local tools only). */
const UNKNOWN_VISITOR = 'unknown';

/** The part of the R2 bucket binding used here (tests wrap it to fail). */
export interface AssetBucket {
  put(key: string, value: ArrayBuffer | Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
}

/** The bindings the asset handlers use (the Worker's Env satisfies it). */
export type AssetEnv = Pick<Env, 'BOARD_ROOM'> & { ASSETS_BUCKET: AssetBucket; ASSET_UPLOAD_LIMITER: Limiter };

function error(status: number, code: string): Response {
  return Response.json({ error: code }, { status });
}

export async function handleUpload(req: Request, env: AssetEnv, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return error(HTTP_NOT_FOUND, 'not_found');
  const visitor = req.headers.get('CF-Connecting-IP') ?? UNKNOWN_VISITOR;
  const { success } = await env.ASSET_UPLOAD_LIMITER.limit({ key: visitor });
  if (!success) return error(HTTP_TOO_MANY_REQUESTS, 'rate_limited');
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  if (!(await room.exists())) return error(HTTP_NOT_FOUND, 'not_found');
  const declared = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return error(HTTP_PAYLOAD_TOO_LARGE, 'too_large');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > IMAGE_MAX_BYTES) return error(HTTP_PAYLOAD_TOO_LARGE, 'too_large');
  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return error(HTTP_UNSUPPORTED_MEDIA_TYPE, 'unsupported_type');
  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, { httpMetadata: { contentType } });
  } catch (e) {
    console.error(JSON.stringify({ event: 'assets.put-failed', error: String(e) }));
    return error(HTTP_INTERNAL_ERROR, 'store_failed');
  }
  return Response.json({ assetKey, contentType }, { status: HTTP_CREATED });
}

/**
 * Serves a stored image. Keys never change, so it is cached as immutable; `nosniff` and a CSP
 * that allows nothing make sure the bytes are only ever treated as an image.
 */
export async function handleServe(env: Pick<AssetEnv, 'ASSETS_BUCKET'>, key: string): Promise<Response> {
  if (!isAssetKey(key)) return error(HTTP_NOT_FOUND, 'not_found');
  const object = await env.ASSETS_BUCKET.get(key);
  if (!object) return error(HTTP_NOT_FOUND, 'not_found');
  const contentType = object.httpMetadata?.contentType;
  // Only files this API stored (always with a sniffed image type) are ever served.
  if (!contentType || !(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(contentType)) {
    return error(HTTP_NOT_FOUND, 'not_found');
  }
  return new Response(object.body, {
    status: HTTP_OK,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

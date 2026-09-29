/**
 * Asset upload and serving (story 12, assets.api).
 *
 * Uploads are accepted only for boards that exist, only from the visitor's rate
 * budget, only below IMAGE_MAX_BYTES and only when the *content* sniffs as one of
 * the accepted raster types — the client's `Content-Type` header is never
 * trusted, so a PDF renamed `.png` and an SVG carrying a script are both refused.
 * Nothing is written on any error path.
 *
 * Served assets are immutable (keys are generated once and never reused) and are
 * labelled so a browser can never interpret them as anything but an image.
 */
import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
  ASSET_CACHE_MAX_AGE_SECONDS,
} from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, isAcceptedImageType, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

function error(status: number, reason: string): Response {
  return Response.json({ error: reason }, { status });
}

/** 404 for an unknown or malformed board: the caller learns nothing more. */
function unknownBoard(): Response {
  return error(404, 'not_found');
}

/**
 * `POST /api/boards/:boardId/assets` — store one image for a board.
 *
 * Check order matters: reject malformed ids before spending a rate-limit token,
 * and check the declared length before buffering the body.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return unknownBoard();

  const visitorKey = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.ASSET_UPLOAD_LIMITER.limit({ key: visitorKey });
  if (!success) return error(429, 'rate_limited');

  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) return unknownBoard();

  const declared = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return error(413, 'too_large');
  }

  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) return error(413, 'too_large');

  const contentType = sniffImageType(body.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return error(415, 'unsupported_type');

  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, body, { httpMetadata: { contentType } });
  } catch {
    // A storage failure is reported, never silently swallowed: the client shows
    // "Upload failed" with Retry.
    return error(500, 'storage_failure');
  }

  return Response.json({ assetKey, contentType }, { status: 201 });
}

/**
 * `GET /api/assets/:boardId/:assetId` — serve a stored image.
 *
 * The key must match ASSET_KEY_PATTERN, so `..` can never address anything, and a
 * missing object is a plain 404 the client renders as "Image unavailable".
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  let object: R2ObjectBody | null = null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!object || object.body === null) return new Response('Not found', { status: 404 });

  const stored = object.httpMetadata?.contentType ?? '';
  const contentType = isAcceptedImageType(stored) ? stored : 'application/octet-stream';

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'");
  if (typeof object.size === 'number') headers.set('Content-Length', String(object.size));
  if (object.etag) headers.set('ETag', object.etag);

  return new Response(object.body, { status: 200, headers });
}

/** Split `/api/assets/:boardId/:assetId` into the R2 key. */
export function assetKeyFromUrl(pathname: string): string | null {
  const rest = pathname.slice('/api/assets/'.length);
  const [boardId, assetId, ...extra] = rest.split('/');
  if (!boardId || !assetId || extra.length > 0) return null;
  return assetKeyFor(boardId, assetId);
}

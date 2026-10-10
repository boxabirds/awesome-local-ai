// Story 12 asset API: image upload (`POST /api/boards/:boardId/assets`) and
// serving (`GET /api/assets/:boardId/:assetId`). Uploads are refused unless
// the board exists, the body is ≤ IMAGE_MAX_BYTES and the magic bytes name an
// accepted raster format — Content-Type is ignored for that decision, so a
// disguised file cannot get stored. Stored keys are `<boardId>/<assetId>`
// with both ids 128-bit random, so keys are unguessable; serving is
// immutable and never executed as a document (nosniff + CSP).

import { newBoardId, isValidBoardId } from '../shared/board-id';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
} from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function handleAssetUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // Malformed ids answer the same 404 as unknown boards and never touch the
  // namespace or the bucket.
  if (!isValidBoardId(boardId)) return jsonError(404, 'not_found');

  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) return jsonError(404, 'not_found');

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return jsonError(413, 'too_large');
  }

  // Read fully into memory (≤ 10 MB): the sniffed content decides, the
  // declared Content-Length alone is never trusted for the limit.
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) return jsonError(413, 'too_large');

  const contentType = sniffImageType(body.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return jsonError(415, 'unsupported_media_type');

  const key = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(key, body, { httpMetadata: { contentType } });
  } catch {
    return jsonError(500, 'storage_failure');
  }
  return new Response(JSON.stringify({ assetKey: key, contentType }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

export async function handleAssetServe(
  _req: Request,
  env: Env,
  boardId: string,
  assetId: string,
): Promise<Response> {
  const key = assetKeyFor(boardId, assetId);
  if (!ASSET_KEY_PATTERN.test(key)) return jsonError(404, 'not_found');

  const object = await env.ASSETS_BUCKET.get(key);
  if (object === null || object.body === null) return jsonError(404, 'not_found');

  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}

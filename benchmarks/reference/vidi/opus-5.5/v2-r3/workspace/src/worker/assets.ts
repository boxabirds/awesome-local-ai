// Image storage (story 12, assets.api):
//   POST /api/boards/:boardId/assets   raw body → 201 {assetKey, contentType}
//   GET  /api/assets/:boardId/:assetId the stored bytes, immutable
// The type comes from the body's magic bytes only (never the name or the
// declared Content-Type), and nothing is written on any error path.
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { assetKeyFor, isAssetKey, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

const error = (status: number, code: string) => Response.json({ error: code }, { status });

/** Order of checks: id pattern → exists() → Content-Length → body length → sniff → put. */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return error(404, 'not_found');
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  if (!(await room.exists())) return error(404, 'not_found');

  const declared = req.headers.get('Content-Length');
  if (declared !== null && Number(declared) > IMAGE_MAX_BYTES) return error(413, 'too_large');
  // Read fully (≤ 10 MB) so the type is known before anything is stored.
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > IMAGE_MAX_BYTES) return error(413, 'too_large');

  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (!contentType) return error(415, 'unsupported_type');

  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, { httpMetadata: { contentType } });
  } catch {
    return error(500, 'storage_failed');
  }
  return Response.json({ assetKey, contentType }, { status: 201 });
}

/** Serves a stored image; it can never be sniffed or run as a document. */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!isAssetKey(key)) return error(404, 'not_found');
  const obj = await env.ASSETS_BUCKET.get(key);
  if (!obj) return error(404, 'not_found');
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      ETag: obj.httpEtag,
    },
  });
}

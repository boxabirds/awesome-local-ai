/**
 * Stored images (anchor: assets.api).
 *
 *   POST /api/boards/:boardId/assets   raw image bytes → 201 {assetKey, contentType}
 *                                      404 unknown/malformed board, 413 too large,
 *                                      415 not an accepted image, 429 rate limited, 500 storage
 *   GET  /api/assets/:boardId/:assetId the stored bytes (immutable) / 404
 *
 * Checks run in this order so nothing is written on any error path: id pattern → per-visitor
 * rate limit (ASSET_UPLOAD_LIMITER, keyed by CF-Connecting-IP) → story 5 `exists()` RPC →
 * Content-Length → the body is read fully into memory (≤ IMAGE_MAX_BYTES) → actual length →
 * content sniffing (the client's Content-Type is never used) → one R2 put under an unguessable
 * `<boardId>/<newBoardId()>` key. Served images carry `nosniff` and a `default-src 'none'`
 * policy so a stored file can only ever be an image.
 */
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

const CREATED = 201;
const NOT_FOUND = 404;
const PAYLOAD_TOO_LARGE = 413;
const UNSUPPORTED_MEDIA_TYPE = 415;
const TOO_MANY_REQUESTS = 429;
const INTERNAL_ERROR = 500;

const error = (code: string, status: number) => Response.json({ error: code }, { status });

function visitorKey(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? 'unknown';
}

export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return error('not_found', NOT_FOUND);
  const { success } = await env.ASSET_UPLOAD_LIMITER.limit({ key: visitorKey(req) });
  if (!success) return error('rate_limited', TOO_MANY_REQUESTS);
  if (!(await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists())) return error('not_found', NOT_FOUND);
  const declared = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return error('too_large', PAYLOAD_TOO_LARGE);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > IMAGE_MAX_BYTES) return error('too_large', PAYLOAD_TOO_LARGE);
  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return error('unsupported_type', UNSUPPORTED_MEDIA_TYPE);
  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, { httpMetadata: { contentType } });
  } catch (err) {
    console.error(JSON.stringify({ event: 'assets.put_failed', error: err instanceof Error ? err.message : String(err) }));
    return error('storage_failed', INTERNAL_ERROR);
  }
  return Response.json({ assetKey, contentType }, { status: CREATED });
}

export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return new Response('Not found', { status: NOT_FOUND });
  const object = await env.ASSETS_BUCKET.get(key);
  if (object === null) return new Response('Not found', { status: NOT_FOUND });
  const headers = new Headers({
    'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    ETag: object.httpEtag,
  });
  return new Response(object.body, { headers });
}

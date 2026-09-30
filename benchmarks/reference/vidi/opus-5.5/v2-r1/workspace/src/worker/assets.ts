// Image upload and serving (story 12). Files live in R2 under `<boardId>/<assetId>`; the asset id
// is a fresh 128-bit id (story 5's newBoardId), so image addresses are as unguessable as board links.
import { newBoardId } from '../shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * The whole body, or null as soon as it exceeds `limit` bytes (so an oversized upload without a
 * Content-Length is never buffered completely).
 */
async function readLimited(req: Request, limit: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * POST /api/boards/:boardId/assets. `boardId` is already validated against the id pattern.
 * Checks, in order: board exists → Content-Length → actual size → content type by magic bytes
 * (the request's Content-Type and any file name are ignored) → store. Nothing is written on any
 * error. 201 `{ assetKey, contentType }`; 404 unknown board; 413 too large; 415 not an accepted
 * image; 500 storage failure.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  if (!exists) return json({ error: 'not_found' }, 404);
  const declared = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);
  const bytes = await readLimited(req, IMAGE_MAX_BYTES);
  if (!bytes) return json({ error: 'too_large' }, 413);
  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (!contentType) return json({ error: 'unsupported_type' }, 415);
  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, { httpMetadata: { contentType } });
  } catch (e) {
    console.error(JSON.stringify({ event: 'assets.put-failed', error: String(e) }));
    return json({ error: 'storage_failed' }, 500);
  }
  return json({ assetKey, contentType }, 201);
}

/**
 * GET /api/assets/:boardId/:assetId. Stored images never change, so they are cached for good;
 * `nosniff` and a CSP that allows nothing make sure a stored file is only ever an image.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return new Response('Not found', { status: 404 });
  const object = await env.ASSETS_BUCKET.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(object.size),
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      ETag: object.httpEtag,
    },
  });
}

// Image upload and serving (story 12).
//   POST /api/boards/:boardId/assets   raw image bytes → 201 { assetKey, contentType }
//   GET  /api/assets/:boardId/:assetId the stored bytes, cached forever (keys never change)
//
// The type is decided from the content only (magic bytes), never from the client's Content-Type, so a renamed
// PDF or an SVG (which can carry scripts) is never stored. Nothing is written on any error path. Bodies are at most
// IMAGE_MAX_BYTES and read fully into memory, so the type is known before anything is stored.
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);
  const visitor = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.ASSET_UPLOAD_LIMITER.limit({ key: visitor });
  if (!success) return json({ error: 'rate_limited' }, 429);
  const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  if (!exists) return json({ error: 'not_found' }, 404);
  const declared = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);
  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (!contentType) return json({ error: 'unsupported_type' }, 415);
  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, { httpMetadata: { contentType } });
  } catch (e) {
    console.error(JSON.stringify({ event: 'asset_store_failed', error: e instanceof Error ? e.message : String(e) }));
    return json({ error: 'store_failed' }, 500);
  }
  return json({ assetKey, contentType }, 201);
}

export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return new Response('Not found', { status: 404 });
  const obj = await env.ASSETS_BUCKET.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

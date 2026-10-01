import { isValidBoardId, newBoardId } from '../shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Order of checks: id pattern, board exists, Content-Length, body length, magic bytes, put. Nothing is written on errors. */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);
  if (!(await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists())) return json({ error: 'not_found' }, 404);
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);
  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (!contentType) return json({ error: 'unsupported_type' }, 415);
  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, { httpMetadata: { contentType } });
  } catch (e) {
    console.error(JSON.stringify({ event: 'asset-put-failed', error: e instanceof Error ? e.message : String(e) }));
    return json({ error: 'storage_failed' }, 500);
  }
  return json({ assetKey, contentType }, 201);
}

export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return json({ error: 'not_found' }, 404);
  const obj = await env.ASSETS_BUCKET.get(key);
  if (!obj) return json({ error: 'not_found' }, 404);
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

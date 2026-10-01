import { isValidBoardId, newBoardId } from '../shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

const json = (body: unknown, status: number) => Response.json(body, { status });

export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);
  try {
    if (!(await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists())) return json({ error: 'not_found' }, 404);
  } catch {
    return json({ error: 'unavailable' }, 500);
  }
  const declared = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);
  const contentType = sniffImageType(new Uint8Array(bytes, 0, Math.min(IMAGE_SNIFF_BYTES, bytes.byteLength)));
  if (!contentType) return json({ error: 'unsupported_type' }, 415);
  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, { httpMetadata: { contentType } });
  } catch {
    return json({ error: 'storage_failed' }, 500);
  }
  return json({ assetKey, contentType }, 201);
}

export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return new Response('Not Found', { status: 404 });
  let object: R2ObjectBody | null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch {
    return new Response('Unavailable', { status: 500 });
  }
  if (!object) return new Response('Not Found', { status: 404 });
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

// Image storage (story 12, assets.api): uploads into R2 and immutable serving.
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const notFound = () => json({ error: 'not_found' }, 404);
const tooLarge = () => json({ error: 'too_large' }, 413);

/**
 * `POST /api/boards/:boardId/assets` with the raw file as body. Checks, in order:
 * id pattern → board exists (story 5 RPC) → Content-Length → actual length →
 * type sniffed from the first IMAGE_SNIFF_BYTES (the request's Content-Type is
 * ignored) → R2 put under an unguessable key. Nothing is written on any error.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return notFound();
  let exists: boolean;
  try {
    exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  } catch (error) {
    console.error(JSON.stringify({ event: 'asset-board-check-failed', error: String(error) }));
    return json({ error: 'check_failed' }, 500);
  }
  if (!exists) return notFound();
  const declared = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return tooLarge();
  // Read fully (≤ 10 MB) so the type is known before anything is stored.
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > IMAGE_MAX_BYTES) return tooLarge();
  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (!contentType) return json({ error: 'unsupported_type' }, 415);
  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, { httpMetadata: { contentType } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'asset-store-failed', error: String(error) }));
    return json({ error: 'store_failed' }, 500);
  }
  return json({ assetKey, contentType }, 201);
}

/**
 * `GET /api/assets/:boardId/:assetId`: the stored bytes with their stored type,
 * cached forever (keys never change) and never sniffed or run as a document.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return notFound();
  const object = await env.ASSETS_BUCKET.get(key);
  if (!object) return notFound();
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

import { isValidBoardId, newBoardId } from '../shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

// Story 12 (assets.api): upload with content-based type sniffing and a size
// limit, then serve with immutable caching and no-sniff headers. Order of
// checks per design: id pattern → exists() RPC → Content-Length → body bytes
// → sniff → put. Nothing is written on any error path.

// Story 12 test hook (TC-15): one injected R2 put failure, TEST_HOOKS-gated
// via /__test/fail-r2-put in index.ts. Same-isolate module state, matching
// board-room.ts's armFailInitializeOnce precedent.
let failR2PutOnce = false;

export function armFailR2PutOnce(): void {
  failR2PutOnce = true;
}

async function putAsset(
  env: Env,
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  if (failR2PutOnce) {
    failR2PutOnce = false;
    throw new Error('test hook: R2 put failed');
  }
  await env.ASSETS_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
}

export async function handleUpload(request: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return new Response('image is too large', { status: 413 });
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return new Response('unreadable body', { status: 400 });
  }
  if (bytes.byteLength > IMAGE_MAX_BYTES) {
    return new Response('image is too large', { status: 413 });
  }
  // The client's Content-Type is ignored; the magic bytes decide (image.types).
  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) {
    return Response.json({ error: 'unsupported_type' }, { status: 415 });
  }
  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await putAsset(env, assetKey, bytes, contentType);
  } catch {
    return Response.json({ error: 'storage_failed' }, { status: 500 });
  }
  return Response.json({ assetKey, contentType }, { status: 201 });
}

// Keys never change (content is immutable once stored), so responses cache for
// a year; nosniff + CSP keep a stored file from ever rendering as a document.
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('not found', { status: 404 });
  }
  let object: R2ObjectBody | null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch {
    return Response.json({ error: 'storage_failed' }, { status: 500 });
  }
  if (object === null) {
    return new Response('not found', { status: 404 });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'");
  return new Response(object.body, { headers });
}

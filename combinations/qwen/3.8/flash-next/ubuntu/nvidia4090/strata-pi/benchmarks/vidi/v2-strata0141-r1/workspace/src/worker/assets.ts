import { isValidBoardId } from '../shared/board-id';
import { IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import {
  ACCEPTED_CONTENT_TYPES,
  assetKeyFor,
  cacheControlForAsset,
  isAssetKey,
  sniffImageType,
  type AcceptedImageType,
} from '../shared/image-format';
import type { Env } from './index';

/**
 * The asset API (anchor `assets.api`).
 *
 * ```
 * POST /api/boards/:boardId/assets   body: the file's bytes  -> UploadResult
 * GET  /api/assets/:boardId/:assetId                          -> the bytes
 * ```
 *
 * The board id decides everything. An upload is accepted only for a board that
 * exists (`share.not_found` - the same rule the board API uses), its key is
 * `<boardId>/<assetId>` with the board half validated by `isValidBoardId`, and
 * the bucket is read back by key, never by listing. So one board's assets live
 * under a prefix nothing else can write to, and TC-11's "nothing in R2" is what
 * a refused upload leaves behind.
 *
 * The four rejections an upload can get, in the order they are checked:
 *
 * | order | check | answer |
 * |---|---|---|
 * | 1 | board id malformed or board never created | `404 not_found` |
 * | 2 | more than `IMAGE_MAX_BYTES` | `413 image_too_large` |
 * | 3 | content sniffs to nothing accepted | `415 unsupported_image_type` |
 * | 4 | the bucket refuses the write | `500 asset_store_failed` |
 *
 * Content is trusted only from the magic numbers (`sniffImageType`): the stored
 * content type is the one the sniff answered with, never whatever the client
 * claimed, so a PDF named `.png` is refused rather than stored as a PNG.
 *
 * A stored asset is never overwritten: keys are random per upload and nothing in
 * this codebase writes to an existing key, which is what lets a served asset be
 * cached for `ASSET_CACHE_MAX_AGE_SECONDS` (`image.immutable`). Two uploads that
 * somehow produced the same key are treated as corrupt storage - the second
 * upload is refused rather than silently replacing the first asset some other
 * board's object is already pointing at.
 */

/** What an upload decided. */
export type UploadResult =
  | { ok: true; assetKey: string; contentType: string; bytes: number }
  | { ok: false; status: number; error: string };

const json = (value: unknown, status: number): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Does this board exist? A malformed id never asks a room (`TC-11`). */
async function boardExists(env: Env, boardId: string): Promise<boolean> {
  if (!isValidBoardId(boardId)) {
    return false;
  }
  const namespace = env.BOARD_ROOM;
  return namespace.get(namespace.idFromName(boardId)).exists();
}

/**
 * Store one asset (`assets.api`).
 *
 * Split out from the HTTP wrapper so the storage rule can be exercised with a
 * bucket that refuses writes (TC-15) without pretending a network failure
 * happened.
 */
export async function putAsset(
  env: Env,
  boardId: string,
  bytes: Uint8Array,
): Promise<UploadResult> {
  if (bytes.byteLength > IMAGE_MAX_BYTES) {
    return { ok: false, status: 413, error: 'image_too_large' };
  }

  const type: AcceptedImageType | null = sniffImageType(
    new Uint8Array(bytes.subarray(0, Math.min(bytes.byteLength, IMAGE_SNIFF_BYTES))),
  );
  if (type === null) {
    return { ok: false, status: 415, error: 'unsupported_image_type' };
  }

  const assetKey = assetKeyFor(boardId);
  if (assetKey === null) {
    return { ok: false, status: 400, error: 'invalid_board_id' };
  }

  const contentType = ACCEPTED_CONTENT_TYPES[type];
  try {
    // Keys are random per upload, so an existing key is corrupt storage: refuse
    // rather than overwrite an asset another image may already render from.
    if (await env.ASSETS_BUCKET.head(assetKey)) {
      return { ok: false, status: 500, error: 'asset_key_collision' };
    }
    await env.ASSETS_BUCKET.put(assetKey, bytes.slice(), {
      httpMetadata: { contentType },
      customMetadata: { boardId, format: type },
    });
  } catch {
    // The write failed: the caller's image goes to `failed`, never to a half-state.
    return { ok: false, status: 500, error: 'asset_store_failed' };
  }

  return { ok: true, assetKey, contentType, bytes: bytes.byteLength };
}

/**
 * `POST /api/boards/:boardId/assets` (`assets.api`).
 *
 * The body is the file itself, read here and measured here: a person cannot make
 * a board store a 50 MB file by lying about it in the browser (`TC-12`).
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  if (!(await boardExists(env, boardId))) {
    return json({ ok: false, error: 'not_found' }, 404);
  }

  // The size rule is checked twice, in the order the design names it: the claimed
  // `Content-Length` first, so a request announcing 50 MB is refused without being
  // read, and the byte length of what actually arrived second, because a header
  // is a claim like any other (`TC-12`).
  const claimedHeader = req.headers.get('content-length');
  const claimed = claimedHeader === null ? Number.NaN : Number(claimedHeader);
  if (Number.isFinite(claimed) && claimed > IMAGE_MAX_BYTES) {
    return json({ ok: false, error: 'image_too_large' }, 413);
  }

  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch {
    return json({ ok: false, error: 'unreadable_body' }, 400);
  }

  const result = await putAsset(env, boardId, new Uint8Array(body));
  return json(result, result.ok ? 201 : result.status);
}

/**
 * `GET /api/assets/:boardId/:assetId` (`assets.api`).
 *
 * A key that is not a key and a board that does not exist get the same answer as
 * an asset that is not there - `404`, with no hint about which of the three it
 * was - and the bucket is never asked for anything outside a real key.
 *
 * The response is immutable content: a key is written once, so `max-age` of a
 * year is safe, `X-Content-Type-Options: nosniff` says the type in the header is
 * the type of the bytes, and no `Content-Disposition` is ever sent - a browser
 * asked for a stored asset renders it inline (`image.immutable`).
 */
export async function handleServe(req: Request, env: Env, assetKey: string): Promise<Response> {
  if (!isAssetKey(assetKey)) {
    return json({ error: 'not_found' }, 404);
  }
  const boardId = assetKey.slice(0, assetKey.indexOf('/'));
  if (!(await boardExists(env, boardId))) {
    return json({ error: 'not_found' }, 404);
  }

  const headOnly = req.method === 'HEAD';
  let object: R2Object | R2ObjectBody | null;
  try {
    object = await env.ASSETS_BUCKET.get(assetKey);
  } catch {
    return json({ error: 'asset_store_failed' }, 500);
  }
  if (!object) {
    return json({ error: 'not_found' }, 404);
  }

  const headers = new Headers();
  headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('cache-control', cacheControlForAsset());
  headers.set('x-content-type-options', 'nosniff');
  // These bytes are board-owned and served inline, so nothing in them may load
  // or run anything: the response says this document is only ever a document.
  headers.set('content-security-policy', "default-src 'none'");
  if (object.etag) {
    headers.set('etag', object.etag);
  }
  if (typeof object.size === 'number') {
    headers.set('content-length', String(object.size));
  }
  // `HEAD` gets the same headers and no body; the bytes are not sent twice.
  if (headOnly) {
    return new Response(null, { status: 200, headers });
  }
  const body = 'body' in object ? object.body : null;
  if (body === null) {
    return json({ error: 'not_found' }, 404);
  }
  return new Response(body, { status: 200, headers });
}

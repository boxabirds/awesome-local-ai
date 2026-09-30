// Storing an uploaded image and serving it back (`assets.api`).
//
// Two halves of one promise: nothing that is not a real, in-limit PNG/JPEG/GIF/WebP
// is ever stored, and nothing that *is* stored is ever served as anything but the
// bytes it is. Both halves are defensive in the same direction — they decide from
// the bytes and from a shape-check of the key, and refuse before ever touching the
// bucket when they can — because an image endpoint is exactly where a disguised file
// is aimed.
//
// The order of the upload checks is the design's, and it is not arbitrary
// (design.md, "Asset upload and serving API"):
//
//   board id shape → `exists()` RPC → `Content-Length` → read the body →
//   actual byte length → sniff the magic bytes → put.
//
// Checking `Content-Length` before reading means an oversized upload is refused
// without being held in memory at all; reading the body and *then* checking its true
// length catches a lie in that header; sniffing only after the size is settled means
// a huge non-image never reaches the type check with its whole self in memory first.
// Nothing is written on any of the error paths (TC-11, TC-12, TC-13).
//
// Serving is the mirror: an asset key is checked against `ASSET_KEY_PATTERN` before
// the bucket is asked, so `../x` and a wrong-length id are refused without a lookup
// (TC-16); a stored object is served with the type it was stored under, a one-year
// `immutable` cache (keys never change), `nosniff` and `Content-Security-Policy:
// default-src 'none'` so a stored file can never be read as a script, a document or
// anything else — an image, or nothing.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Asset upload and
// serving API".
import type { Env } from './index';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_SNIFF_BYTES } from '../shared/config';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  sniffImageType,
} from '../shared/image-format';
import type { BoardRoom } from './board-room';

/** Every `/api/` reply is `no-store`; an upload's answer is never cacheable. */
const json = (body: unknown, status: number): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** The single "this is not here" answer, for a malformed id or an unknown board. */
const notFound = (): Response => json({ error: 'not_found' }, 404);

/**
 * Store one uploaded image for `boardId`, and answer the upload with the key it is
 * stored under. Never trusts `Content-Type` or the file's name: the type is the
 * bytes, or there is no type and no store.
 */
export async function handleUpload(
  request: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  // A malformed board address is not a board, and no object is woken for it — the
  // same rule, and the same 404, as the board-existence API (share.not_found).
  if (!isValidBoardId(boardId)) return notFound();

  // Only a board that exists can receive uploads (TC-11): an upload to a board
  // nobody created has nowhere to live, and must not quietly make one. This is the
  // read-only existence RPC — it neither creates tables nor loads a document.
  let exists: boolean;
  try {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)) as DurableObjectStub<BoardRoom>;
    exists = await stub.exists();
  } catch (error) {
    console.error('[vidi6] asset upload existence check failed', { error: String(error) });
    return json({ error: 'lookup_failed' }, 500);
  }
  if (!exists) return notFound();

  // The cheap size check first: a body this big would not be accepted, so a request
  // that declares it is over the limit is refused without its bytes being read at
  // all (image.size_limit on the server, TC-12).
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  // Then the real length. A `Content-Length` that lied is caught here, before the
  // body is sniffed, stored or even fully reasoned about.
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  // The type is decided here, from the leading bytes, and nowhere else (TC-13): an
  // SVG, a PDF renamed `.png`, or anything without an accepted signature gets 415
  // and is not stored — whatever header it arrived with.
  const sniffed = sniffImageType(body.subarray(0, IMAGE_SNIFF_BYTES));
  if (sniffed === null) {
    return json({ error: 'unsupported_type' }, 415);
  }

  // Accepted: store it under an unguessable key. The asset id is a fresh board id
  // (128 bits), so the asset's address is as unguessable as the board's.
  const key = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType: sniffed },
    });
  } catch (error) {
    // The only failure left is storage itself (TC-15): the bytes were fine and the
    // bucket said no. Nothing was written; the client shows a failed upload.
    console.error('[vidi6] asset storage failed', { reason: 'store_failed', error: String(error) });
    return json({ error: 'store_failed' }, 500);
  }

  // 201 with the *permanent* key: this is what `markImageReady` stores and what the
  // image's `<img>` points at, unchanged, for as long as the board lives.
  return json({ assetKey: key, contentType: sniffed }, 201);
}

/**
 * Serve a stored image by its key. A key that is not the shape of a key is refused
 * without a bucket lookup (so `../` cannot reach outside a board); a key that is
 * well-shaped but not there is the same 404. A key that is there is served as an
 * image and nothing else — never sniffed, never interpreted (TC-16).
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return notFound();

  let object: R2ObjectBody | null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch (error) {
    console.error('[vidi6] asset read failed', { error: String(error) });
    return json({ error: 'read_failed' }, 500);
  }
  if (object === null) return notFound();

  const stored = object.httpMetadata?.contentType;
  const contentType = typeof stored === 'string' && stored.length > 0 ? stored : 'application/octet-stream';

  // The body is a stream and is handed straight to the response — reading it whole
  // would hold a 10 MB image in memory for something that only needs passing
  // through. `immutable` because an asset key is written once and never reused: the
  // same key is the same bytes for the life of the board, which is the one thing
  // that makes a year-long cache honest.
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      // Whatever these bytes are, the browser is told they are only ever an image:
      // no scripts, no frames, no same-origin document (TC-16, security).
      'Content-Security-Policy': "default-src 'none'",
      ...(object.size !== undefined ? { 'Content-Length': String(object.size) } : {}),
    },
  });
}

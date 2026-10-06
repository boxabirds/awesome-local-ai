/**
 * Storing and serving the images a board holds (story 12).
 *
 * Two routes, both deliberately unglamorous: a POST that puts at most ten megabytes of pixels into
 * R2 under an address nobody can guess, and a GET that hands those bytes back with the headers that
 * keep a browser from ever treating them as anything else.
 *
 * What the file is *not* is a place where a name, a `Content-Type` or a person's intention counts.
 * The order of decisions is fixed:
 *
 * 1. is the board address even a board address?  If not, `404` - and no Durable Object is created
 *    for it, so a probe cannot make work;
 * 2. does this board exist?  Only a board that exists can receive uploads, so `404` if not;
 * 3. is the body too big?  `Content-Length` answers without reading anything, and the real byte
 *    length answers for a request that lied about it: `413`, nothing written;
 * 4. what are these bytes?  The first `IMAGE_SNIFF_BYTES` decide (`415` for anything that is not
 *    PNG, JPEG, GIF or WebP - which is what stops a PDF renamed `.png` and an SVG carrying a script);
 * 5. only now is anything written. A failure of the write is `500`, and there is nothing to clean
 *    up, because nothing was written.
 *
 * Serving is the mirror image: the key must be exactly two board-style addresses, so `../` and
 * friends never reach the bucket; the response repeats the type the bytes were accepted as, tells
 * the browser not to sniff, and forbids everything the document could do with them. The address of a
 * stored image never changes, so it may be cached for a year and never re-asked.
 */
import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
} from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

/** A short JSON body: the client decides what to say from the status, not from this. */
function errorResponse(status: number, reason: string): Response {
  return Response.json({ error: reason }, { status });
}

/**
 * `POST /api/boards/:boardId/assets` - store one image that belongs to one board.
 *
 * The body is the raw file. Whatever `Content-Type` the browser sent is ignored on purpose: it is
 * the bytes that decide, and they are read once, into memory, because a ten-megabyte ceiling is
 * what makes that safe.
 */
export async function handleUpload(request: Request, env: Env, boardId: string): Promise<Response> {
  // 1. a malformed address never reaches the namespace, so it never creates an instance
  if (!isValidBoardId(boardId)) return errorResponse(404, 'not_found');

  // 2. only a board that exists can receive uploads (the same rule that gates opening one)
  let exists = false;
  try {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    exists = await stub.exists();
  } catch {
    return errorResponse(500, 'storage_failure');
  }
  if (!exists) return errorResponse(404, 'not_found');

  // 3. too big: the header first, because it costs nothing to read
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return errorResponse(413, 'too_large');
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) return errorResponse(413, 'too_large');

  // 4. the bytes decide what this is - a PDF renamed `.png` and an SVG both stop here
  const contentType = sniffImageType(body.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return errorResponse(415, 'unsupported_type');

  // 5. write it, under an address nobody can guess and nobody will ever reuse
  const key = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(key, body, { httpMetadata: { contentType } });
  } catch {
    return errorResponse(500, 'storage_failure');
  }

  return Response.json({ assetKey: key, contentType }, { status: 201 });
}

/**
 * `GET /api/assets/:boardId/:assetId` - hand back one stored image.
 *
 * `404` covers both "that is not an address" and "nothing is there", so the route gives nothing away
 * about which boards exist or which images they hold.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return errorResponse(404, 'not_found');

  let object: R2ObjectBody | null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch {
    return errorResponse(500, 'storage_failure');
  }
  if (!object) return errorResponse(404, 'not_found');

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // the address of a stored image never changes, so a cached copy is never stale
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      // ...and a browser must never decide for itself what these bytes are
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      ETag: `"${object.etag ?? object.version}"`,
    },
  });
}

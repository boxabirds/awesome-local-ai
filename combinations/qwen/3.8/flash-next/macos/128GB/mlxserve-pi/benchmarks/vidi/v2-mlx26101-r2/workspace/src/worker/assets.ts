/**
 * The asset API (`src/worker/assets.ts`).
 *
 * Two handlers, one file: an upload that puts an image in R2 and a serve that gives it
 * back. They live here rather than in the board's Durable Object because they have
 * nothing to do with the document: an upload is not an update, it is not replayed to
 * anybody, and it is not part of anybody's history. It is an ordinary HTTP request to a
 * bucket, made by whoever happens to be holding the file, and the object does not have
 * to be awake for anybody to look at a picture.
 *
 * ## What this file is the only place in the product that enforces
 *
 * The browser refuses an SVG, a PDF and an 11 MB file first, but a browser is not a
 * boundary and this Worker is not allowed to know that. So:
 *
 * 1. **What a file is comes from the file.** `File.type` and `Content-Type` are claims a
 *    sender makes about a body; a server that repeats them is a server that will serve a
 *    PDF, an SVG carrying a script, or an HTML page wearing a PNG's name - from *this
 *    product's own origin*, next to the board where somebody is typing. `sniffImageType`
 *    reads the signature, and that answer is what goes into the bucket and onto the wire.
 *    A file that is not one of the four types is never stored, so there is no object left
 *    behind to come back later.
 * 2. **A key is never looked up, only checked.** `GET /api/assets/:boardId/:assetId`
 *    matches the *shape* of what it was given before it touches the bucket, and the first
 *    half of the key is the board. There is no listing, no enumeration and no "did you
 *    mean": 128 bits behind the asset id is what makes that enough, because the answer to
 *    a key nobody was given is the same answer as the answer to a key that does not exist,
 *    and it costs the same to give.
 *
 * ## What this file does not do
 *
 * No authorisation, and that is a decision rather than an omission: the PRD's access
 * model is that anybody with the board link can see its images, so a route that asked who
 * was uploading would be a route that could not be used by the person who already has the
 * link. What it *is* a gate on is what may be stored at all - which is the half with a
 * security consequence. `X-Content-Type-Options: nosniff` and
 * `Content-Security-Policy: default-src 'none'` are the same thinking one level down: a
 * stored file is a picture and nothing else, and a browser that is told so will not decide
 * otherwise on its own.
 */

import type { Env } from './index.js';
import { newBoardId, isValidBoardId } from '../shared/board-id.js';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config.js';
import { assetKeyFor, isAssetKey, sniffImageType } from '../shared/image-format.js';

/**
 * The body of a file this Worker will not store, in the words it answers with.
 *
 * `415`: the bytes are not one of the four accepted types. A PDF renamed `holiday.png`
 * gets this, and so does an SVG that says `image/png` in its `Content-Type` - which is
 * the whole reason the code exists: a file that can carry a script must never be one of
 * the things this origin serves.
 */
const unsupported = (): Response => json({ error: 'unsupported_type' }, 415);

const notFound = (): Response => json({ error: 'not_found' }, 404);
const tooLarge = (): Response => json({ error: 'too_large' }, 413);
const storageFailed = (): Response => json({ error: 'storage_failed' }, 500);

/** A JSON error, in the one shape this Worker's API has: a code, and no detail. */
const json = (body: { error: string }, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * `POST /api/boards/:boardId/assets` - store one file, and say where it went.
 *
 * The order of the checks is the order of their cost, and it is also the order in which
 * an answer can be given without being rude about the asker:
 *
 * ```
 * id shape → exists() → Content-Length → read → byte length → sniff → put
 * ```
 *
 * An id that is not an id is answered without waking anything up; an unknown board is
 * answered by the object that owns the board (story 5's rule, applied to uploads by the
 * PRD's "only boards that exist can receive uploads"); the size is refused before a byte
 * of a large body is copied anywhere; and only then is the body read, because the type
 * decision needs the bytes and there is no cheaper way to ask. Nothing is written on any
 * of the error paths - there is no partial object, no temporary key and nothing to clean
 * up afterwards, which is what makes "an SVG cannot be stored" true rather than likely.
 */
export async function handleUpload(request: Request, env: Env, boardId: string): Promise<Response> {
  if (request.method !== 'POST') {
    // The path is a collection you post to; everything else is a question this route
    // does not answer. Images are read by their own route, never from here.
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (!isValidBoardId(boardId)) {
    // The same answer as an unknown board, for the same reason as `GET /api/boards/:id`:
    // a stranger is not being taught what a board id is worth.
    return notFound();
  }

  // Story 5's existence check, which is the board's own answer and not this Worker's
  // guess: a board nobody created cannot receive an image, so the file is never stored
  // and there is nothing to come back later.
  let exists: boolean;
  try {
    exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  } catch (error) {
    // The service did not answer the question, which is not the same as the board not
    // being there - and one of them is worth retrying, so the two get different codes.
    console.error('[worker] the board check for an upload could not run', { error: String(error), boardId });
    return storageFailed();
  }
  if (!exists) return notFound();

  // `image.size_limit`, asked of the header first. An 11 MB upload is refused without
  // this Worker ever holding 11 MB in memory, which matters because the person on the
  // other end of it is on a laptop with a bad connection and not on a test machine.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return tooLarge();

  let body: Uint8Array;
  try {
    body = new Uint8Array(await request.arrayBuffer());
  } catch (error) {
    // The connection went away, or there was no body at all. There is no file here and
    // nothing was written either way: an upload that could not be read is not an upload
    // that half-happened.
    console.error('[worker] an upload body could not be read', { error: String(error), boardId });
    return json({ error: 'invalid_body' }, 400);
  }

  // ...and then of the body, because a `Content-Length` is also a claim. The two checks
  // are the same rule asked of two different witnesses, and the one that cannot lie is
  // the one that has to be right.
  if (body.byteLength > IMAGE_MAX_BYTES) return tooLarge();

  // The type, from the file rather than from its name, its header or its extension.
  const contentType = sniffImageType(body.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return unsupported();

  // 128 bits of randomness from the same generator the board links use, so a stored
  // address is as unguessable as a board address - and so that a key can be served by
  // checking it instead of by looking it up.
  const key = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(key, body, {
      // What the bytes are, decided from the bytes just above. This is the only copy of
      // that decision that is ever kept: the serve route reads *this* value back out, so
      // the type a browser is served cannot drift from the fact that made the file
      // acceptable in the first place.
      httpMetadata: { contentType },
    });
  } catch (error) {
    // The bucket did not answer, which is not the same as the file being refused: one of
    // them is "make it smaller" or "that is not an image" and the other is "try again",
    // and the person holding the file has to be told which.
    console.error('[worker] an image could not be stored', { error: String(error), boardId });
    return storageFailed();
  }

  return json({ assetKey: key, contentType }, 201);
}

/**
 * `GET /api/assets/:boardId/:assetId` - the file, or the answer that there is none.
 *
 * Only ever a lookup of a key whose shape has already been proved. A miss and a
 * malformed key get the same 404 and the same body, and nothing in either answer says
 * which of the two it was.
 *
 * The headers are the part of this route that has a security consequence, and they are
 * the same for every 200 whatever the file turned out to be:
 *
 * - `Content-Type` is the value stored beside the object, which is the signature-based
 *   decision that let the file in. It is never recomputed from the key, because a name
 *   is not evidence about content.
 * - `X-Content-Type-Options: nosniff` stops a browser from changing its mind about that
 *   type. A browser that inspects bytes and decides they are HTML is a browser that will
 *   run them, and this origin serves the board.
 * - `Content-Security-Policy: default-src 'none'` is the same rule with a hammer behind
 *   it: this document is a picture, it loads nothing, and it runs nothing.
 * - `Cache-Control: ... immutable` is honest only because a key belongs to exactly one
 *   file, written once by the route above, and nothing in this product rewrites one.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!isAssetKey(key)) {
    // Checked before the bucket is touched. This is also the check that makes
    // `/api/assets/../../etc/passwd` a 404 rather than a lookup, and the reason a path
    // can never name another board's file: the first half of a key is a board id, and a
    // key that does not have exactly that shape names nothing.
    return notFound();
  }

  let object: R2Object | null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch (error) {
    // The bucket did not answer. A 500 and not a 404: "there is no such image" and "I
    // could not tell you" are different answers, and one of them is worth a reload while
    // the other is a permanent state of a board.
    console.error('[worker] an image could not be read', { error: String(error), key });
    return storageFailed();
  }
  if (object === null) return notFound();

  const contentType = object.httpMetadata?.contentType;
  const headers = new Headers({
    // An object this Worker did not write has no stored type, and the honest answer about
    // bytes nobody has looked at is the type that promises nothing. With `nosniff` below it
    // will not be drawn as an image, which is the right outcome for an object that this
    // product cannot say anything about.
    'content-type': typeof contentType === 'string' && contentType.length > 0 ? contentType : 'application/octet-stream',
    'cache-control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
    // The board page and its images are one origin, and an `<img>` needs no permission to
    // draw one; the story 17 exporter is the other reader, and it is reading these bytes
    // from somewhere else.
    'access-control-allow-origin': '*',
  });
  return new Response(object.body, { status: 200, headers });
}

/**
 * The key a `/api/assets/...` path names, or `null` when it names nothing.
 *
 * The path is kept as the URL gave it: a `%2F` inside a path segment stays escaped there,
 * so a key that was built by smuggling a slash into one half of it fails the pattern here
 * rather than being decoded into a valid-looking one. Decoding a path and *then* judging
 * it would be a check of what the caller meant rather than of what the bucket was asked
 * for, and those are not the same question.
 */
export function keyFromAssetPath(pathname: string): string | null {
  if (!pathname.startsWith(ASSET_PATH_PREFIX)) return null;
  const key = pathname.slice(ASSET_PATH_PREFIX.length);
  return isAssetKey(key) ? key : null;
}

/** The prefix of the serving route; everything after it is the key. */
export const ASSET_PATH_PREFIX = '/api/assets/';

/**
 * Is this path in the image namespace at all? Used for one answer: "there is no such
 * image", as JSON. Everything under `/api/assets/` belongs to this Worker, so a path in
 * it that is not a well-formed key is not handed to the client assets - which would reply
 * with the app page, and an HTML page served as the answer to a request for an image is a
 * broken image that cannot be told apart from one that arrived and would not decode.
 */
export const isAssetPath = (pathname: string): boolean =>
  pathname === '/api/assets' || pathname.startsWith(ASSET_PATH_PREFIX);

/**
 * The board an upload path names, or `null` when the path is not an upload route.
 *
 * Deliberately not validated here: the shape is checked by {@link handleUpload}, against
 * the same rule as every other board-id route, so that a path can be routed without this
 * file having an opinion about what makes an id.
 */
export function boardIdOfUploadPath(pathname: string): string | null {
  if (!pathname.startsWith(BOARD_PATH_PREFIX) || !pathname.endsWith(ASSET_UPLOAD_SUFFIX)) return null;
  const boardId = pathname.slice(BOARD_PATH_PREFIX.length, pathname.length - ASSET_UPLOAD_SUFFIX.length);
  // A path of `/api/boards//assets` names no board, and neither does one with a slash in
  // the middle of the id: whatever it is, it is not an upload for a board.
  if (boardId.length === 0 || boardId.includes('/')) return null;
  return boardId;
}

/** The board collection's own path, and the prefix of one board's paths. */
const BOARD_PATH_PREFIX = '/api/boards/';

/** The suffix of the upload route: `POST /api/boards/:boardId/assets`. */
const ASSET_UPLOAD_SUFFIX = '/assets';

/*! Image assets: the upload and the serve (story 12).
 *
 * Two handlers, one per route:
 *
 *   `POST /api/boards/:id/assets`        → {@link handleUpload}, which puts bytes
 *                                          away and answers with the key they were
 *                                          put away under
 *   `GET /api/assets/:boardId/:assetId`  → {@link handleServe}, which gives those
 *                                          bytes back to whatever board points at
 *                                          them
 *
 * Three rules hold both ends together, and they are the story:
 *
 * - **The key is made here.** A client is *given* a key; it never chooses one. The
 *   name a file was dropped with is something the board was told rather than a
 *   fact about the board, so it is never used: the key is `<boardId>/<assetId>`
 *   with a fresh id, which is what stops one board's bytes being reachable by
 *   guessing at another's names (TC-14).
 * - **The type comes from the bytes.** What is stored is labelled with what the
 *   bytes said they were, never with what the request claimed — so what is later
 *   served is an image because it *is* one, and never whatever a client happened
 *   to say (TC-13, TC-16).
 * - **A board that is not there may not be written to.** An upload is refused
 *   with 404 unless the room for that id answers that the board exists, and it is
 *   asked before a byte is stored (TC-14).
 */
import type { Env } from './index';
import type { BoardRoom } from './board-room';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  ASSETS_PATH_PREFIX,
  BOARDS_PATH,
  BOARD_ASSETS_SUFFIX,
} from '../shared/routes';
import {
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
  ASSET_CACHE_MAX_AGE_SECONDS,
} from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';

/** An error the board can put into words, and the status that says it. */
function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/** Percent-decoding which refuses to throw on a malformed escape. */
function decodeOrNothing(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * Which board's asset collection a path names, or null when it names none.
 *
 * `POST /api/boards/x/assets` names board `x`. The id is left exactly as it came
 * and checked later by `isValidBoardId`, because a path is not the place to decide
 * what an id is.
 */
export function assetsBoardOf(pathname: string): string | null {
  if (!pathname.startsWith(`${BOARDS_PATH}/`)) return null;
  const rest = pathname.slice(BOARDS_PATH.length + 1);
  if (!rest.endsWith(BOARD_ASSETS_SUFFIX)) return null;
  return decodeOrNothing(rest.slice(0, rest.length - BOARD_ASSETS_SUFFIX.length));
}

/** The `<boardId>/<assetId>` a serve path names, or null when it names nothing. */
export function assetKeyOf(pathname: string): string | null {
  if (pathname !== ASSETS_PATH_PREFIX && !pathname.startsWith(`${ASSETS_PATH_PREFIX}/`)) {
    return null;
  }
  return decodeOrNothing(pathname.slice(ASSETS_PATH_PREFIX.length + 1));
}

/**
 * `POST /api/boards/:id/assets`: put the body's bytes away and answer 201 with the
 * key they are kept under.
 *
 * The order of the checks is the order of the story's requirements, and each
 * answer names which one refused:
 *
 *   404  no such board — asked of the room rather than of the bucket, and asked
 *        before anything is stored, so writing to a board that does not exist
 *        leaves nothing behind (TC-14)
 *   413  bigger than `IMAGE_MAX_BYTES`. The `Content-Length` a request brings is
 *        believed when it is there — a forty-megabyte file is refused without
 *        being read at all — and the bytes actually counted have the last word,
 *        because a length header is a claim rather than a measurement
 *        (TC-12, TC-18)
 *   415  the bytes do not say PNG, JPEG, GIF or WebP: a PDF wearing a `.png` name,
 *        an SVG with a script in it, three bytes of nothing (TC-13)
 *   500  the store itself refused. Not the client's fault, and saying so in words
 *        is what lets the board say *upload failed* rather than nothing (TC-15)
 *   201  kept, with `{ assetKey }` and nothing else — where bytes went is between
 *        the board and its bucket
 */
export async function handleUpload(
  request: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  if (!isValidBoardId(boardId)) return jsonError('board_not_found', 404);

  // The room is what knows whether a board exists. This is one small call rather
  // than a load of the whole document, and it happens before anything is stored.
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)) as unknown as BoardRoom;
  let exists: boolean;
  try {
    exists = await room.exists();
  } catch {
    // The room could not be reached, so nothing was stored. Saying that is better
    // than storing bytes which no board would ever be able to load.
    return jsonError('room_unavailable', 503);
  }
  if (!exists) return jsonError('board_not_found', 404);

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return jsonError('image_too_large', 413);
  }

  const body = new Uint8Array(await request.arrayBuffer());
  // Measured rather than believed: a request can claim whatever length it likes.
  if (body.byteLength > IMAGE_MAX_BYTES) return jsonError('image_too_large', 413);
  if (body.byteLength === 0) return jsonError('unsupported_image_type', 415);

  const contentType = sniffImageType(body.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return jsonError('unsupported_image_type', 415);

  const key = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(key, body, { httpMetadata: { contentType } });
  } catch {
    // The bucket is the one part of this request the board cannot put right, and
    // it is no reason to tell the person waiting that their file was bad.
    return jsonError('asset_store_unavailable', 500);
  }

  return Response.json({ assetKey: key, contentType }, { status: 201 });
}

/**
 * `GET /api/assets/:boardId/:assetId`: the bytes, with a type that says what they
 * are and headers that say nobody may be sent a second copy.
 *
 * The key is checked against `ASSET_KEY_PATTERN` before it is used — checked, not
 * rewritten to be safe, because there is nothing legitimate in a key that the
 * pattern leaves out. It is two id-length segments and nothing else, so it cannot
 * be `..`, cannot be another board's bytes, and cannot name a place in a bucket
 * that was never meant to hold any (TC-16).
 *
 * An asset is not secret and not owned: whether you see the picture is decided by
 * whether you can see the board that points at it, which is why this route has no
 * auth of its own and why an `<img>` tag needs none.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return jsonError('asset_not_found', 404);

  let object: R2ObjectBody | null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch {
    return jsonError('asset_store_unavailable', 500);
  }
  if (object === null) return jsonError('asset_not_found', 404);

  // What is served is typed by what was sniffed on the way in, so a stored image
  // is served as an image and the browser is never left to guess from the bytes.
  const stored = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const headers = new Headers({
    'content-type': stored,
    // A key is never pointed at new bytes, so a browser may keep this for as long
    // as it likes and never trouble the board about it again.
    'cache-control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    // The bytes are somebody's picture. What a browser makes of a response is to
    // be decided by the type it is given, not by what turns out to be inside it.
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'none'",
    'referrer-policy': 'no-referrer',
  });
  if (Number.isFinite(object.size)) headers.set('content-length', String(object.size));

  return new Response(object.body, { status: 200, headers });
}

/**
 * Storing and serving the pictures on the board (story 12).
 *
 * An image is the one thing in this product that is too big to be a document field, so its bytes live in R2
 * and the board only ever holds the key. That split gives this file two jobs, and the rules in each of them
 * come from the fact that the bytes came from outside:
 *
 *  1. **An upload is judged by its bytes.** Not the file name, not `Content-Type` — a PDF renamed `.png`
 *     arrives with a header that says `image/png` and a body that says `%PDF`. The first
 *     `IMAGE_SNIFF_BYTES` of the body are what decide, and nothing is written before they have been read
 *     (image.types).
 *  2. **A stored picture is handed back and never interpreted.** The key is unguessable and never rewritten,
 *     so the response can be cached for a year and must simultaneously promise that it is not a document:
 *     `nosniff` and `default-src 'none'` are what keep a file that was uploaded by a stranger from ever
 *     becoming script on this origin (image.unavailable, TC-16).
 *
 * Nothing here writes on an error path: a refused upload leaves no object behind, which is what lets the
 * integration tests assert "nothing in R2" instead of "nothing we noticed".
 */
import { IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES, ASSET_CACHE_MAX_AGE_SECONDS, isAcceptedImageType } from '../shared/config';
import type { AcceptedImageType } from '../shared/config';
import { ASSET_KEY_PATTERN, sniffImageType } from '../shared/image-format';
import { newBoardId } from '../shared/board-id';
import { isValidBoardId } from '../shared/board-id';
import type { Env } from './board-room';

/** What a key that is not one, a board that is not one, and a picture that was never stored all say. */
const NOT_FOUND = { error: 'not_found' };
/** What a body too large to store says. */
const TOO_LARGE = { error: 'too_large' };
/** What a body that is not one of the four pictures this board can draw says. */
const UNSUPPORTED_TYPE = { error: 'unsupported_type' };
/** What a storage call that did not answer says. It is not "nothing was stored": it is "this cannot say". */
const STORAGE_FAILED = { error: 'storage_failed' };

/** A new asset id: the same 22 random base64url characters a board address is made of. */
function newAssetId(): string {
  return newBoardId();
}

/**
 * Store the picture in this request's body, and say where it went.
 *
 * The order of the checks is the order of their cost, and it is also a small piece of policy:
 *
 *   - the board id is matched against its own pattern before anything is looked up, so a probe of a thousand
 *     malformed addresses never names a room object;
 *   - the board is asked whether it exists, because a picture uploaded against an address nobody made has no
 *     board to belong to (TC-11) — and this is a read, so an upload creates no board;
 *   - `Content-Length` is checked before the body is read at all, so an oversize request is refused without
 *     being buffered;
 *   - the real length is checked again after reading, because `Content-Length` is a promise and the body is
 *     the fact;
 *   - the type is sniffed from the bytes and only then is anything stored, so a 415 leaves nothing behind.
 */
export async function handleUpload(request: Request, env: Env, boardId: string): Promise<Response> {
  if (request.method !== 'POST') {
    // There is nothing at this address to read, replace or delete: a picture is put once and then lives at
    // its own key forever.
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }
  if (!isValidBoardId(boardId)) return Response.json(NOT_FOUND, { status: 404 });

  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  let exists: boolean;
  try {
    exists = await room.exists();
  } catch (error) {
    // The board may or may not exist; what is certain is that this upload cannot be accepted without asking.
    console.error(`store-asset: could not ask about ${boardId}: ${message(error)}`);
    return Response.json(STORAGE_FAILED, { status: 500 });
  }
  if (!exists) return Response.json(NOT_FOUND, { status: 404 });

  const declared = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return Response.json(TOO_LARGE, { status: 413 });
  }

  let body: Uint8Array;
  try {
    body = new Uint8Array(await request.arrayBuffer());
  } catch (error) {
    // The body never arrived, or stopped arriving. Nothing was read and nothing can have been stored.
    console.error(`store-asset: ${boardId}: the request body did not arrive: ${message(error)}`);
    return Response.json({ error: 'unreadable_body' }, { status: 400 });
  }

  // The declared length was a promise; this is the byte count, and it is the one that decides.
  if (body.byteLength > IMAGE_MAX_BYTES) return Response.json(TOO_LARGE, { status: 413 });

  const contentType = sniffImageType(body.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) {
    // Includes SVG: an image the browser can show is not necessarily an image this board can draw, and an
    // XML document is the one thing least worth storing from a board that draws pictures.
    return Response.json(UNSUPPORTED_TYPE, { status: 415 });
  }

  const assetKey = `${boardId}/${newAssetId()}`;
  try {
    await env.ASSETS_BUCKET.put(assetKey, body, { httpMetadata: { contentType } });
  } catch (error) {
    // A storage failure is not a bad upload: the file is fine, and the person can try again.
    console.error(`store-asset: could not store ${assetKey}: ${message(error)}`);
    return Response.json(STORAGE_FAILED, { status: 500 });
  }

  // The key is the permanent address of this picture, and it is what the board stores in its document.
  return Response.json({ assetKey, contentType }, { status: 201 });
}

/**
 * Hand back a stored picture.
 *
 * The key is checked against its own pattern rather than split and re-joined, so a path that contains `..`,
 * an escaped slash or an extra segment is simply not a key and gets the same answer as a picture nobody
 * stored. The type comes from what was stored with the bytes — never from the key, and never sniffed again —
 * and the two headers that matter are here to make "it is a picture" a promise the browser does not have to
 * guess at.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return Response.json(NOT_FOUND, { status: 404 });

  let stored: R2ObjectBody | null;
  try {
    stored = await env.ASSETS_BUCKET.get(key);
  } catch (error) {
    // "Could not look it up" is not "does not exist", and pretending otherwise would tell a board that a
    // picture it has already stored is gone.
    console.error(`serve-asset: could not read ${key}: ${message(error)}`);
    return Response.json(STORAGE_FAILED, { status: 500 });
  }
  if (stored === null) return Response.json(NOT_FOUND, { status: 404 });

  const storedType = stored.httpMetadata?.contentType;
  // A type this board did not write is not a type it will re-serve as an image: an empty body with an honest
  // 404 is better than a byte stream wearing a lie.
  if (!isAcceptedImageType(storedType)) {
    console.error(`serve-asset: ${key} is stored with the type ${JSON.stringify(storedType)}, which is not one of ours`);
    return Response.json(NOT_FOUND, { status: 404 });
  }
  const contentType = storedType as AcceptedImageType;

  const headers = new Headers({
    'Content-Type': contentType,
    // The key is chosen once, at upload, and never rewritten — which is the only reason a year is a safe
    // max-age, and the reason `immutable` is in it rather than a validator.
    'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    // Two ways of being misunderstood as something else, both closed: the browser does not guess a
    // different type, and this response is never a document with scripts in it.
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  });
  const size = typeof stored.size === 'number' ? String(stored.size) : undefined;
  if (size !== undefined) headers.set('Content-Length', size);

  return new Response(stored.body, { status: 200, headers });
}

/** An error's own words, or the words for something that threw a string. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

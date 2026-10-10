import { newBoardId, isValidBoardId } from '../shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { assetKeyFor, isAssetKey, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

/**
 * The asset routes: bytes in, bytes out (`image.storage.serving`).
 *
 * Both ends of this are the same question — *is this a picture?* — and only one of them is
 * asked by a browser. A person's client can check a `File` and be lying about it; so can a
 * script that found this endpoint. So the checks below are ordered by what they cost and none
 * of them trusts the request beyond the byte count: the board has to exist before anything is
 * written in its name, the bytes have to identify themselves as a picture before they are
 * stored, and the body is read fully into memory first, so the choice is made before anything
 * is written rather than after (`image.types.security`).
 *
 * What comes out the other end is served with its type fixed by this module rather than by
 * what it is named, and with headers that say "do not run this" — because the alternative is
 * a board that can host content from its own origin.
 */

/** A board's assets live under its own id, so one board cannot be read out of another's key. */
function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

function tooLarge(): Response {
  return new Response(JSON.stringify({ error: 'too_large' }), {
    status: 413,
    headers: { 'content-type': 'application/json' },
  });
}

function unsupportedType(): Response {
  return new Response(JSON.stringify({ error: 'unsupported_type' }), {
    status: 415,
    headers: { 'content-type': 'application/json' },
  });
}

/** A 404 with no body: an `<img>` cannot show one, and the board draws its own message. */
function missing(): Response {
  return new Response(null, { status: 404 });
}

function storageFailed(): Response {
  return new Response(JSON.stringify({ error: 'storage_failed' }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `POST /api/boards/:boardId/assets` — store one image in one board.
 *
 * The order of the checks is the order of their cost: a bad id is a regex, an unknown board
 * is one call to a room that is probably awake, `Content-Length` is a header, reading the
 * body is the only expensive one, and it happens before the sniff that decides the file's
 * fate. Nothing is written on any failure path — a board's bucket holds only images, so
 * nobody has to wonder what a 40 MB file under a random key was.
 */
export async function handleUpload(request: Request, env: Env, boardId: string): Promise<Response> {
  // A malformed id and an unknown one get the same answer story 5 gave: 404, no detail. A
  // malformed id must not reach the namespace at all, or guessing would create objects.
  if (!isValidBoardId(boardId)) return notFound();
  const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  if (!exists) return notFound();

  // A claimed size over the limit is refused without reading the body at all. It is a claim,
  // so the byte length is checked again afterwards: `Content-Length` cannot make a body
  // smaller than it is, and only the second check stops a stored 10 MB+1 image.
  const claimed = Number(request.headers.get('content-length'));
  if (Number.isFinite(claimed) && claimed > IMAGE_MAX_BYTES) return tooLarge();

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) return tooLarge();

  const contentType = sniffImageType(body.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return unsupportedType();

  // The id is random, so an upload cannot overwrite an asset somebody else is looking at,
  // and a key nobody can reach is not a leak.
  const key = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(key, body, { httpMetadata: { contentType } });
  } catch {
    // Nothing is known about the failure and nothing was written, so the client is told the
    // truth: this may work if asked again (that is what `Retry` is for).
    return storageFailed();
  }

  return new Response(JSON.stringify({ assetKey: key, contentType }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `GET /api/assets/:boardId/:assetId` — the bytes of one image, forever.
 *
 * The key is checked against the pattern before the bucket is asked, so no path syntax in a
 * URL reaches storage, and the type served back is the one recorded at upload by reading the
 * bytes — never a value the requester supplied, which is what makes a stored file impossible
 * to turn into a document. `immutable` is honest because keys are random and never reused:
 * the bytes at a key never change, and when a board is deleted its bucket prefix goes with it.
 *
 * A missing object and a malformed key answer the same way, and a plain 404 with no body:
 * this URL is fetched by an `<img>` element, and there is nothing in the response that the
 * board could not draw itself.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!isAssetKey(key)) return missing();

  let object: R2ObjectBody | null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch {
    // A bucket that is not answering is indistinguishable, to the board, from an image that
    // is not there: both are an `<img>` that failed.
    return missing();
  }
  if (object === null) return missing();

  const headers = new Headers();
  // R2 writes the metadata it was given — content type, `etag`, `last-modified` — and the
  // cache headers below are added on top of it.
  object.writeHttpMetadata(headers);
  if (!headers.has('content-type')) {
    // Every stored object was sniffed, so this is a belt: never fall back to a type the
    // requester could have influenced.
    headers.set('content-type', 'application/octet-stream');
  }
  headers.set('cache-control', `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'");
  return new Response(object.body, { status: 200, headers });
}

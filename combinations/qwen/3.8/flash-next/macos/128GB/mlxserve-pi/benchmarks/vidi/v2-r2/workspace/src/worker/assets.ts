// The asset API: bytes up into the bucket, bytes back out of it.
//
// ## Why an upload checks the board with a plain RPC
//
// `POST /api/boards/:boardId/assets` is not the board's own address - `boardsRouteOf` answers
// only for `/api/boards/:id` - so an upload that reached this Worker has not been near the
// room. It is checked the same way the existence probe checks it: one call, no state. A board
// that is not there gets `404` and nothing is written, which is the difference between an
// upload that failed and bytes stranded in a bucket under an id nobody can ask about. A client
// cannot enumerate a bucket it cannot name, but it can be refused the chance to fill one.
//
// ## Why the size is asked twice
//
// `Content-Length` is tested before the body is read at all, because reading a body the Worker
// is going to throw away is the expensive half of the work. That number is a promise, not a
// fact, so the byte count is tested again once the bytes are in hand. The limit is about bytes
// in the bucket, and the bucket is billed for the bytes whatever the client claimed.
//
// ## Why the type is read from the bytes
//
// A `Content-Type` header is what the client said, and a file renamed to `.png` says
// `image/png` all the way down. The first bytes are the only thing on a request that states the
// format for a reason - every one of the four accepted formats writes its name at the front of
// its own file - so the stored Content-Type comes from `sniffImageType` and from nothing else.
// A mismatch gets `415` and the object is never put.
//
// ## Why the response is a key rather than a URL
//
// The client could have been handed a URL to fetch. It is handed `<boardId>/<assetId>` instead,
// because that is the fact the room has to keep: it is origin-independent, so the same board
// read from another host resolves it against that host, and it is what makes an image a board
// object rather than a picture of one person's temporary file location.

import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
} from '../shared/config';
import { newBoardId, isValidBoardId } from '../shared/board-id';
import {
  assetKeyFor,
  assetUrlFor,
  isValidAssetKey,
  sniffImageType,
} from '../shared/image-format';
import type { Env } from './index';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFound(): Response {
  return json({ error: 'not_found' }, 404);
}

/** What came out of an upload, for the caller to turn into an image's state. */
export type UploadOutcome =
  | { kind: 'stored'; assetKey: string; contentType: string }
  | { kind: 'too_large' }
  | { kind: 'unsupported_type' }
  | { kind: 'no_board' }
  | { kind: 'storage_failed' };

/**
 * Store one image's bytes for one board.
 *
 * The order is the order of the tests: is the board there, is it small enough, is it an image.
 * Nothing is written before all three are true, and nothing is cleaned up afterwards because
 * there is never anything to clean up.
 */
export async function storeAsset(
  request: Request,
  env: Env,
  boardId: string,
): Promise<UploadOutcome> {
  if (!isValidBoardId(boardId)) return { kind: 'no_board' };

  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  try {
    if (!(await stub.exists())) return { kind: 'no_board' };
  } catch (error) {
    // We could not ask whether the board is there. That is not "it is not there" - and
    // uploading into a bucket on the strength of a question we could not answer is the one
    // answer that is worse than failing.
    console.error('asset upload: could not reach the room', boardId, error);
    return { kind: 'storage_failed' };
  }

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return { kind: 'too_large' };

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) return { kind: 'too_large' };

  const contentType = sniffImageType(
    body.byteLength > IMAGE_SNIFF_BYTES ? body.subarray(0, IMAGE_SNIFF_BYTES) : body,
  );
  if (contentType === null) return { kind: 'unsupported_type' };

  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, body, {
      httpMetadata: { contentType },
      // The same fact twice, once where HTTP reads it and once where the bucket's own
      // metadata is read: what a browser is served and what a board later confirms about
      // what it stored do not have to agree by accident.
      customMetadata: { contentType },
    });
  } catch (error) {
    // The upload failed after the bucket was reached. The client is told in a way it can
    // answer with a retry, and the board keeps an image with nothing in it - which is what
    // `failed` is for.
    console.error('asset upload: could not write', assetKey, error);
    return { kind: 'storage_failed' };
  }

  return { kind: 'stored', assetKey, contentType };
}

/** What the asset route sends back for one key. */
export type ServedAsset =
  | { kind: 'found'; body: ReadableStream<Uint8Array> | null; contentType: string }
  | { kind: 'not_found' }
  | { kind: 'storage_failed' };

/**
 * Read one asset's bytes. A key that is not two ids is `not_found` before the bucket is asked
 * anything - a traversal attempt gets the same answer as a picture that was never taken, and
 * for the same reason: there is no such place.
 */
export async function fetchAsset(env: Env, key: string): Promise<ServedAsset> {
  if (!isValidAssetKey(key)) return { kind: 'not_found' };

  let object: R2ObjectBody | null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch (error) {
    console.error('asset read: could not reach the bucket', key, error);
    return { kind: 'storage_failed' };
  }
  if (object === null) return { kind: 'not_found' };

  return {
    kind: 'found',
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
  };
}

/** `POST /api/boards/:boardId/assets` - the upload, as a Response. */
export async function handleUpload(
  request: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  const outcome = await storeAsset(request, env, boardId);
  switch (outcome.kind) {
    case 'stored':
      return json({ assetKey: outcome.assetKey, contentType: outcome.contentType }, 201);
    case 'too_large':
      return json({ error: 'image_too_large', maxBytes: IMAGE_MAX_BYTES }, 413);
    case 'unsupported_type':
      return json({ error: 'unsupported_image_type' }, 415);
    case 'no_board':
      return notFound();
    case 'storage_failed':
      return json({ error: 'storage_failed' }, 500);
  }
}

/**
 * `GET /api/assets/:boardId/:assetId` - the bytes, with the cache headers that say they will
 * never change.
 *
 * `immutable` is not a wish, it is a statement about the key: nothing is ever written to an
 * asset key twice, so a year of the same answer is always the right answer. `nosniff` is here
 * because the Content-Type of a file a stranger uploaded is being handed to this origin: the
 * one thing that stops a browser deciding for itself what an unknown body is.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  const served = await fetchAsset(env, key);
  switch (served.kind) {
    case 'found':
      return new Response(served.body, {
        status: 200,
        headers: {
          'Content-Type': served.contentType,
          'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'",
        },
      });
    case 'not_found':
      return notFound();
    case 'storage_failed':
      return json({ error: 'storage_failed' }, 500);
  }
}

export { assetUrlFor };

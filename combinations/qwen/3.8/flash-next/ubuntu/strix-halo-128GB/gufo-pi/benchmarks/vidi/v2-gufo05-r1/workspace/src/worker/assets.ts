/**
 * Storing a board's pictures, and handing them back (`assets.api`).
 *
 * Two routes, and the whole of the product's file handling. An image is the one thing on a
 * board that is too big to live in the `Y.Doc`, so it lives in a bucket and the document
 * holds its key — which means these handlers are the only way a byte gets in, and the only
 * way it comes back out.
 *
 * What decides is the body. A `Content-Type` and a file name are both written by whoever is
 * uploading, so neither is consulted: the first `IMAGE_SNIFF_BYTES` of the request body are
 * matched against the four signatures in `image-format`, and anything else — a PDF renamed
 * to `.png`, an SVG, a truncated file — is refused with 415 without being stored
 * (`image.types`). The size limit is checked twice for the same reason: `Content-Length`
 * catches an honest oversized upload before its bytes are read at all, and the actual byte
 * length catches a request that lied about it.
 *
 * Keys are `<boardId>/<assetId>`, both 128 random bits from `newBoardId()`. Nothing else
 * about a picture is secret, and nothing else needs to be: a key is unguessable, never
 * rewritten, and therefore cacheable forever — which is what lets the serving response say
 * `immutable` and let a browser fetch a board's pictures once.
 */
import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
} from '../shared/config';
import { assetKeyFor, ASSET_KEY_PATTERN, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

/** What the client is told about a picture that landed. */
export interface StoredAssetBody {
  assetKey: string;
  contentType: string;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** The same 404 for "not a board address", "no such board" and "no such picture". */
function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 });
}

/** The body is a file the board will not hold, whatever its name claimed. */
function unsupportedType(): Response {
  return Response.json({ error: 'unsupported_media_type' }, { status: 415 });
}

/** The body is bigger than 10 MB, which is more than a board is willing to hold. */
function tooLarge(): Response {
  return Response.json({ error: 'payload_too_large' }, { status: 413 });
}

/** Storage did not do what it was asked to. Nothing was written, and nothing is retried. */
function storageFailed(stage: string, error: unknown): Response {
  console.error(JSON.stringify({ event: 'asset-storage-failed', stage, error: describe(error) }));
  return Response.json({ error: 'storage_failed' }, { status: 500 });
}

/**
 * Store one picture for one board.
 *
 * The order of the checks is the order of their cost, and each one stops everything after
 * it (`assets.api`):
 *
 * 1. the address is well-formed, so a made-up string never reaches an object;
 * 2. the board exists, decided by that board's own `BoardRoom` (`share.not_found`) — an
 *    upload cannot be the thing that creates a board, any more than a connection can;
 * 3. `Content-Length`, so an oversized upload is refused before its bytes are read;
 * 4. the real byte length, because a `Content-Length` is a claim, not a fact;
 * 5. the bytes themselves, matched against the four accepted signatures;
 * 6. only then is anything written.
 *
 * So every error path leaves the bucket exactly as it was, which is what makes an unguessable
 * key enough: there is no half-stored picture for a later request to find.
 */
export async function handleUpload(request: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return notFound();

  let exists: boolean;
  try {
    exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  } catch (error) {
    // The room could not be reached, or could not read its own storage. That is not "no
    // such board" — telling an uploader their board is gone would be a lie.
    return storageFailed('board-exists', error);
  }
  if (!exists) return notFound();

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return tooLarge();

  // Read whole, deliberately: the type has to be known before anything is stored, and a
  // streamed put would have to be deleted again when the sniff fails. 10 MB is the ceiling,
  // and it is enforced above rather than here so the ceiling is what bounds the memory.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch (error) {
    return storageFailed('read-body', error);
  }
  if (bytes.byteLength > IMAGE_MAX_BYTES) return tooLarge();

  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return unsupportedType();

  // The asset id is drawn the same way a board address is: 128 random bits, so a picture
  // cannot be found by guessing, only by reading the document that refers to it.
  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, {
      httpMetadata: { contentType },
    });
  } catch (error) {
    return storageFailed('put', error);
  }

  const body: StoredAssetBody = { assetKey, contentType };
  return Response.json(body, { status: 201 });
}

/**
 * Hand back one stored picture.
 *
 * The key is checked against `ASSET_KEY_PATTERN` before the bucket is asked anything, so a
 * path with `..` in it is not a lookup, a prefix scan or an error — it is the same 404 as a
 * picture that was never uploaded.
 *
 * The response headers are the security part. A stored file is somebody else's bytes served
 * from the board's own origin, so it is served with `nosniff` (a browser must believe the
 * `Content-Type` we chose from the magic bytes, not guess a more executable one) and with a
 * `default-src 'none'` CSP (nothing this response contains may run, load or fetch). Neither
 * is a defence against a format we accepted: an accepted GIF is a picture, and these headers
 * keep it a picture all the way to the screen.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return notFound();

  let object: R2ObjectBody | null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch (error) {
    return storageFailed('get', error);
  }
  if (!object || !object.body) return notFound();

  return new Response(object.body, {
    status: 200,
    headers: {
      // The type we decided from the bytes, never one the uploader sent.
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(object.size),
      // A key is written once and never rewritten, so a cached copy is always current.
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}


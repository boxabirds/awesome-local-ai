// The image asset endpoints (story 12): `POST /api/boards/:boardId/assets` to store a picture,
// `GET /api/assets/:boardId/:assetId` to read it back.
//
// ## What this module is responsible for
//
// It is the only place a byte of a picture is written or read, and it knows almost nothing about
// pictures: it names a file by its first bytes, refuses anything it cannot name, and hands the
// rest to a bucket. Deciding what an image *is* — its size, its proportions, whose screen is
// waiting for it — is `shared/objects/image.ts`, and this module never has to know, because it
// never sees the document.
//
// ## Why an upload asks who it is before it asks what it has
//
// In this order, cheapest and most certain first: the id's shape, the visitor's allowance,
// whether the board exists at all, the length the request declares, and only then the bytes. The
// last is the only one that costs anything to check, so a request that fails one of the first
// three is refused without a megabyte of it ever being read. The allowance comes before reading
// the body because the point of a limit is to make the expensive checks not happen.
//
// ## Why the board has to exist
//
// An address in the bucket is minted here, under a board id the client names, so an upload to a
// board that was never created would be a way to write into storage that belongs to nobody — or
// to a board id guessed at later. Existence is asked of the board's own Durable Object, the same
// answer `GET /api/boards/:id` gives, and a board that is not there stores nothing.
//
// ## Why the type comes out of the file and not the request
//
// A name, a `Content-Type` and a file picker all say what somebody *believed* a file was; the
// bytes say what it is. One of those is worth acting on, which is why a PDF renamed to `photo.png`
// is refused as a PDF, and why the type this module writes into storage is the type it read from
// the first twelve bytes — that stored name is what a later GET answers with, so the board ends
// up describing a picture by what the picture is.
//
// ## Why serving is so blunt
//
// A stored picture is served to whoever holds the board's link, which is this product's whole
// access model — no sign-in, no per-image list, nothing to authorise against. What this module
// can promise instead is that a file is answered with the type it actually is, that the browser
// is told in the strongest terms it is an image and not a document, and that a response may be
// cached for a year, because the bytes behind an address never change.

import { isValidBoardId, newBoardId } from '../shared/board-id.ts';
import { ASSET_CACHE_MAX_AGE_S, IMAGE_MAX_BYTES } from '../shared/config.ts';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format.ts';
import type { Limiter } from './create-board.ts';
import { visitorKey } from './visitor.ts';

/** The part of a board's Durable Object this module uses: the existence question. */
export interface BoardPresence {
  exists(): Promise<boolean>;
}

/**
 * The part of an R2 bucket this module uses. The platform's own type, narrowed to the two
 * calls: a bucket is not something this module extends opinions about, and a test that wants
 * to make one fail writes these two methods.
 */
export type AssetStore = Pick<R2Bucket, 'put' | 'get'>;

/** The bindings `handleUpload` needs, as a slice of the Worker `Env`. */
export interface AssetUploadEnv {
  BOARD_ROOM: { idFromName(id: string): unknown; get(id: unknown): BoardPresence };
  ASSETS_BUCKET: AssetStore;
  ASSET_UPLOAD_LIMITER: Limiter;
}

/** The bindings `handleServe` needs. */
export interface AssetServeEnv {
  ASSETS_BUCKET: AssetStore;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/**
 * Store one picture and answer with the address it was stored under.
 *
 * The client never names an address: this mints one from the board id and a fresh 128-bit id, so
 * a board's pictures are one prefix and each of them is as unguessable as a board link. The
 * `Content-Type` of the request is not read, and what comes back is the type the bytes turned out
 * to be — which is the only claim about the file this board ever makes.
 */
export async function handleUpload(
  request: Request,
  env: AssetUploadEnv,
  boardId: string,
): Promise<Response> {
  // A string that is not a board id is not a board, and answering that before anything else is
  // what keeps a malformed id from instantiating a Durable Object at all (as in story 3 and 5).
  if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);

  // The allowance next: it is the one limit whose entire purpose is that nothing after it runs.
  const allowance = await env.ASSET_UPLOAD_LIMITER.limit({ key: visitorKey(request) });
  if (!allowance.success) {
    return json({ error: 'rate_limited' }, 429);
  }

  if (!(await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists())) {
    return json({ error: 'not_found' }, 404);
  }

  // The declared length first, so an oversized upload is refused before its bytes are read. The
  // real length is checked again below: `Content-Length` is a promise, not a fact.
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);

  const contentType = sniffImageType(body);
  if (contentType === null) return json({ error: 'unsupported_type' }, 415);

  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, body, { httpMetadata: { contentType } });
  } catch {
    // The bucket said no. There is nothing to retry on the user's behalf here and nothing to
    // tell them beyond the picture not being stored; their own screen is about to offer a Retry
    // button, which is the useful version of this message.
    return json({ error: 'storage_unavailable' }, 500);
  }

  return json({ assetKey, contentType }, 201);
}

/**
 * Read one picture back, by its `<boardId>/<assetId>` key.
 *
 * The type comes from what was stored, not from the request or from anything a client once
 * claimed; `X-Content-Type-Options: nosniff` then forbids the browser from changing its mind, and
 * `Content-Security-Policy: default-src 'none'` leaves it nothing to run — which is the whole
 * reason SVG is not among the accepted formats: a format that can carry script would be one
 * upload away from a board's link.
 *
 * The cache header is a promise about immutability rather than a performance setting: an asset id
 * is minted per upload and its bytes are written once, so a year is the honest length, and a
 * board with a hundred pictures on it loads without fetching a hundred pictures again.
 */
export async function handleServe(
  env: AssetServeEnv,
  key: string,
  method: string = 'GET',
): Promise<Response> {
  // A key that is not exactly two 22-character ids is not looked for: no prefix, no `..`, no
  // other board's file. Percent-escapes cannot appear in a valid key either, and the route does
  // not decode them, so a path written to look like a traversal names nothing.
  if (!ASSET_KEY_PATTERN.test(key)) return json({ error: 'not_found' }, 404);

  let stored;
  try {
    stored = await env.ASSETS_BUCKET.get(key);
  } catch {
    return json({ error: 'storage_unavailable' }, 500);
  }
  if (!stored || !stored.body) return json({ error: 'not_found' }, 404);

  // The name the bytes were stored under — the one this module wrote from the bytes
  // themselves, not the one the uploader's file picker reported.
  const contentType = stored.httpMetadata?.contentType ?? 'application/octet-stream';
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_S}, immutable`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  });

  if (method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(stored.body, { status: 200, headers });
}

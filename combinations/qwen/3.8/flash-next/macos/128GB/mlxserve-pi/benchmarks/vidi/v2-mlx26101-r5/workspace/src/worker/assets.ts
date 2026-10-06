/**
 * The two ends of a picture: the request that puts one on a board's shelf, and the request that
 * takes it off again.
 *
 * A picture is not a board. It has no state to share, nobody edits it, and the only thing that ever
 * changes about it is that one day it is there. So it does not live in the Durable Object's SQLite,
 * where every write is one object's serialised write and every read is a call to the object that owns
 * it — it lives in R2, under a key that names the board it belongs to, and the Worker reads and writes
 * it directly. The board *is* checked for, though, before a single byte is stored: story 5's
 * `exists()` RPC is what makes "only boards that exist can receive uploads" true, and it is why a
 * picture can never be filed under a link that belongs to nobody.
 *
 * Three things are decided here and nowhere else:
 *
 * - **What counts as an image.** The client's file picker filter is a courtesy, trivially bypassed by
 *   dragging a PDF from the desktop, and a file's `Content-Type` is a claim a renamed file makes
 *   without thinking about it. The bytes at the front are the fact ({@link sniffImageType}), so the
 *   format a file is stored as is the format those bytes said and the client's `Content-Type` header
 *   is not consulted at all (TC-13).
 * - **What it is called afterwards.** The key comes from {@link assetKeyFor} with an id this function
 *   generated, and the response hands back that same key. A board's object holds the key and nothing
 *   else, so a picture can only ever be fetched by the key it was given — and the pattern is checked
 *   before the bucket is touched on the way in *and* on the way out, which is what makes a path
 *   traversal in a key a 404 rather than a read of something else.
 * - **What it may never be.** Every served byte carries `X-Content-Type-Options: nosniff` and
 *   `Content-Security-Policy: default-src 'none'`, so a browser that somehow gets hold of a file that
 *   is not what its key says cannot execute it, frame it, or fetch anything else from this origin while
 *   doing so. A picture is drawn and nothing more.
 */

import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../shared/config';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  sniffImageType,
  type AcceptedImageType,
} from '../shared/image-format';
import { boardExists } from './create-board';
import type { Env } from './index';

/** The heaviest file this endpoint will take, in bytes — the setting, under the design's name. */
export const MAX_BYTES = IMAGE_MAX_BYTES;

/** What a successful upload says back: where the bytes went, and what they are. */
export interface UploadReply {
  /** `boardId/assetId` — the key this picture lives under for as long as the board does. */
  assetKey: string;
  /** The sniffed type, which is what a later GET will answer with. */
  contentType: AcceptedImageType;
}

/** A JSON answer, in the shape the rest of this Worker answers with. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * A refusal: a machine-readable code, one sentence, and the code in a header too for whoever is
 * reading a response rather than a console. Nothing is ever written on one of these paths.
 */
function refuse(status: number, code: string, message: string, allow?: string): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'x-vidi6-error': code,
  };
  if (allow !== undefined) headers['allow'] = allow;
  return new Response(JSON.stringify({ error: code, message }), { status, headers });
}

/**
 * `POST /api/boards/:boardId/assets` — the bytes of one file, in the body, and one object written.
 *
 * The body is raw rather than a multipart form: there is exactly one file per request and no field to
 * name, so the request body *is* the file and the XHR that sends it can report real progress against
 * it. `Content-Type` is ignored — it is the client's guess about a file, and this function decides the
 * type from the bytes (TC-13 sends a PDF with `Content-Type: image/png` on purpose).
 *
 * The checks are in the order of their cost and of their certainty:
 *
 * 1. the id's *shape*, which costs a regex and means a malformed address never names a Durable Object;
 * 2. the board's existence, which is a call to an object and the only thing here that can be slow;
 * 3. `Content-Length`, which can refuse an oversized upload without reading it;
 * 4. the body's real length, which is the same question answered truthfully;
 * 5. the bytes' format, which needs the body we now have anyway;
 * 6. the write, whose failure is the only one of these that is the service's fault rather than ours.
 *
 * A body over the limit is read before it is refused, and that is deliberate: `Content-Length` is a
 * claim, and the honest version of "nothing over 10 MB is ever stored" reads the bytes it is promising
 * about. The 413 in step 3 is only there to stop a large upload from being buffered needlessly.
 */
export async function handleUpload(request: Request, env: Env, boardId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return refuse(405, 'method_not_allowed', 'Images are uploaded by POSTing their bytes here.', 'POST');
  }
  if (!isValidBoardId(boardId)) return refuse(404, 'not_found', 'No such board.');

  // Story 5's rule, asked of the only thing that can answer it: an upload belongs to a board, and a
  // board that is not there has nothing for the picture to belong to.
  if (!(await boardExists(env, boardId))) return refuse(404, 'not_found', 'No such board.');

  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return refuse(413, 'file_too_large', 'That file is larger than the board takes.');
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) {
    return refuse(413, 'file_too_large', 'That file is larger than the board takes.');
  }
  // An empty body is not an image and is not worth a sniffer's time; it is the same 415 as a file
  // whose bytes spell nothing we know, because from the board's side of it there is no difference.
  const contentType = sniffImageType(new Uint8Array(body));
  if (contentType === null) {
    return refuse(415, 'unsupported_type', 'Only PNG, JPEG, GIF and WebP images can be added.');
  }

  // The id is generated here and now: a request that has failed every other check has already written
  // nothing, and a request that fails below writes nothing either, because the put is the last thing.
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { boardId },
    });
  } catch {
    // The bytes are not on the shelf, so the client leaves its object as `failed` and the person can
    // press Retry. There is nothing to undo and nothing to clean up: a failed put wrote nothing.
    return refuse(500, 'asset_store_failed', 'The board could not store that image. Try again.');
  }

  const reply: UploadReply = { assetKey: key, contentType };
  return json(reply, 201);
}

/**
 * `GET /api/assets/:boardId/:assetId` — the bytes back, as the type they were stored as.
 *
 * The key is checked against {@link ASSET_KEY_PATTERN} and nothing else: not against a list, not
 * against the board's objects. That is the whole of the read-side access control, and it is the same
 * one story 5 uses for board links — you have to have the key. A key that does not match is a 404
 * before the bucket is asked, so there is no way to ask for another board's picture, no way to ask for
 * a directory, and no way to get this Worker to read a key it did not write.
 *
 * A missing object is the same 404, for the same reason a board that is not there is: the answer a
 * client acts on is "this is not here", and the difference between "never was" and "someone deleted
 * it" is not something this endpoint knows or anybody outside the board needs.
 *
 * The three headers are the point of this function rather than an afterthought. `immutable` because a
 * key names bytes and bytes do not change; `nosniff` and `default-src 'none'` because a file that was
 * stored under a PNG's name by a client that believed it was a PNG might still be a document, and a
 * browser must never be in a position to decide that for itself.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  // A key that is not a key is the same 404 as a key that names nothing: the client's question is
  // "is this picture here", and "that is not something I can be asked" answers it no better.
  if (!ASSET_KEY_PATTERN.test(key)) return refuse(404, 'asset_not_found', 'No image with this key.');

  // `R2ObjectBody`, not `R2Object`: the difference between the two in the types is whether the bytes came
  // back with the metadata, and the whole point of this handler is the bytes.
  let object: R2ObjectBody | null = null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch {
    return refuse(500, 'asset_read_failed', 'The board could not read that image.');
  }
  if (object === null) return refuse(404, 'asset_not_found', 'No image with this key.');

  const stored = object.httpMetadata?.contentType;
  const headers = new Headers();
  headers.set('content-type', stored !== undefined && stored.length > 0 ? stored : 'application/octet-stream');
  headers.set('cache-control', `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'");
  // The ETag is the object's own; a browser that asks twice is a browser that gets a 304 rather than
  // a second copy of a picture it already has.
  if (object.httpEtag.length > 0) headers.set('etag', `"${object.httpEtag}"`);
  return new Response(object.body, { status: 200, headers });
}

// The asset endpoints (story 12): one to put a picture in the bucket, one to read it back.
//
// Two rules decide the shape of this file, and both are about trusting the wrong thing.
//
//   * The filename is not trusted. What a picture is — what media type the browser is told, and
//     therefore whether it will draw it, download it or run it — comes from the bytes, read here and
//     read again on the way out (image.types). A file called `logo.svg` or `plan.png` changes nothing.
//   * The key is not trusted either. `:boardId/:assetId` arrives from a stranger's URL, and the same
//     string is a path in a bucket that holds every board's pictures. So its shape is checked as text
//     — exactly two 22-character ids with one slash between them — before the bucket is named, and a
//     request that does not fit is answered without asking the bucket anything (image.key_shape).
//     `..` never gets that far.
//
// What is deliberately *not* here: access control (anyone who holds a key can read it — the design's
// line is that the key is the secret), and PNG/JPEG/GIF/WebP *decoding*. A file can carry a correct
// signature and still be corrupt a thousand bytes in; this Worker cannot tell that without a decoder,
// and it has no business running one. That file gets stored, and the browser that cannot decode it
// says so (image.decode). The board keeps no object of a picture it cannot show.
//
// Nothing is stored on an error path — not a refusal, not a bucket that said no — so a retry is the
// same request again and a board never accumulates pictures nobody can see.

import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { assetKeyFor, isAssetKey, newAssetId, sniffImageType } from '../shared/image-format';
import { imageSourceUrl } from '../shared/objects/image';
import { boardExists } from './create-board';
import type { Env } from './index';

/** How long a stored picture may be cached. A key never changes what is under it. */
const CACHE_CONTROL = `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`;

/**
 * On every answer that carries picture bytes. `nosniff` stops a browser deciding for itself what it
 * was given; the CSP stops it doing anything with it if it did. A bucket full of other people's
 * uploads is not a place to run scripts, whatever got stored there.
 */
const SAFETY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'",
};

// `([^/]*)` rather than `([^/]+)`: an upload to `/api/boards//assets` is a request to put a picture on
// a board whose name did not survive, which is answered the same way as a name that is merely wrong —
// 404, board_not_found — rather than by a route that never got asked the question at all.
const UPLOAD_PATH = /^\/api\/boards\/([^/]*)\/assets$/;
const SERVE_PREFIX = '/api/assets/';

export type AssetsRoute = 'upload' | 'serve' | null;

/**
 * Which of the two asset routes this path belongs to, or none. Everything under `/api/assets/`
 * belongs to the read route, including a path with the wrong number of segments: it is answered 404
 * here rather than falling through to the client bundle, because "here is the HTML of the app" is a
 * strange answer to ask for a picture.
 */
export function assetsRoute(pathname: string): AssetsRoute {
  if (UPLOAD_PATH.test(pathname)) return 'upload';
  if (pathname.startsWith(SERVE_PREFIX)) return 'serve';
  return null;
}

/** Both asset endpoints, chosen by the path. POST stores, GET and HEAD read. */
export async function handleAssets(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const route = assetsRoute(url.pathname);
  if (route === 'upload') {
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed');
    return handleUpload(request, env, url);
  }
  if (route === 'serve') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return errorResponse(405, 'method_not_allowed');
    }
    return handleServe(request, env, url);
  }
  return errorResponse(404, 'not_found');
}

/**
 * `POST /api/boards/:boardId/assets` — store one picture, answer with the key it is under.
 *
 * The order is the order of the checks and it is not arbitrary (design, assets.api): the board id is
 * judged as text, then as a board that exists, then the size — announced in `Content-Length` before a
 * single byte of the body is read, and measured again once it is — and only then are the bytes looked
 * at. A refusal stores nothing.
 */
export async function handleUpload(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const boardId = decodeSegment(UPLOAD_PATH.exec(url.pathname)![1]);

  // The key is built from the two ids and then judged, rather than each half judged separately, so
  // that "a valid key" and "the key we would have written" cannot drift apart (image.key_shape).
  const key = assetKeyFor(boardId, newAssetId());
  if (!isAssetKey(key)) return errorResponse(404, 'board_not_found');

  // A picture belongs to a board. Since story 5 that question has one answer and one way to ask it.
  if (!(await boardExists(env, boardId))) return errorResponse(404, 'board_not_found');

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    // Refused before the body is read: this is the one rejection that a stranger can make us pay for.
    return errorResponse(413, 'too_large');
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0) return errorResponse(400, 'empty_body');
  if (body.byteLength > IMAGE_MAX_BYTES) return errorResponse(413, 'too_large');

  const contentType = sniffImageType(headOf(body, IMAGE_SNIFF_BYTES));
  if (contentType === null) return errorResponse(415, 'unsupported_type');

  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType },
      // Which board this belongs to, as data rather than as a path: it is how a bucket can be
      // audited by hand, and it costs nothing to write.
      customMetadata: { 'board-id': boardId },
    });
  } catch (cause) {
    // Anything the bucket says no to — over quota, a hiccup, a binding that is not there — reaches a
    // person as one thing: this did not work, and Retry will ask again (image.upload_failure).
    console.warn('asset upload failed', { key, cause: String(cause) });
    return errorResponse(500, 'storage_failed');
  }

  return new Response(JSON.stringify({ assetKey: key, contentType, url: imageSourceUrl(key) }), {
    status: 201,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * `GET /api/assets/:boardId/:assetId` — the bytes, with the type the bytes say they are.
 *
 * The stored `contentType` metadata is not repeated back on faith: it is what the upload endpoint
 * sniffed on the way in, and a picture being read is a picture we can look at again. Re-reading it is
 * what keeps a file that somehow got into the bucket without being one of our four types out of a
 * browser that would otherwise be told to parse it.
 *
 * The body is read whole rather than streamed: a picture is at most IMAGE_MAX_BYTES, and the media
 * type a browser will act upon cannot be chosen before some of it has been seen.
 */
export async function handleServe(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const path = url.pathname.slice(SERVE_PREFIX.length);
  const pieces = path.split('/');
  if (pieces.length !== 2) return errorResponse(404, 'not_found');
  const key = assetKeyFor(decodeSegment(pieces[0] ?? ''), decodeSegment(pieces[1] ?? ''));
  if (!isAssetKey(key)) return errorResponse(404, 'not_found');

  // The asset id is the whole identity of the object — a key is never written with different bytes —
  // so it is also the validator a re-check sends back (design §3: ETag / If-None-Match).
  const etag = `"${key.slice(key.indexOf('/') + 1)}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': CACHE_CONTROL } });
  }

  let stored: R2ObjectBody | null = null;
  try {
    stored = await env.ASSETS_BUCKET.get(key);
  } catch (cause) {
    console.warn('asset read failed', { key, cause: String(cause) });
    return errorResponse(500, 'storage_failed');
  }
  if (!stored) return errorResponse(404, 'not_found');

  const body = new Uint8Array(await stored.arrayBuffer());
  const contentType = sniffImageType(headOf(body, IMAGE_SNIFF_BYTES));
  if (contentType === null) {
    // Something is in the bucket that is not a picture we render. To a board that is the same answer
    // as an empty bucket: there is no image here (image.types), and ImageObject says so.
    return errorResponse(404, 'not_found');
  }

  const headers: Record<string, string> = {
    'content-type': contentType,
    'content-length': String(body.byteLength),
    'cache-control': CACHE_CONTROL,
    etag,
    ...SAFETY_HEADERS,
  };
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(body, { status: 200, headers });
}

/** A path segment, un-escaped — or the literal text if it cannot be un-escaped, which is never a key. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The first `limit` bytes, without copying the whole picture. */
function headOf(bytes: Uint8Array, limit: number): Uint8Array {
  return bytes.byteLength > limit ? bytes.subarray(0, limit) : bytes;
}

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    // The safety headers belong on the refusals too: a 404 body is not something to sniff either.
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...SAFETY_HEADERS,
    },
  });
}

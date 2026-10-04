/**
 * Storing a picture and handing it back: the two halves of the asset API (story 12).
 *
 * This is where a dropped file stops being the browser's problem. Everything to the left of this file -
 * {@link validateFiles}, the decode, the placeholder - is a client's best guess about a file it is
 * holding, and every one of those guesses is a claim: `File.type` is a claim about an extension,
 * `Content-Type` is a claim about whoever wrote the request, and the size in the document is a claim about
 * a decode that happened somewhere. Nothing on this side believes any of them. The bytes are read, the
 * bytes are counted, and the bytes say what they are - which is the only reason a renamed PDF and an SVG
 * with a script in it are refused rather than stored and served to the next person who opens the board.
 *
 * What is *not* here matters as much. There is no authentication, because there is none anywhere in this
 * product: a board's id is the whole of its access control (story 3), and an asset's key is the whole of
 * its - which is why the key is 22 unguessable characters and why the serving route will not answer a
 * request for a key it did not issue. There is no list of a board's assets, no delete and no replace: an
 * upload writes a new key next to the old one, which is what lets every response below be cached for a year
 * without anybody ever having to work out whether the copy in their cache is still current.
 */
import { IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../shared/config';
import { isValidBoardId } from '../shared/board-id';
import { newBoardId } from '../shared/board-id';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

/**
 * `POST /api/boards/<boardId>/assets`: take a file's bytes and keep them.
 *
 * The checks are in the order they are cheapest to run, which is also the order that wastes the least of
 * somebody's upload:
 *
 * ```text
 * the board id is a board id        a string that is not one could not have been issued, and answering
 *                                   it costs nothing - no object is created to be told no
 * the board exists                  the board's own object is the only thing that can say so (story 5)
 * Content-Length <= 10 MB           a claim, but a cheap one, and it stops an upload of 4 GB before the
 *                                   Worker has to hold it
 * read the body                     now the bytes are here, and this is the expensive part
 * the body really is <= 10 MB        Content-Length was a claim; this is the fact
 * the bytes are an accepted image    magic bytes, the only evidence that counts
 * put                              the only write in this function
 * ```
 *
 * Nothing is written before every check has passed, including the last one: a Worker that put the object
 * and then decided it did not like it would be a bucket full of files no board refers to, that nobody can
 * ask for and nothing will ever remove.
 *
 * @returns `201` with the key and the type it was found to be; `404` for a board that is not there; `413`
 * for a body over the limit; `415` for bytes that are not one of the four accepted images; `500` when the
 * bucket itself failed.
 */
export async function handleUpload(request: Request, env: Env, boardId: string): Promise<Response> {
  // A path segment is decoded by the caller, so this is where `%2e%2e` and a space have already become
  // what they mean - which is why they are checked again here rather than trusted to have been filtered.
  if (!isValidBoardId(boardId)) {
    return json({ error: 'not_found' }, 404);
  }

  // The board's own object is asked whether the board exists, and the answer comes from its storage: that
  // is the story 5 rule, and it is the only way to know that a link leads somewhere. A board that was
  // never made gets a 404 here and no bytes are read, which is also what stops this route being used to
  // fill a bucket with files addressed to invented boards.
  let exists: boolean;
  try {
    exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  } catch (error) {
    // Asking failed. The board may perfectly well be there, so this is not a 404: a client that treats 404
    // as "this board is gone" would give up on a board that only had a bad moment.
    console.error(`board ${boardId}: could not be checked for the upload (${String(error)})`);
    return json({ error: 'check_failed' }, 500);
  }
  if (!exists) {
    return json({ error: 'not_found' }, 404);
  }

  // The claim first, because reading a body into memory is the one part of this function that can be made
  // expensive by a request. A Worker has a limited amount of memory and this one is willing to hold ten
  // megabytes of it for the sake of checking a signature; a body that says it is a gigabyte is not going
  // to get that far, and saying so costs nothing.
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    // There may be a body still coming, and we are not going to look at it. Saying so is not politeness:
    // left unread, those bytes are an open stream that the runtime keeps pumping into a response that has
    // already been answered, which shows up in the log as an exception nobody caused.
    await refuseBody(request);
    return json({ error: 'too_large' }, 413);
  }

  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch (error) {
    // The body stopped arriving. This is the one answer the HTTP contract in the design does not name, and
    // it gets a 400 rather than one of the four: the request is what failed, the board is there, the size
    // was allowed and the bytes that did arrive were never looked at. A 500 here would tell everybody
    // watching this deployment that something of ours broke, when what broke was somebody's upload.
    console.error(`board ${boardId}: the upload could not be read (${String(error)})`);
    return json({ error: 'body_incomplete' }, 400);
  }

  // ...and then the fact. A request that said nothing, or said something untrue, is answered the same way:
  // the limit is about the bytes that arrived, and storing them to find out would be the bug.
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }
  // An empty body has no signature, and the answer it gets is the one everything else that is not an image
  // gets - but said in the words that fit, because "the bytes are not a PNG, JPEG, GIF or WebP" is true of
  // a zero-length file in a way that is not useful.
  if (body.byteLength === 0) {
    return json({ error: 'unsupported_type' }, 415);
  }

  // The bytes themselves, and nothing else: not the filename, which is not sent, not `Content-Type`, which
  // is whoever wrote the request's opinion about their own file, and not the extension of anything. Only
  // the head is looked at, which is the whole reason {@link IMAGE_SNIFF_BYTES} exists - and a file shorter
  // than the head is looked at in full, because a three byte upload is answered, not crashed on.
  const contentType = sniffImageType(new Uint8Array(body, 0, Math.min(IMAGE_SNIFF_BYTES, body.byteLength)));
  if (contentType === null) {
    return json({ error: 'unsupported_type' }, 415);
  }

  const key = assetKeyFor(boardId, newBoardId());
  const bucket = env.ASSETS_BUCKET;
  if (bucket === undefined) {
    // A deployment that has no bucket has no way to keep a picture. This is not a 404 and not a 415: the
    // file was fine and the board is fine, and the only honest answer is that the storage failed.
    console.error('asset upload refused: this deployment has no ASSETS_BUCKET binding');
    return json({ error: 'storage_failed' }, 500);
  }

  try {
    await bucket.put(key, body, {
      // What the bytes were found to be, and therefore what they will be served as, forever. This is the
      // only place a content type is decided, and it is decided from evidence: a stored object's type is
      // never taken from a request again, which is what makes the year-long cache safe.
      httpMetadata: { contentType },
    });
  } catch (error) {
    // The key it would have had is in the log, because that is the only trace an upload that this close to
    // succeeding leaves; the response says nothing about it, because a person watching a progress bar has
    // nothing to do with a bucket key.
    console.error(`asset ${key}: the bucket refused it (${String(error)})`);
    return json({ error: 'storage_failed' }, 500);
  }

  return json({ assetKey: key, contentType }, 201);
}

/**
 * `GET /api/assets/<boardId>/<assetId>`: the bytes of a picture that was stored.
 *
 * Three headers travel with every successful response, and they are the reason a bucket of files chosen
 * by whoever uploaded them can be served to a browser at all:
 *
 * - `X-Content-Type-Options: nosniff`, so a browser that decides the bytes are not what they were said to
 *   be refuses to render them rather than guessing - which is the difference between a file that fails to
 *   be a picture and a file that becomes a document.
 * - `Content-Security-Policy: default-src 'none'`, so that even if something here were served as a
 *   document, it could load nothing, fetch nothing and run nothing. The four accepted types cannot carry a
 *   script the way an SVG can, and this is the belt to that pair of braces.
 * - `Cache-Control: public, max-age=31536000, immutable`, which is safe only because a key is never reused:
 *   a second upload of the same picture gets a new key, so a cached copy can never be out of date.
 *
 * A key that is not well formed is answered without touching the bucket, and a key that is well formed but
 * missing gets the same body - so this route cannot be used to find out which keys a board has.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) {
    return json({ error: 'not_found' }, 404);
  }
  const bucket = env.ASSETS_BUCKET;
  if (bucket === undefined) {
    console.error('asset request refused: this deployment has no ASSETS_BUCKET binding');
    return json({ error: 'storage_failed' }, 500);
  }

  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch (error) {
    console.error(`asset ${key}: the bucket could not be read (${String(error)})`);
    return json({ error: 'storage_failed' }, 500);
  }
  if (object === null) {
    // The same answer a malformed key got. A board whose object names a key that was never written - or was
    // written into a bucket that has since been replaced - is drawn as "Image unavailable" by the client,
    // which is the only message in this story that is about a stored board rather than a file in hand.
    return json({ error: 'not_found' }, 404);
  }

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  // The object's own stream is handed to the response rather than read into memory first. That is the only
  // reason a ten-megabyte photograph is affordable on a Worker, and it is what lets the browser draw the
  // picture as the bytes arrive instead of after the last one. Nothing in this route is allowed to buffer:
  // an e2e run that uploads a 3 MB photo and then loads it in six tabs at once is six concurrent reads of
  // it, and a Worker that held each of them in memory would be out of memory before the first picture is
  // drawn.
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

/** A JSON answer, as the rest of the Worker gives them. */
function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/** Tell a request that its body is not wanted, and swallow whatever it says about being told. */
async function refuseBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // It is already gone, or going. Either way there is nothing left to decide: the answer it was given
    // stands, and a refusal about the refusal is not worth anyone's attention.
  }
}

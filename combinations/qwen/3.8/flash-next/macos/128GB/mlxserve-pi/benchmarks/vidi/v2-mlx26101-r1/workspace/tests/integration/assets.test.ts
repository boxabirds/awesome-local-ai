// assets.api integration tests (story 12, TC-10 to TC-16): the two asset endpoints against the real
// Worker, the real BoardRoom existence rule and the real (local) R2 bucket the runtime gives the
// Worker here.
//
// What these tests hold the server to is that it decides what a picture is, and decides the same way
// on the way in and on the way out:
//
//   * The bytes decide the media type — not the filename, and not the uploader's word for it
//     (image.types, TC-13, TC-16). A `.png` that is a PDF is refused on the way in, and an object that
//     is in the bucket without being one of our four types is answered as "there is no image here".
//   * A key is a shape before it is a place (image.key_shape, TC-11, TC-16). Both endpoints build the
//     key and judge its shape, and an upload has to name a board that exists, so `..` and its encoded
//     relatives never reach the bucket — the bucket being the one thing on this board that holds every
//     other board's photographs.
//   * A refusal stores nothing (TC-11 to TC-15). The bucket is listed after each of those, because
//     "nothing was written" is a claim about the bucket, not about the response code.
//
// The fixtures are real files (tests/fixtures/images/): a real screenshot, a real 3 MB photo padded to
// exact sizes, a real PDF renamed `.png`, and a PNG whose chunks stop in the middle.

import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { assetKeyFor, isAssetKey, newAssetId } from '../../src/shared/image-format';
import { imageSourceUrl } from '../../src/shared/objects/image';
import { createRoom, bindings } from './helpers/room';
// Built in memory, not read from disk: these tests run inside workerd, which has no filesystem. See
// the header of the fixture module for which of these a browser can actually draw — none of the
// assertions below depends on it, because the Worker's whole job is the first twelve bytes and the
// byte count.
import {
  gifBytes,
  jpegBytes,
  junkBytes,
  pdfBytes,
  pngAtLimit,
  pngBytes,
  svgBytes,
  webpBytes,
} from '../fixtures/image-bytes';

const PNG = pngBytes(120, 90);
const JPEG = jpegBytes(4096);
const GIF = gifBytes(24, 16);
const WEBP = webpBytes(64, 48);
const PDF = pdfBytes();
const SVG = svgBytes();
// A PNG whose IDAT stops in the middle: a correct signature and a picture no browser will draw.
const TRUNCATED_PNG = pngBytes(60, 40).subarray(0, 200);

/** POST a body at the upload endpoint and read back whatever the server said. */
async function upload(
  boardId: string,
  body: Uint8Array,
  contentType = 'application/octet-stream',
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  const response = await SELF.fetch(`https://example.com/api/boards/${boardId}/assets`, {
    method: 'POST',
    // The file's own type, which the server is not required to believe a word of.
    headers: { 'content-type': contentType },
    body: body as unknown as BodyInit,
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: response.status, json, headers: response.headers };
}

/** A board that exists, so an upload is allowed to be about something. */
async function boardWithRoom(): Promise<string> {
  const boardId = newBoardId();
  expect(await createRoom(boardId)).toBe('created');
  return boardId;
}

/** Ask for a stored picture. */
function serve(key: string, headers?: Record<string, string>): Promise<Response> {
  return SELF.fetch(`https://example.com/api/assets/${key}`, { headers });
}

/**
 * The keys in the bucket under one board.
 *
 * Scoped by prefix rather than listed whole, because the bucket is the local simulator shared by
 * every test in this file: "nothing was stored" is a claim about what *this* request wrote, and the
 * only version of it that is true is about this board. It also happens to be the claim the PRD makes.
 */
async function bucketKeys(boardId: string): Promise<string[]> {
  const listed = await bindings.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
  return listed.objects.map((object) => object.key).sort();
}

/** `decodeURIComponent`, for a string that may not be encoded at all. */
function safelyDecoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** What the bucket says a stored object is, straight from its own metadata. */
async function storedType(key: string): Promise<string | null> {
  const object = await bindings.ASSETS_BUCKET.head(key);
  return object?.httpMetadata?.contentType ?? null;
}

describe('POST /api/boards/:boardId/assets (TC-10 to TC-15)', () => {
  it('stores a picture and answers with the key it is stored under (TC-10)', async () => {
    const boardId = await boardWithRoom();
    const response = await upload(boardId, PNG, 'image/png');

    expect(response.status).toBe(201);
    const assetKey = String(response.json.assetKey);
    expect(isAssetKey(assetKey)).toBe(true);
    expect(assetKey.startsWith(`${boardId}/`)).toBe(true);
    expect(response.json.contentType).toBe('image/png');
    expect(response.json.url).toBe(imageSourceUrl(assetKey));
    expect(response.headers.get('cache-control')).toBe('no-store');

    // The object is really there, and it is the picture that was sent.
    expect(await bucketKeys(boardId)).toEqual([assetKey]);
    expect(await storedType(assetKey)).toBe('image/png');
    const served = await serve(assetKey);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  it('stores every accepted type, each under its own key (TC-10)', async () => {
    const boardId = await boardWithRoom();
    const keys: string[] = [];
    for (const [body, expected] of [
      [PNG, 'image/png'],
      [JPEG, 'image/jpeg'],
      [GIF, 'image/gif'],
      [WEBP, 'image/webp'],
    ] as const) {
      const response = await upload(boardId, body, expected);
      expect(response.status).toBe(201);
      expect(response.json.contentType).toBe(expected);
      keys.push(String(response.json.assetKey));
    }
    expect(new Set(keys).size).toBe(4);
    expect(await bucketKeys(boardId)).toEqual([...keys].sort());
  });

  it('refuses a board that was never created, and one that is not a board id (TC-11)', async () => {
    // A board id of the right shape that nobody created: the same answer as a malformed one, so
    // nothing is leaked about which boards exist.
    const neverCreated = newBoardId();
    expect((await upload(neverCreated, PNG, 'image/png')).status).toBe(404);
    expect(await bucketKeys(neverCreated)).toEqual([]);

    for (const malformed of ['short', 'a'.repeat(23), 'x'.repeat(21), '%', '', '..%2f..']) {
      const response = await upload(malformed, PNG, 'image/png');
      expect(response.status).toBe(404);
      expect(response.json.error).toBe('board_not_found');
      // The same "nothing was written", for the board this request was aimed at. A `%` on its own is
      // not decodable at all, which is itself the answer to "is that a board id".
      expect(await bucketKeys(safelyDecoded(malformed))).toEqual([]);
    }

    // The two spellings of `..` are not in the list above, because neither of them ever becomes an
    // upload request: the URL layer decodes `%2e` far enough to recognise a dot segment and then
    // removes it, so `/api/boards/../assets` and `/api/boards/%2e%2e/assets` are both the path
    // `/api/assets` by the time a Worker is asked. That is the strongest possible answer to "can a key
    // be written with `..` in it" — the request that would try does not reach the endpoint that would
    // have to refuse it — so what is asserted here is only that it is never a stored picture.
    for (const dots of ['..', '%2e%2e', '..%2e']) {
      expect((await upload(dots, PNG, 'image/png')).status).not.toBe(201);
    }
  });

  it('refuses a body over 10 MB and stores nothing; takes exactly 10 MB (TC-12, image.size_limit)', async () => {
    const boardId = await boardWithRoom();

    const over = pngAtLimit();
    const bigger = new Uint8Array(IMAGE_MAX_BYTES + 1);
    bigger.set(over, 0);
    expect(bigger.byteLength).toBe(IMAGE_MAX_BYTES + 1);
    const refused = await upload(boardId, bigger, 'image/png');
    expect(refused.status).toBe(413);
    expect(refused.json.error).toBe('too_large');
    expect(await bucketKeys(boardId)).toEqual([]);

    // The other side of the same rule: exactly 10 MB is a picture this board is allowed to have.
    const atLimit = pngAtLimit();
    expect(atLimit.byteLength).toBe(IMAGE_MAX_BYTES);
    expect((await upload(boardId, atLimit, 'image/png')).status).toBe(201);
    expect(await bucketKeys(boardId)).toHaveLength(1);
  });

  it('refuses a lying Content-Length without reading the body (TC-12)', async () => {
    const boardId = await boardWithRoom();
    const response = await SELF.fetch(`https://example.com/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'content-length': String(IMAGE_MAX_BYTES + 4096) },
    });
    expect(response.status).toBe(413);
    // And nothing was written on the way to being refused.
    expect(await bucketKeys(boardId)).toEqual([]);
  });

  it('refuses a PDF wearing a .png name and an SVG, and stores neither (TC-13, image.types)', async () => {
    const boardId = await boardWithRoom();

    // The claim is `image/png`; the bytes are a PDF. A filename is not a file.
    const disguised = await upload(boardId, PDF, 'image/png');
    expect(disguised.status).toBe(415);
    expect(disguised.json.error).toBe('unsupported_type');

    // An SVG is a document that can carry a script, so it is not an image here whatever it is called.
    expect((await upload(boardId, SVG, 'image/svg+xml')).status).toBe(415);
    expect((await upload(boardId, SVG, 'image/png')).status).toBe(415);
    expect((await upload(boardId, junkBytes(64), 'image/png')).status).toBe(415);
    expect((await upload(boardId, new Uint8Array(0), 'image/png')).status).toBe(400);

    expect(await bucketKeys(boardId)).toEqual([]);
  });

  it('answers 500 and stores nothing when the bucket refuses the write (TC-15, image.upload_failure)', async () => {
    const boardId = await boardWithRoom();
    const bucket = bindings.ASSETS_BUCKET;
    const put = bucket.put;
    bucket.put = (async () => {
      throw new Error('the bucket said no');
    }) as typeof bucket.put;
    try {
      const response = await upload(boardId, PNG, 'image/png');
      expect(response.status).toBe(500);
      expect(response.json.error).toBe('storage_failed');
      expect(await bucketKeys(boardId)).toEqual([]);
    } finally {
      bucket.put = put;
    }
    // The very same request once the bucket is well again: a retry is just asking again.
    expect((await upload(boardId, PNG, 'image/png')).status).toBe(201);
  });

  it('stores a picture whose bytes stop in the middle, because only a decoder can tell', async () => {
    const boardId = await boardWithRoom();
    // A truncated PNG has a correct signature. The server has no decoder and does not pretend to; the
    // browser that cannot draw it is the one that reports it (image.decode).
    const response = await upload(boardId, TRUNCATED_PNG, 'image/png');
    expect(response.status).toBe(201);
    expect(await bucketKeys(boardId)).toEqual([String(response.json.assetKey)]);
    const served = await serve(String(response.json.assetKey));
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(TRUNCATED_PNG);
  });

  it('answers anything that is not a POST with 405', async () => {
    const boardId = await boardWithRoom();
    expect((await SELF.fetch(`https://example.com/api/boards/${boardId}/assets`)).status).toBe(405);
  });
});

describe('GET /api/assets/:boardId/:assetId (TC-16)', () => {
  it('serves a stored picture with the type the bytes are and the headers that keep them inert', async () => {
    const boardId = await boardWithRoom();
    const stored = await upload(boardId, PNG, 'image/png');
    const assetKey = String(stored.json.assetKey);

    const response = await serve(assetKey);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(Number(response.headers.get('content-length'))).toBe(PNG.byteLength);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it('answers 404 for a key that was never stored, without storing anything on the way', async () => {
    const boardId = await boardWithRoom();
    const missing = assetKeyFor(boardId, newAssetId());

    const response = await serve(missing);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(await bucketKeys(boardId)).toEqual([]);

    // The other board's picture is not reachable by guessing the other half of the key.
    const stored = await upload(boardId, PNG, 'image/png');
    const assetKey = String(stored.json.assetKey);
    const assetId = assetKey.slice(assetKey.indexOf('/') + 1);
    expect((await serve(assetKeyFor(newBoardId(), assetId))).status).toBe(404);
    expect((await serve(assetKey)).status).toBe(200);
    expect(await bucketKeys(boardId)).toEqual([assetKey]);
  });

  it('refuses a key that is not a key, including every way of writing ".." (TC-16, image.key_shape)', async () => {
    const boardId = await boardWithRoom();
    const stored = await upload(boardId, PNG, 'image/png');
    const assetKey = String(stored.json.assetKey);
    const assetId = assetKey.slice(assetKey.indexOf('/') + 1);

    // Every way of writing `..` that survives the URL layer and still looks like a picture request.
    // `/api/assets/../x` is deliberately absent: the URL takes it out before the Worker is asked, and
    // what comes back is story 1's client bundle for `/x` — an HTML page, and never anybody's picture.
    for (const path of [
      '/api/assets/..%2Fx',
      `/api/assets/..%2F${assetId}`,
      `/api/assets/${boardId}%2F..%2F${boardId}/${assetId}`,
      `/api/assets/${boardId}/%2e%2e`,
      `/api/assets/${boardId}/..%2f${assetId}`,
      `/api/assets/${boardId}/`,
      `/api/assets/${assetId}`,
      '/api/assets/',
      `/api/assets/${'z'.repeat(23)}/${assetId}`,
    ]) {
      const response = await SELF.fetch(`https://example.com${path}`);
      expect(response.status).toBe(404);
      // And never, under any of them, somebody's picture.
      expect(response.headers.get('content-type') ?? '').not.toContain('image/');
    }
    // The picture that is really there is still there, and still only at its own key.
    expect(await bucketKeys(boardId)).toEqual([assetKey]);
  });

  it('does not hand back an object that is not one of our pictures, whatever its metadata claims', async () => {
    const boardId = await boardWithRoom();
    const key = assetKeyFor(boardId, newAssetId());
    // Straight into the bucket, past the upload endpoint: this is what a bucket looks like if anything
    // else ever put a file in it.
    await bindings.ASSETS_BUCKET.put(key, SVG as unknown as ArrayBuffer, {
      httpMetadata: { contentType: 'image/svg+xml' },
    });

    const response = await serve(key);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type') ?? '').not.toContain('svg');
  });

  it('answers 500 when the bucket refuses the read, rather than claiming the picture is missing', async () => {
    const boardId = await boardWithRoom();
    const stored = await upload(boardId, PNG, 'image/png');
    const assetKey = String(stored.json.assetKey);
    const bucket = bindings.ASSETS_BUCKET;
    const get = bucket.get;
    bucket.get = (async () => {
      throw new Error('bucket on fire');
    }) as typeof bucket.get;
    try {
      expect((await serve(assetKey)).status).toBe(500);
    } finally {
      bucket.get = get;
    }
    expect((await serve(assetKey)).status).toBe(200);
  });

  it('re-answers a conditional read with 304, and answers a HEAD with headers and no body', async () => {
    const boardId = await boardWithRoom();
    const stored = await upload(boardId, GIF, 'image/gif');
    const assetKey = String(stored.json.assetKey);

    const first = await serve(assetKey);
    const etag = String(first.headers.get('etag'));
    await first.body?.cancel();
    expect(etag).toContain(assetKey.slice(assetKey.indexOf('/') + 1));

    expect((await serve(assetKey, { 'if-none-match': etag })).status).toBe(304);

    const head = await SELF.fetch(`https://example.com/api/assets/${assetKey}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('image/gif');
    expect(Number(head.headers.get('content-length'))).toBe(GIF.byteLength);
    expect(await head.text()).toBe('');
  });

  it('is asked for a path under /api/assets/ and nothing else answers it', async () => {
    // A request that is clearly about a picture is never quietly handed to the client bundle.
    const response = await SELF.fetch('https://example.com/api/assets/nope');
    expect(response.status).toBe(404);
    expect((await response.text()).includes('<html')).toBe(false);
  });
});


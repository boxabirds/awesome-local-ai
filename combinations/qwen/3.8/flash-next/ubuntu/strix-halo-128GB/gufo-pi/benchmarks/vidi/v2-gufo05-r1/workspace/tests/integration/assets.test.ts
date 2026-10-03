/**
 * The asset API in the runtime it actually runs in: a real Worker, a real R2 bucket, and a
 * real `BoardRoom` answering whether a board exists.
 *
 * Everything here is a fact about a request and about storage — a status code, a response
 * header, whether a key appeared in the bucket — so nothing is stubbed. The one exception is
 * TC-15, where the failure being tested cannot be produced by asking politely: the bucket is
 * wrapped so that its `put` throws.
 *
 * The bytes come from `tests/fixtures/image-bytes.ts` rather than from
 * `tests/fixtures/images/`, because a Worker isolate has no file system at all — the same
 * generator writes both, so these are the same pictures, only inlined.
 *
 * TC-10 a real PNG to a real board: 201, stored, key matches the pattern
 * TC-11 a board that was never created, and a malformed address: 404, nothing stored
 * TC-12 the size limit either side: 413 with nothing stored, 201 at exactly the limit
 * TC-13 a PDF claiming to be a PNG, and an SVG: 415, nothing stored
 * TC-15 the bucket failing: 500
 * TC-16 serving: the bytes, the type, immutable caching, `nosniff`, a CSP of nothing; 404 for
 *      a missing key and for a path that only looks like one
 */
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { handleServe, handleUpload } from '../../src/worker/assets';
import {
  gifBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
  paddedTo,
  svgBytes,
  webpBytes,
} from '../fixtures/image-bytes';

const ORIGIN = 'https://board.test';

interface CreatedBody {
  id: string;
}

/** A board that exists, made the way the home page makes one. */
async function createBoard(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/boards`, { method: 'POST' });
  expect(response.status).toBe(201);
  return ((await response.json()) as CreatedBody).id;
}

/** `POST /api/boards/:boardId/assets` with a raw body. */
function upload(boardId: string, body: Uint8Array, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/boards/${boardId}/assets`, { method: 'POST', body, headers });
}

/** `GET /api/assets/<key>` — the request an `<img>` makes. */
function serve(path: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/assets/${path}`);
}

/** The keys in the bucket, optionally only those of one board. */
async function storedKeys(prefix?: string): Promise<string[]> {
  const listed = await env.ASSETS_BUCKET.list(prefix === undefined ? {} : { prefix });
  return listed.objects.map((object) => object.key);
}

/** Read a stored object back out of the bucket, bypassing the Worker entirely. */
async function storedObject(key: string): Promise<R2ObjectBody> {
  const object = await env.ASSETS_BUCKET.get(key);
  if (object === null) throw new Error(`nothing is stored at ${key}`);
  return object;
}

interface UploadBody {
  assetKey?: string;
  contentType?: string;
  error?: string;
}

/** Upload one accepted image and hand back what the response said. */
async function uploadExpectingCreated(boardId: string, bytes: Uint8Array): Promise<UploadBody> {
  const response = await upload(boardId, bytes);
  expect(response.status).toBe(201);
  return (await response.json()) as UploadBody;
}

describe('POST /api/boards/:boardId/assets (TC-10 to TC-13, TC-15)', () => {
  it('stores a real PNG for a board that exists, under a key of its own (TC-10)', async () => {
    const boardId = await createBoard();
    const bytes = pngBytes();

    const body = await uploadExpectingCreated(boardId, bytes);

    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toBe(`${boardId}/${(body.assetKey ?? '').split('/')[1]}`);
    expect(ASSET_KEY_PATTERN.test(body.assetKey ?? '')).toBe(true);

    const stored = await storedObject(body.assetKey ?? '');
    expect(stored.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(bytes);
  });

  it('records the type it sniffed, not the one the request claimed (TC-10)', async () => {
    const boardId = await createBoard();

    const jpeg = await uploadExpectingCreated(boardId, jpegBytes());
    const gif = await uploadExpectingCreated(boardId, gifBytes());
    const webp = await uploadExpectingCreated(boardId, webpBytes());

    expect(jpeg.contentType).toBe('image/jpeg');
    expect(gif.contentType).toBe('image/gif');
    expect(webp.contentType).toBe('image/webp');
    expect(await storedKeys(boardId)).toHaveLength(3);
  });

  it('gives every upload a different key (TC-10)', async () => {
    const boardId = await createBoard();
    const first = await uploadExpectingCreated(boardId, pngBytes());
    const second = await uploadExpectingCreated(boardId, pngBytes());
    expect(first.assetKey).not.toBe(second.assetKey);
  });

  it('refuses a board that was never created, and stores nothing (TC-11)', async () => {
    const invented = newBoardId();
    const response = await upload(invented, pngBytes());

    expect(response.status).toBe(404);
    expect(await storedKeys(invented)).toEqual([]);
  });

  it('refuses an address that cannot name a board, without touching a room (TC-11)', async () => {
    // Nothing is stored, and nothing is looked up: the id check runs before the namespace is
    // asked, so a made-up address cannot cost a Durable Object, let alone a write.
    for (const malformed of ['not-a-board-id', 'short', `${newBoardId()}x`, '']) {
      const response = await upload(malformed, pngBytes());
      expect(response.status).toBe(404);
    }
  });

  it('refuses a body one byte over the limit, and stores nothing (TC-12)', async () => {
    const boardId = await createBoard();
    const over = paddedTo(jpegBytes(), IMAGE_MAX_BYTES + 1);

    const response = await upload(boardId, over);

    expect(response.status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('accepts a body of exactly the limit (TC-12)', async () => {
    const boardId = await createBoard();
    const exact = paddedTo(jpegBytes(), IMAGE_MAX_BYTES);

    const response = await upload(boardId, exact);

    expect(response.status).toBe(201);
    const body = (await response.json()) as UploadBody;
    expect(body.contentType).toBe('image/jpeg');
    const stored = await storedObject(body.assetKey ?? '');
    expect(stored.size).toBe(IMAGE_MAX_BYTES);
  });

  it('refuses an oversized upload on its declared length, before reading the body (TC-12)', async () => {
    const boardId = await createBoard();
    // A body of a handful of bytes whose `Content-Length` claims more than the limit: the
    // check that runs first is the cheap one, and it must run at all.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(pngBytes());
        controller.close();
      },
    });
    const request = new Request(`${ORIGIN}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: stream,
      headers: { 'Content-Length': String(IMAGE_MAX_BYTES + 1) },
    });

    const response = await handleUpload(request, env, boardId);

    expect(response.status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('refuses a PDF whose Content-Type says PNG, and stores nothing (TC-13)', async () => {
    const boardId = await createBoard();

    const response = await upload(boardId, pdfBytes(), { 'Content-Type': 'image/png' });

    expect(response.status).toBe(415);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('refuses an SVG, which is markup and could carry script (TC-13)', async () => {
    const boardId = await createBoard();

    const response = await upload(boardId, svgBytes(), { 'Content-Type': 'image/svg+xml' });

    expect(response.status).toBe(415);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('refuses three bytes that are nothing at all', async () => {
    const boardId = await createBoard();
    const response = await upload(boardId, new Uint8Array([0x13, 0x84, 0xf7]));
    expect(response.status).toBe(415);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('answers 500 when the bucket cannot store the object (TC-15)', async () => {
    const boardId = await createBoard();
    const failing = new Proxy(env.ASSETS_BUCKET, {
      get(target, property, receiver) {
        // The whole point of the test: the failure happens at the write, after every check
        // the Worker makes has passed.
        if (property === 'put') throw new Error('bucket offline');
        return Reflect.get(target, property, receiver);
      },
    }) as R2Bucket;

    const response = await handleUpload(
      new Request(`${ORIGIN}/api/boards/${boardId}/assets`, { method: 'POST', body: pngBytes() }),
      { ...env, ASSETS_BUCKET: failing },
      boardId,
    );

    expect(response.status).toBe(500);
    expect(((await response.json()) as UploadBody).error).toBe('storage_failed');
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('refuses a method that is not POST', async () => {
    const boardId = await createBoard();
    const response = await SELF.fetch(`${ORIGIN}/api/boards/${boardId}/assets`);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });
});

describe('GET /api/assets/:boardId/:assetId (TC-16)', () => {
  it('serves the stored bytes with the type that was sniffed, and headers that cannot run', async () => {
    const boardId = await createBoard();
    const bytes = pngBytes();
    const { assetKey } = await uploadExpectingCreated(boardId, bytes);

    const response = await serve(assetKey ?? '');

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
  });

  it('answers 404 for a key that was never stored', async () => {
    const boardId = await createBoard();
    const response = await serve(`${boardId}/${newBoardId()}`);
    expect(response.status).toBe(404);
  });

  it('answers 404 for a path that is not a key, without asking the bucket (TC-16)', async () => {
    // Straight into the handler, because a literal `../` in a URL is normalised away by the
    // URL parser before any Worker sees it. What the pattern has to refuse is the decoded
    // path, which is what `%2e%2e%2fx` becomes.
    const missing = new Proxy(env.ASSETS_BUCKET, {
      get(_target, property) {
        throw new Error(`the bucket should not be asked about ${String(property)}`);
      },
    }) as R2Bucket;

    for (const key of ['../x', '%2e%2e%2fx', 'not-a-key', newBoardId(), `${newBoardId()}/`, `${newBoardId()}/${newBoardId()}x`]) {
      const response = await handleServe({ ...env, ASSETS_BUCKET: missing }, key);
      expect(response.status).toBe(404);
    }
  });

  it('answers 404 for a percent-encoding that does not decode', async () => {
    const response = await serve('%zz%zz');
    expect(response.status).toBe(404);
  });

  it('answers 404 for a key whose id is one character too long', async () => {
    const boardId = await createBoard();
    const { assetKey } = await uploadExpectingCreated(boardId, pngBytes());
    const response = await serve(`${assetKey}x`);
    expect(response.status).toBe(404);
  });

  it('refuses a method that is not GET', async () => {
    const boardId = await createBoard();
    const { assetKey } = await uploadExpectingCreated(boardId, pngBytes());
    const response = await SELF.fetch(`${ORIGIN}/api/assets/${assetKey}`, { method: 'POST', body: 'x' });
    expect(response.status).toBe(405);
  });
});

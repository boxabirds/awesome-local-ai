import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import type { Env } from '../../src/worker/index';
import { fixtureBytes, paddedJpeg } from '../fixtures/images';

/**
 * Story 12 — the asset API (assets.api).
 *
 * Every decision here is a storage fact or a response header, so there is nothing to
 * mock: `SELF.fetch` runs the real Worker, `env.ASSETS_BUCKET` is Miniflare's real R2,
 * and "does this board exist" is answered by the real story 5 `exists()` RPC. The two
 * things worth proving are that nothing is ever written on an error path, and that a
 * stored image cannot be read as anything but an image.
 */

const bucket = () => (env as unknown as Env).ASSETS_BUCKET;

/** `POST /api/boards`, the only way a board comes to exist (story 5). */
async function createBoardId(): Promise<string> {
  const response = await SELF.fetch('http://worker/api/boards', { method: 'POST' });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

const upload = (boardId: string, body: BodyInit, headers?: HeadersInit) =>
  SELF.fetch(`http://worker/api/boards/${boardId}/assets`, { method: 'POST', body, headers });

const serve = (key: string) => SELF.fetch(`http://worker/api/assets/${key}`);

/** A body in pieces, so the request carries no `Content-Length` the Worker could trust. */
function chunkedBody(chunks: readonly Uint8Array[]): BodyInit {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }) as unknown as BodyInit;
}

/** A byte string cut into `n` near-equal pieces. */
function split(bytes: Uint8Array, n: number): Uint8Array[] {
  const size = Math.ceil(bytes.byteLength / n);
  const pieces: Uint8Array[] = [];
  for (let at = 0; at < bytes.byteLength; at += size) pieces.push(bytes.subarray(at, at + size));
  return pieces;
}

/**
 * The keys this board has uploaded. Every test works against its own board, so a
 * count of this prefix is an answer about this test — other boards may be uploading
 * in the suite's other files.
 */
async function storedKeys(boardId: string): Promise<string[]> {
  const listed = await bucket().list({ prefix: `${boardId}/` });
  return listed.objects.map((object) => object.key).sort();
}

describe('POST /api/boards/:boardId/assets (image.types, image.size_limit, share.unguessable)', () => {
  // TC-10: an accepted upload is stored, sniffed, and addressed by an unguessable key.
  it('TC-10 stores a real PNG for a board that exists and returns its key', async () => {
    const boardId = await createBoardId();
    const png = await fixtureBytes('photo.png');
    expect(await storedKeys(boardId)).toEqual([]);

    const response = await upload(boardId, png);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    // The key's second half is a fresh 128-bit id, not the board's own id again.
    expect(body.assetKey.split('/')[1]).not.toBe(boardId);

    const stored = await bucket().get(body.assetKey);
    if (!stored) throw new Error(`nothing stored at ${body.assetKey}`);
    expect(stored.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(png);
    expect(await storedKeys(boardId)).toEqual([body.assetKey]);
  });

  // TC-11: a board that was never created cannot receive uploads, and neither can an
  // id that was never a board id.
  it('TC-11 refuses a board that does not exist, and a malformed id, storing nothing', async () => {
    const png = await fixtureBytes('photo.png');

    const neverCreated = newBoardId();
    expect((await upload(neverCreated, png)).status).toBe(404);
    expect(await storedKeys(neverCreated)).toEqual([]);

    for (const bad of ['short', 'has spaces', 'a'.repeat(23), '..%2Fboards']) {
      expect((await upload(bad, png)).status).toBe(404);
    }
  });

  // TC-12: the size limit is a limit *and* it is inclusive.
  it('TC-12 refuses one byte past IMAGE_MAX_BYTES and accepts exactly at it', async () => {
    const boardId = await createBoardId();
    const jpeg = await fixtureBytes('photo.jpg');

    const over = await upload(boardId, paddedJpeg(jpeg, IMAGE_MAX_BYTES + 1));
    expect(over.status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);

    const at = await upload(boardId, paddedJpeg(jpeg, IMAGE_MAX_BYTES));
    expect(at.status).toBe(201);
    const { assetKey } = (await at.json()) as { assetKey: string };
    const stored = await bucket().get(assetKey);
    if (!stored) throw new Error(`nothing stored at ${assetKey}`);
    expect(stored.httpMetadata?.contentType).toBe('image/jpeg');
    expect((await stored.arrayBuffer()).byteLength).toBe(IMAGE_MAX_BYTES);
  });

  // TC-12 again, but with a body that never declares its size: the limit has to be
  // enforced against the bytes as they arrive, not against a header. A chunked upload is
  // also how a browser without `Content-Length` would talk to this route.
  it('TC-12 enforces the limit on a streamed body, and still stores a streamed upload', async () => {
    const boardId = await createBoardId();
    const png = await fixtureBytes('photo.png');

    // The same chunk instance enqueued again and again: the count the Worker keeps is of
    // bytes that arrived, and it needs no 10 MB allocation here to make that point.
    const oneMegabyte = new Uint8Array(1024 * 1024);
    oneMegabyte.set(png.subarray(0, 12), 0); // real image bytes at the very front
    const streamed = await upload(
      boardId,
      chunkedBody(Array.from({ length: IMAGE_MAX_BYTES / oneMegabyte.byteLength + 1 }, () => oneMegabyte)),
    );
    expect(streamed.status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);

    const small = await upload(boardId, chunkedBody(split(png, 3)));
    expect(small.status).toBe(201);
    const { assetKey } = (await small.json()) as { assetKey: string };
    const stored = await bucket().get(assetKey);
    if (!stored) throw new Error(`nothing stored at ${assetKey}`);
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(png);
  });
  it('refuses a body that declares itself larger than the limit without reading it', async () => {
    const boardId = await createBoardId();
    const response = await upload(boardId, new Uint8Array(8), {
      'content-length': String(IMAGE_MAX_BYTES + 1),
    });
    expect(response.status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  // TC-13: what a file *is* comes from its bytes. A PDF and an SVG never enter storage.
  it('TC-13 refuses a renamed PDF and an SVG, whatever the request claims', async () => {
    const boardId = await createBoardId();

    // a client lying about the body is still refused, because the bytes are the evidence
    const disguised = await upload(boardId, await fixtureBytes('fake.png'), {
      'content-type': 'image/png',
    });
    expect(disguised.status).toBe(415);

    const svg = await upload(boardId, await fixtureBytes('script.svg'), {
      'content-type': 'image/svg+xml',
    });
    expect(svg.status).toBe(415);

    // A body too short to carry a header is not an image either.
    const stub = await upload(boardId, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(stub.status).toBe(415);

    expect(await storedKeys(boardId)).toEqual([]);
  });

  // TC-15: storage that fails gets the person a 500, not a half-written board.
  it('TC-15 answers 500 when the bucket refuses to store', async () => {
    const boardId = await createBoardId();
    const target = bucket() as unknown as { put: R2Bucket['put'] };
    const original = target.put;
    Object.defineProperty(target, 'put', {
      value: () => {
        throw new Error('r2 is down');
      },
      configurable: true,
      writable: true,
    });
    try {
      expect((await upload(boardId, await fixtureBytes('photo.png'))).status).toBe(500);
      expect(await storedKeys(boardId)).toEqual([]); // the failed attempt wrote nothing
    } finally {
      Object.defineProperty(target, 'put', { value: original, configurable: true, writable: true });
    }
    // The bucket works again, and so does the same upload.
    expect((await upload(boardId, await fixtureBytes('photo.png'))).status).toBe(201);
  });

  it('wants POST: a GET on the upload route is not an upload', async () => {
    const boardId = await createBoardId();
    expect((await SELF.fetch(`http://worker/api/boards/${boardId}/assets`)).status).toBe(405);
  });
});

describe('GET /api/assets/:boardId/:assetId (image.shared, share.unguessable)', () => {
  // TC-16: the stored bytes come back as an image and nothing else, for a year.
  it('TC-16 serves a stored key with immutable caching, nosniff and a locked CSP', async () => {
    const boardId = await createBoardId();
    const webp = await fixtureBytes('photo.webp');
    const { assetKey } = (await (await upload(boardId, webp)).json()) as { assetKey: string };

    const served = await serve(assetKey);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(served.headers.get('cache-control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(webp);
  });

  it('TC-16 answers 404 for a key that is missing, malformed, or a path walk', async () => {
    const boardId = await createBoardId();
    expect((await serve(`${boardId}/${newBoardId()}`)).status).toBe(404);
    expect((await serve('not-a-key')).status).toBe(404);
    expect((await serve(`${boardId}/${boardId}/extra`)).status).toBe(404);
    // `%2F` survives URL normalisation, so `../x` arrives as a *candidate* key and is
    // refused by the pattern rather than by accident. (A literal `..` segment never
    // reaches the route at all: the URL parser removes it, and the answer is a 404 from
    // the static assets, which is also not an image.)
    expect((await SELF.fetch('http://worker/api/assets/..%2Fx')).status).toBe(404);
    expect((await SELF.fetch('http://worker/api/assets/%2e%2e%2Fx')).status).toBe(404);
  });

  it('serves the same bytes for the same key, which is why it may be cached forever', async () => {
    const boardId = await createBoardId();
    const gif = await fixtureBytes('animated.gif');
    const { assetKey } = (await (await upload(boardId, gif)).json()) as { assetKey: string };
    const first = await serve(assetKey);
    const second = await serve(assetKey);
    expect(await first.arrayBuffer()).toEqual(await second.arrayBuffer());
    expect(first.headers.get('content-type')).toBe('image/gif');
  });
});

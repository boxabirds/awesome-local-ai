/**
 * Asset API integration tests (TC-10 to TC-13, TC-15, TC-16, plus the rest of the asset contract).
 *
 * These exercise the real Worker, the real Durable Object existence rule and a real R2 bucket: the
 * upload path is only worth testing where the sniffing, the size limit and the write all meet.
 *
 * Two kinds of assertion matter here. One is what the client can see - status, key shape, served
 * bytes and headers. The other is the negative half: that a rejected upload wrote *nothing*. For
 * that the bucket is wrapped in a recording proxy, so "nothing was written" is a fact about the
 * bucket rather than an absence of evidence.
 *
 * The bodies are assembled in code (see `image-bytes.ts`): an integration test runs inside workerd,
 * which cannot see the fixture files on disk, and the asset API inspects nothing but the first bytes
 * and the byte count. The real files are used where a real decoder is involved - the browser tests.
 */
import { describe, expect, test } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN, sniffImageType } from '../../src/shared/image-format';
import worker, { type Env } from '../../src/worker/index';
import {
  corruptPngBytes,
  gifBytes,
  jpegBytes,
  jpegOfLength,
  pdfBytes,
  pngBytes,
  pngOfLength,
  svgBytes,
  textBytes,
  webpBytes,
} from './image-bytes';

/** Bytes from a list, so a body in these tests reads like the format it imitates. */
function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

/**
 * A bucket wrapper that records the keys it was asked to write and to read, and can fail on write.
 *
 * Everything else is passed through, so the Worker under test still talks to the real bucket: the
 * point is to observe the two calls that the contract cares about, not to replace storage.
 */
function recordingBucket(into: { put: string[]; get: string[] }, failPut = false): R2Bucket {
  const real = env.ASSETS_BUCKET;
  return new Proxy(real, {
    get(target, property, receiver) {
      if (property === 'put') {
        return async (key: string, value: ArrayBuffer | ArrayBufferView | string | Blob | null, options?: R2PutOptions) => {
          into.put.push(key);
          if (failPut) throw new Error('injected R2 write failure');
          return target.put(key, value, options);
        };
      }
      if (property === 'get') {
        return async (key: string, options?: R2GetOptions) => {
          into.get.push(key);
          return target.get(key, options);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** A board that exists, created the way the client creates one. */
async function createBoard(): Promise<string> {
  const response = await SELF.fetch('http://vidi6.local/api/boards', { method: 'POST' });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

function uploadRequest(boardId: string, body: BodyInit, headers?: HeadersInit): Request {
  return new Request(`http://vidi6.local/api/boards/${boardId}/assets`, {
    method: 'POST',
    body,
    headers,
  });
}

describe('the bodies these tests upload', () => {
  test('each body announces itself by its leading bytes, which is all the server reads', () => {
    expect(sniffImageType(pngBytes())).toBe('image/png');
    expect(sniffImageType(jpegBytes())).toBe('image/jpeg');
    expect(sniffImageType(gifBytes())).toBe('image/gif');
    expect(sniffImageType(webpBytes())).toBe('image/webp');
    expect(sniffImageType(svgBytes())).toBeNull();
    expect(sniffImageType(pdfBytes())).toBeNull();
    expect(sniffImageType(textBytes())).toBeNull();
    // a broken PNG opens like a PNG: only the browser can find out it is broken, which is what the
    // `failed` placeholder is for. The server's job stops at "is this one of the four formats".
    expect(sniffImageType(corruptPngBytes())).toBe('image/png');
  });
});

describe('POST /api/boards/:boardId/assets (TC-10 to TC-13, TC-15)', () => {
  test('TC-10: a PNG upload to a real board is 201, and the stored bytes come back unchanged', async () => {
    const boardId = await createBoard();
    const png = pngBytes(1440, 900, 1024);

    const response = await SELF.fetch(uploadRequest(boardId, png));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { assetKey: string; contentType: string };
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    expect(body.contentType).toBe('image/png');

    // the object is really in the bucket, with the type recorded alongside it
    const stored = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(stored).not.toBeNull();
    expect(stored?.httpMetadata?.contentType).toBe('image/png');

    const served = await SELF.fetch(`http://vidi6.local/api/assets/${body.assetKey}`);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);
    expect(served.headers.get('Content-Type')).toBe('image/png');
    // an address that never changes may be cached for a year and never re-asked
    expect(served.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(served.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
  });

  test('TC-10 a JPEG, GIF and WebP upload are each accepted as the type their bytes say', async () => {
    const boardId = await createBoard();
    const cases = [
      ['jpeg', jpegBytes(2048), 'image/jpeg'],
      ['gif', gifBytes(512), 'image/gif'],
      ['webp', webpBytes(512), 'image/webp'],
    ] as const;

    for (const [name, bytes, contentType] of cases) {
      const response = await SELF.fetch(uploadRequest(boardId, bytes));
      expect(response.status, name).toBe(201);
      const body = (await response.json()) as { assetKey: string; contentType: string };
      expect(body.contentType, name).toBe(contentType);

      const served = await SELF.fetch(`http://vidi6.local/api/assets/${body.assetKey}`);
      expect(served.status, name).toBe(200);
      expect(served.headers.get('Content-Type'), name).toBe(contentType);
      expect(new Uint8Array(await served.arrayBuffer()), name).toEqual(bytes);
    }
  });

  test('TC-11: a never-created board id and a malformed one are both 404 with nothing stored', async () => {
    const seen: { put: string[]; get: string[] } = { put: [], get: [] };
    const proxied: Env = { ...env, ASSETS_BUCKET: recordingBucket(seen) };

    // a perfectly valid address for a board that does not exist
    const unknown = await worker.fetch(
      uploadRequest(newBoardId(), pngBytes(800, 600, 4096)),
      proxied,
    );
    expect(unknown.status).toBe(404);

    for (const bad of ['abc', 'A'.repeat(23), 'has!bad', '']) {
      const response = await worker.fetch(uploadRequest(bad, pngBytes()), proxied);
      expect(response.status, bad).toBe(404);
    }

    // the negative half: nothing was written for any of them
    expect(seen.put).toEqual([]);
  });

  test('TC-12: exactly ten megabytes is stored, one byte more is 413 with nothing written', async () => {
    const boardId = await createBoard();
    const seen: { put: string[]; get: string[] } = { put: [], get: [] };
    const proxied: Env = { ...env, ASSETS_BUCKET: recordingBucket(seen) };

    // the boundary that is allowed: exactly the limit, a real JPEG
    const fits = await worker.fetch(uploadRequest(boardId, jpegOfLength(IMAGE_MAX_BYTES)), proxied);
    expect(fits.status).toBe(201);
    expect(seen.put).toHaveLength(1);

    // the boundary that is not: one byte more
    const tooBig = await worker.fetch(
      uploadRequest(boardId, pngOfLength(IMAGE_MAX_BYTES + 1)),
      proxied,
    );
    expect(tooBig.status).toBe(413);
    expect(seen.put).toHaveLength(1);
  });

  test('TC-12 a lying Content-Length does not let an oversized body through', async () => {
    const boardId = await createBoard();
    const seen: { put: string[]; get: string[] } = { put: [], get: [] };
    const proxied: Env = { ...env, ASSETS_BUCKET: recordingBucket(seen) };

    // Claims to be tiny; the byte count is what decides.
    const response = await worker.fetch(
      uploadRequest(boardId, pngOfLength(IMAGE_MAX_BYTES + 1), { 'content-length': '16' }),
      proxied,
    );
    expect(response.status).toBe(413);
    expect(seen.put).toEqual([]);
  });

  test('TC-13: a PDF sent as image/png and an SVG are refused 415, nothing stored', async () => {
    const boardId = await createBoard();
    const seen: { put: string[]; get: string[] } = { put: [], get: [] };
    const proxied: Env = { ...env, ASSETS_BUCKET: recordingBucket(seen) };

    // the exact case the story is about: a PDF whose claimed Content-Type is a picture
    const disguised = await worker.fetch(
      uploadRequest(boardId, pdfBytes(), { 'content-type': 'image/png' }),
      proxied,
    );
    expect(disguised.status).toBe(415);

    // and an SVG, which can carry a script
    const vector = await worker.fetch(uploadRequest(boardId, svgBytes()), proxied);
    expect(vector.status).toBe(415);

    // the rest of what is not one of the four formats
    for (const [name, body] of [
      ['plain text', textBytes()],
      ['empty body', new Uint8Array(0)],
      ['bytes too short to be anything', bytes(0x00, 0x01, 0x02)],
    ] as const) {
      const response = await worker.fetch(uploadRequest(boardId, body), proxied);
      expect(response.status, name).toBe(415);
    }

    expect(seen.put).toEqual([]);
  });

  test('TC-15: when the bucket write fails the response is 500 and nothing was stored', async () => {
    const boardId = await createBoard();
    const seen: { put: string[]; get: string[] } = { put: [], get: [] };
    const proxied: Env = { ...env, ASSETS_BUCKET: recordingBucket(seen, true) };

    const response = await worker.fetch(uploadRequest(boardId, pngBytes(640, 480, 2048)), proxied);
    expect(response.status).toBe(500);

    // nothing under this board survived the attempt
    const listed = await env.ASSETS_BUCKET.list({ prefix: boardId });
    expect(listed.objects).toHaveLength(0);
  });

  test('a broken PNG is stored, because only a browser can tell it is broken', async () => {
    const boardId = await createBoard();
    const response = await SELF.fetch(uploadRequest(boardId, corruptPngBytes()));
    expect(response.status).toBe(201);
    const { assetKey } = (await response.json()) as { assetKey: string };
    const served = await SELF.fetch(`http://vidi6.local/api/assets/${assetKey}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('Content-Type')).toBe('image/png');
  });

  test('an upload is reachable only under the key it returned, not under another board', async () => {
    const one = await createBoard();
    const two = await createBoard();
    const response = await SELF.fetch(uploadRequest(one, pngBytes(250, 250, 256)));
    const { assetKey } = (await response.json()) as { assetKey: string };

    // the same asset id under another board is a different address, with nothing behind it
    const foreign = await SELF.fetch(
      `http://vidi6.local/api/assets/${two}/${assetKey.split('/')[1]}`,
    );
    expect(foreign.status).toBe(404);
  });
});

describe('GET /api/assets/:boardId/:assetId (TC-16)', () => {
  test('TC-16: a stored key serves its bytes with the headers that keep them inert', async () => {
    const boardId = await createBoard();
    const gif = gifBytes(4096);
    const response = await SELF.fetch(uploadRequest(boardId, gif));
    const { assetKey } = (await response.json()) as { assetKey: string };

    const served = await SELF.fetch(`http://vidi6.local/api/assets/${assetKey}`);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(gif);
    expect(served.headers.get('Content-Type')).toBe('image/gif');
    expect(served.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(served.headers.get('Content-Security-Policy')).toBe("default-src 'none'");

    // the same address read twice is the same bytes: nothing about it changes
    const again = await SELF.fetch(`http://vidi6.local/api/assets/${assetKey}`);
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(gif);
    expect(again.headers.get('ETag')).toBe(served.headers.get('ETag'));
  });

  test('TC-16: a well shaped key that holds nothing is a 404', async () => {
    const missing = `${newBoardId()}/${newBoardId()}`;
    const response = await SELF.fetch(`http://vidi6.local/api/assets/${missing}`);
    expect(response.status).toBe(404);
  });

  test('TC-16: a malformed key is a 404 and the bucket is never read', async () => {
    const seen: { put: string[]; get: string[] } = { put: [], get: [] };
    const proxied: Env = { ...env, ASSETS_BUCKET: recordingBucket(seen) };

    const boardId = newBoardId();
    const assetId = newBoardId();
    const cases = [
      '../x', // the shape the contract names
      '../etc/passwd',
      boardId, // one address, not two
      `${boardId}/${assetId}/extra`, // three segments
      `${boardId}/`, // an empty second half
      `${boardId}/short`, // a second half that is not an address
      `${boardId}/..%2Fsecret`, // something that only looks like a path
    ];

    for (const key of cases) {
      const response = await worker.fetch(
        new Request(`http://vidi6.local/api/assets/${key}`),
        proxied,
      );
      expect(response.status, key).toBe(404);
    }
    // the negative half: a key that is not two addresses never reaches storage
    expect(seen.get).toEqual([]);
  });
});

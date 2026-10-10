import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { handleUpload } from '../../src/worker/assets';
import type { Env } from '../../src/worker/index';
import {
  gifHeader,
  jpegHeader,
  jpegSized,
  pdfBytes,
  pngBytes,
  webpBytes,
} from '../fixtures/image-bytes';

/**
 * The asset routes (`image.storage.serving`), against the real Worker with a real R2 bucket
 * and the real board-existence rule (TC-10 to TC-13, TC-15, TC-16).
 *
 * What is under test is a promise about storage rather than about responses: a board's bucket
 * ends up holding *images and only images*, because everything that was refused — oversized,
 * mislabelled, unknown board, broken bucket — has to leave the bucket empty, and everything
 * it accepted has to come back with a `Content-Type` this Worker chose from the bytes. Only
 * the second half of that makes the first half safe.
 *
 * The bytes here are the built-in signature-level fixtures: workerd has no file system to
 * read a fixture from, and the server never decodes an image, so these are exactly as good
 * as the real files for a test that asks what got stored.
 */

/** The Worker's own bindings, which `cloudflare:test` hands back untyped. */
const workerEnv = env as unknown as Env;

function get(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`http://vc.test${path}`, init);
}

/** A board that exists, with storage, as the upload endpoints require. */
async function createBoard(): Promise<string> {
  const response = await get('/api/boards', { method: 'POST' });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string };
  return body.id;
}

function upload(boardId: string, body: Uint8Array, headers?: HeadersInit): Promise<Response> {
  return get(`/api/boards/${boardId}/assets`, { method: 'POST', body, headers });
}

/** Every key in the bucket that belongs to `boardId`. */
async function keysOf(boardId: string): Promise<string[]> {
  const listed = await workerEnv.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
  return listed.objects.map((object) => object.key);
}

/** The whole bucket, for the cases where the board id is not a thing that has a prefix. */
async function allKeys(): Promise<string[]> {
  const listed = await workerEnv.ASSETS_BUCKET.list();
  return listed.objects.map((object) => object.key);
}

async function uploadAndReadKey(boardId: string, bytes: Uint8Array): Promise<string> {
  const response = await upload(boardId, bytes);
  expect(response.status).toBe(201);
  const body = (await response.json()) as { assetKey?: string };
  const key = body.assetKey ?? '';
  expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  return key;
}

describe('TC-10: an accepted upload is stored in the board', () => {
  it('answers 201 with a key that names a real object of the sniffed type', async () => {
    const boardId = await createBoard();
    const response = await upload(boardId, pngBytes());
    expect(response.status).toBe(201);
    const body = (await response.json()) as { assetKey?: string; contentType?: string };
    expect(body.contentType).toBe('image/png');
    const key = body.assetKey ?? '';
    // The key is the board's own, so one board's images cannot be read out of another's.
    expect(key.startsWith(`${boardId}/`)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);

    const stored = await workerEnv.ASSETS_BUCKET.get(key);
    expect(stored).not.toBeNull();
    expect(stored!.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(pngBytes());
  });

  it('accepts every kind the config lists, judged by content', async () => {
    const boardId = await createBoard();
    const cases: [string, Uint8Array][] = [
      ['image/png', pngBytes()],
      ['image/jpeg', jpegHeader()],
      ['image/gif', gifHeader()],
      ['image/webp', webpBytes()],
    ];
    for (const [contentType, bytes] of cases) {
      const response = await upload(boardId, bytes);
      expect(response.status).toBe(201);
      const body = (await response.json()) as { assetKey: string };
      const stored = await workerEnv.ASSETS_BUCKET.get(body.assetKey);
      expect(stored!.httpMetadata?.contentType).toBe(contentType);
    }
    expect(await keysOf(boardId)).toHaveLength(cases.length);
  });
});

describe('TC-11: an upload to a board that is not there is not stored', () => {
  it('refuses a well-formed board id that was never created', async () => {
    const boardId = newBoardId();
    expect(isValidBoardId(boardId)).toBe(true);
    const response = await upload(boardId, pngBytes());
    expect(response.status).toBe(404);
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('refuses a malformed board id without asking the namespace', async () => {
    // `/api/boards/<junk>/assets` must not reach `idFromName`, which would otherwise create
    // a room object for every guess (story 5's rule, same route shape). An id of the wrong
    // length is the interesting case, since it is otherwise base64url.
    const before = await allKeys();
    for (const bad of ['short', 'has%20space', 'A'.repeat(21), 'A'.repeat(23), '']) {
      const response = await upload(bad, pngBytes());
      expect(response.status).toBe(404);
    }
    // Nothing anywhere gained an object, which is the part a 404 alone cannot show.
    expect((await allKeys()).length).toBe(before.length);
  });

  it('refuses a board that exists only as an address, and says nothing else', async () => {
    // A `HEAD`/`GET` on the asset sub-path is a wrong verb, not a wrong board: it says what
    // it wanted rather than pretending the route is elsewhere.
    const boardId = await createBoard();
    const response = await get(`/api/boards/${boardId}/assets`, { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(await keysOf(boardId)).toEqual([]);
  });
});

describe('TC-12: a file over the limit never lands', () => {
  it('refuses 10 MB + 1 byte and stores nothing', async () => {
    const boardId = await createBoard();
    const oversize = jpegSized(IMAGE_MAX_BYTES + 1);
    const response = await upload(boardId, oversize, {
      'content-length': String(oversize.byteLength),
    });
    expect(response.status).toBe(413);
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('refuses the same body when `Content-Length` claims it is smaller', async () => {
    // The header is a claim about a body somebody could lie about; the byte count is a fact
    // about the bytes that arrived, and it is the one that decides.
    const boardId = await createBoard();
    const oversize = jpegSized(IMAGE_MAX_BYTES + 1);
    const response = await upload(boardId, oversize, { 'content-length': '12' });
    expect(response.status).toBe(413);
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('accepts exactly 10 MB', async () => {
    const boardId = await createBoard();
    const atLimit = jpegSized(IMAGE_MAX_BYTES);
    const key = await uploadAndReadKey(boardId, atLimit);
    const stored = await workerEnv.ASSETS_BUCKET.get(key);
    expect(stored!.key).toBe(key);
  });
});

describe('TC-13: a file that is not an image is refused whatever it claims', () => {
  it('refuses a PDF wearing a PNG upload, and stores nothing', async () => {
    const boardId = await createBoard();
    const response = await upload(boardId, pdfBytes(), { 'content-type': 'image/png' });
    expect(response.status).toBe(415);
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('refuses an SVG, which is a document rather than a picture', async () => {
    const boardId = await createBoard();
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const response = await upload(boardId, svg, { 'content-type': 'image/svg+xml' });
    expect(response.status).toBe(415);
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('refuses a file that starts like a PNG and stops being one', async () => {
    const boardId = await createBoard();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const response = await upload(boardId, bytes);
    expect(response.status).toBe(415);
    expect(await keysOf(boardId)).toEqual([]);
  });
});

describe('TC-15: a bucket that will not take the bytes says so', () => {
  it('answers 500 and stores nothing when the put fails', async () => {
    const boardId = await createBoard();
    const brokenBucket = {
      ...workerEnv.ASSETS_BUCKET,
      put: () => {
        throw new Error('bucket on fire');
      },
    } as unknown as R2Bucket;
    const request = new Request(`http://vc.test/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: pngBytes(),
    });
    const response = await handleUpload(request, { ...workerEnv, ASSETS_BUCKET: brokenBucket }, boardId);
    expect(response.status).toBe(500);
    expect(await keysOf(boardId)).toEqual([]);
  });
});

describe('TC-16: serving an asset says what it is and cannot be made to run', () => {
  it('serves the bytes with the type that was sniffed and headers that refuse execution', async () => {
    const boardId = await createBoard();
    const key = await uploadAndReadKey(boardId, pngBytes());

    const response = await get(`/api/assets/${key}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes());
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
  });

  it('answers 404 for a key that is not there', async () => {
    const boardId = await createBoard();
    const response = await get(`/api/assets/${boardId}/${newBoardId()}`);
    expect(response.status).toBe(404);
  });

  it('answers 404 for a path that cannot be a key', async () => {
    // The interesting cases are the ones that try to climb out of the bucket's name space:
    // `..` in a path, and its percent-encoded form, which the route decodes before checking.
    const boardId = await createBoard();
    const key = await uploadAndReadKey(boardId, pngBytes());
    // A literal `..` never reaches the Worker as a path segment — the URL is normalised
    // before routing — so the attempts worth making are the encoded ones, which arrive as
    // written and have to be refused after decoding.
    for (const path of [
      '/api/assets/..%2f..%2fx',
      '/api/assets/%2e%2e%2f%2e%2e%2fxyz',
      `/api/assets/${boardId}/${newBoardId()}/extra`,
      '/api/assets/',
      `/api/assets/${key}%2f..`,
    ]) {
      const response = await get(path);
      expect(response.status).toBe(404);
    }
    // The real key is still served, so none of those attempts damaged anything.
    expect((await get(`/api/assets/${key}`)).status).toBe(200);
  });
});

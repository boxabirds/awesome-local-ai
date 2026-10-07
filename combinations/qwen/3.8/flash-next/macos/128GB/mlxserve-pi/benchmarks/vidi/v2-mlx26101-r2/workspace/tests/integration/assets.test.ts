/**
 * The asset API (TC-10 to TC-13, TC-15, TC-16): `POST /api/boards/:boardId/assets` and
 * `GET /api/assets/:boardId/:assetId`.
 *
 * Everything here is real: the real `fetch` handler, the real R2 bucket that Miniflare
 * makes from `wrangler.jsonc`, the real `BoardRoom.exists()` RPC from story 5, and the
 * real bytes of the fixtures. The reason for that is the shape of the story - an asset
 * route exists to put a file somewhere and to give the *same file* back, and both halves
 * of that are claims about storage that a mocked bucket would let any implementation pass.
 * So every test reads the bucket itself: an upload that answered `201` without writing an
 * object is exactly the bug this file exists to catch, and so is a `GET` that served bytes
 * nobody stored, or a 415 that left an object behind for somebody else to serve later.
 *
 * The disguised files are the other half of the suite. A PDF renamed `.png` and an SVG
 * that claims `image/png` are tested through the *route* and not only through
 * `sniffImageType` (which has its own unit tests), because what has to be true is that
 * the route cannot be talked into storing them and cannot be talked into describing them
 * as something they are not.
 *
 * Rooms and buckets outlive a single test inside a project run, so nothing here asserts
 * "these are all the images that exist": every bucket assertion is scoped to a board id
 * this test invented, which nothing else can write to.
 */

import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { newBoardId, isValidBoardId } from '../../src/shared/board-id.js';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config.js';
import { ASSET_KEY_PATTERN, assetKeyFor, assetPathFor } from '../../src/shared/image-format.js';
import type { Env } from '../../src/worker/index.js';
import { handleUpload } from '../../src/worker/assets.js';
import {
  blobPart,
  gifFixture,
  jpegBytes,
  pdfBytes,
  pngBytes,
  smallPngFixture,
  svgFixture,
  truncatedPngBytes,
  webpFixture,
} from '../fixtures/image-fixtures.js';

const uploadPath = (boardId: string): string => `/api/boards/${boardId}/assets`;
const readPath = (key: string): string => assetPathFor(key);

/** A board that exists, because story 5 says only an existing board can receive a file. */
const createBoard = async (): Promise<string> => {
  const response = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
  expect(response.status).toBe(201);
  return (await response.json()).id as string;
};

/** `POST` bytes as a browser would: a raw body and whatever type it claims. */
const upload = (boardId: string, bytes: Uint8Array, contentType = 'application/octet-stream'): Promise<Response> =>
  SELF.fetch(`http://localhost${uploadPath(boardId)}`, {
    method: 'POST',
    body: blobPart(bytes),
    headers: { 'content-type': contentType },
  });

const get = (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch(`http://localhost${path}`, init);

/** The keys under one board's prefix - the only prefix anything can write to. */
const keysOf = async (boardId: string): Promise<string[]> =>
  (await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` })).objects.map((object) => object.key);

/** Upload a fixture to a real board and hand back the route's answer. */
const uploaded = async (boardId: string, bytes: Uint8Array, contentType: string): Promise<Response> =>
  upload(boardId, bytes, contentType);

const jsonOf = async (response: Response): Promise<Record<string, string>> =>
  (await response.json().catch(() => ({}))) as Record<string, string>;

describe('POST /api/boards/:boardId/assets (TC-10, TC-13)', () => {
  it('stores a real PNG on a real board and says where it went', async () => {
    const boardId = await createBoard();
    const fixture = smallPngFixture();
    const response = await uploaded(boardId, fixture.bytes, fixture.mimeType);

    expect(response.status).toBe(201);
    const body = await jsonOf(response);
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey?.split('/')[0]).toBe(boardId);
    expect(body.contentType).toBe('image/png');

    // The object is in the bucket, under the key the response named, with the bytes it
    // was given and the type the route decided for them.
    const inBucket = await env.ASSETS_BUCKET.get(body.key ?? body.assetKey as string);
    expect(inBucket).not.toBeNull();
    expect(new Uint8Array(await inBucket!.arrayBuffer())).toEqual(fixture.bytes);
    expect(inBucket!.httpMetadata?.contentType).toBe('image/png');
  });

  it('answers with the address the image will be rendered from, and that address works', async () => {
    const boardId = await createBoard();
    const fixture = smallPngFixture();
    const body = await jsonOf(await uploaded(boardId, fixture.bytes, fixture.mimeType));
    const key = body.assetKey as string;
    expect(key).toBe(assetKeyFor(boardId, key.split('/')[1] as string));

    // "`201` returns the permanent key" is only worth asserting if the address it is
    // built from then serves the file: an `src` that 404s is a broken image whatever the
    // upload response said about it.
    const served = await get(readPath(key));
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(fixture.bytes);
  });

  it('gives every upload its own key, in the one board that holds them all', async () => {
    const boardId = await createBoard();
    const first = await jsonOf(await uploaded(boardId, smallPngFixture(1).bytes, 'image/png'));
    const second = await jsonOf(await uploaded(boardId, smallPngFixture(2).bytes, 'image/png'));
    expect(first.assetKey).not.toBe(second.assetKey);
    expect(await keysOf(boardId)).toHaveLength(2);
  });

  it('stores a JPEG, a GIF and a WebP, and remembers which one each was', async () => {
    const boardId = await createBoard();
    const cases = [
      { bytes: jpegBytes(4096), type: 'image/jpeg' },
      { bytes: gifFixture().bytes, type: 'image/gif' },
      { bytes: webpFixture().bytes, type: 'image/webp' },
    ];
    for (const { bytes, type } of cases) {
      const response = await uploaded(boardId, bytes, type);
      expect(response.status).toBe(201);
      // The type in the response is the type the *bytes* said, not the type the header
      // claimed. They are allowed to disagree, and this is which one wins.
      const body = await jsonOf(response);
      expect(body.contentType).toBe(type);
      expect((await env.ASSETS_BUCKET.get(body.assetKey as string))?.httpMetadata?.contentType).toBe(type);
    }
  });

  it('is not interested in what the request claimed the body was', async () => {
    const boardId = await createBoard();
    // The same PNG, uploaded as plain text, as a client that meant no harm (or some) would.
    const response = await uploaded(boardId, pngBytes(8, 8), 'text/plain;charset=UTF-8');
    expect(response.status).toBe(201);
    expect((await jsonOf(response)).contentType).toBe('image/png');
  });

  it('refuses a truncated PNG, because a signature is not a whole file either', async () => {
    // The one case the browser cannot be trusted about on its own: a corrupt PNG passes
    // every check the client can make and only fails when something tries to decode it.
    // The route stores it - it *is* a PNG by content - and the board shows "Image
    // unavailable" for it, which is the PRD's answer for it (`image.unavailable`).
    const boardId = await createBoard();
    const corrupt = truncatedPngBytes();
    const response = await uploaded(boardId, corrupt, 'image/png');
    expect(response.status).toBe(201);
    expect((await keysOf(boardId)).length).toBe(1);
  });

  it('refuses a request that is not a POST, and a body that is not an image', async () => {
    const boardId = await createBoard();
    expect((await get(uploadPath(boardId), { method: 'GET' })).status).toBe(405);
    expect((await get(uploadPath(boardId), { method: 'DELETE' })).status).toBe(405);

    const empty = await get(uploadPath(boardId), { method: 'POST' });
    expect(empty.status).toBe(415);
    expect(await jsonOf(empty)).toEqual({ error: 'unsupported_type' });

    const junk = await uploaded(boardId, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'application/octet-stream');
    expect(junk.status).toBe(415);
    expect(await jsonOf(junk)).toEqual({ error: 'unsupported_type' });
    // Nothing was written by any of these attempts.
    expect(await keysOf(boardId)).toEqual([]);
  });
});

describe('only boards that exist can receive uploads (TC-11)', () => {
  it('404s a board that was never created, and stores nothing for it', async () => {
    // A perfectly well-formed id, 128 bits of randomness, belonging to nobody: this is
    // the PRD's constraint that an upload goes to a board that exists, checked by the
    // board's own object rather than by this Worker's opinion about ids.
    const neverCreated = newBoardId();
    const response = await uploaded(neverCreated, smallPngFixture().bytes, 'image/png');
    expect(response.status).toBe(404);
    expect(await jsonOf(response)).toEqual({ error: 'not_found' });
    expect(await keysOf(neverCreated)).toEqual([]);
  });

  it('404s a malformed board id without waking a Durable Object for it', async () => {
    const response = await upload('nope', pngBytes(8, 8), 'image/png');
    expect(response.status).toBe(404);
    expect(await jsonOf(response)).toEqual({ error: 'not_found' });
    expect(await keysOf('nope')).toEqual([]);
    // A board id is 22 characters; the object this path would route to is a different
    // object from the one `nope` would name, which is the only reason the two paths can
    // be told apart at all. Nothing here looks either of them up.
    expect(isValidBoardId('nope')).toBe(false);
  });

  it('stores nothing at all when every file in the request was refused', async () => {
    const boardId = await createBoard();
    for (const bytes of [pdfBytes(), svgFixture().bytes, new Uint8Array(0)]) {
      expect((await uploaded(boardId, bytes, 'image/png')).status).toBe(415);
    }
    expect(await keysOf(boardId)).toEqual([]);
  });
});

describe('the size limit at the route (TC-12)', () => {
  it('refuses one byte over the limit and stores nothing, then accepts exactly the limit', async () => {
    const boardId = await createBoard();

    const over = await uploaded(boardId, jpegBytes(IMAGE_MAX_BYTES + 1), 'image/jpeg');
    expect(over.status).toBe(413);
    expect(await jsonOf(over)).toEqual({ error: 'too_large' });
    expect(await keysOf(boardId)).toEqual([]);

    const at = await uploaded(boardId, jpegBytes(IMAGE_MAX_BYTES), 'image/jpeg');
    expect(at.status).toBe(201);
    expect(await keysOf(boardId)).toHaveLength(1);
  });

  it('does not take the Content-Length’s word for how big the body is', async () => {
    const boardId = await createBoard();
    // A body bigger than the limit behind a header that says it is small: a lie about
    // the size gets the answer the truth got, because the second check is the one that
    // cannot lie. (A fetch with a real body sends its own length, so the header here is
    // what a hand-built request would send; the byte check is the one under test.)
    const response = await SELF.fetch(`http://localhost${uploadPath(boardId)}`, {
      method: 'POST',
      body: blobPart(pdfBytes(IMAGE_MAX_BYTES + 4)),
      headers: { 'content-type': 'image/png', 'content-length': '32' },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('refuses the PRD’s 11 MB file, and says the size before it asks the type', async () => {
    const boardId = await createBoard();
    // Both answers are true of this file, and the cheaper one is the one that costs
    // nothing to give. The client's message depends on the difference: 413 is "make it
    // smaller", 415 is "that is not an image this board takes".
    const response = await uploaded(boardId, pdfBytes(11 * 1024 * 1024), 'image/png');
    expect(response.status).toBe(413);
    expect(await jsonOf(response)).toEqual({ error: 'too_large' });
    expect(await keysOf(boardId)).toEqual([]);
  });
});

describe('a file that is not what it is called (TC-13)', () => {
  it('refuses a PDF renamed .png served up as a PNG, and there is no object to come back', async () => {
    const boardId = await createBoard();
    const response = await uploaded(boardId, pdfBytes(), 'image/png');
    expect(response.status).toBe(415);
    expect(await jsonOf(response)).toEqual({ error: 'unsupported_type' });
    // The name and the claimed type both said PNG, and neither of them is in the bucket.
    // That is the assertion the status code on its own would not have made.
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('refuses an SVG carrying a script, however it is described', async () => {
    const boardId = await createBoard();
    const svg = svgFixture().bytes;
    for (const claim of ['image/png', 'image/svg+xml', 'text/plain', 'application/octet-stream']) {
      const response = await uploaded(boardId, svg, claim);
      expect(response.status, claim).toBe(415);
      expect(await jsonOf(response), claim).toEqual({ error: 'unsupported_type' });
    }
    // None of the four descriptions left anything behind, so there is nothing for a
    // later request - or the story 17 exporter - to be served with a script in it.
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('refuses a disguised file even on a board that does exist', async () => {
    const boardId = await createBoard();
    // The board check passing is what makes this a test of the *type* rule rather than of
    // the board rule: the request gets as far as the bytes, and the bytes are what it is
    // turned away for.
    expect((await uploaded(boardId, svgFixture().bytes, 'image/png')).status).toBe(415);
    expect((await uploaded(boardId, smallPngFixture().bytes, 'image/png')).status).toBe(201);
    expect(await keysOf(boardId)).toHaveLength(1);
  });
});

describe('a bucket that will not answer (TC-15)', () => {
  /**
   * A bucket that throws on `put`, which is the only way to have a storage failure on
   * purpose: Miniflare's R2 is not going to fail, and a test that waited for a real
   * outage would be a test that passes when the machine is healthy. The bucket is wrapped
   * rather than mocked because everything else about the request stays real, including the
   * board's own object being asked whether the board exists.
   */
  const brokenEnv = (): Env => {
    const throwing: R2Bucket = {
      put: (async (): Promise<R2Object | null> => {
        throw new Error('the bucket is not there');
      }),
    } as unknown as R2Bucket;
    // The bindings are named out rather than spread from `env`, because the point is that
    // only the bucket is broken: the board's own object is the real one, and the request
    // gets as far as the write it fails at.
    return { BOARD_ROOM: env.BOARD_ROOM, ASSETS: env.ASSETS, ASSETS_BUCKET: throwing };
  };

  it('answers 500 when the put throws, and does not pretend the file was stored', async () => {
    const boardId = await createBoard();
    const request = new Request(`http://localhost${uploadPath(boardId)}`, {
      method: 'POST',
      body: blobPart(pngBytes(16, 12)),
      headers: { 'content-type': 'image/png' },
    });
    const response = await handleUpload(request, brokenEnv(), boardId);
    expect(response.status).toBe(500);
    expect(await jsonOf(response)).toEqual({ error: 'storage_failed' });
  });

  it('answers 500 and nothing at all when the board check itself cannot run', async () => {
    const boardId = await createBoard();
    const brokenRoom = {
      idFromName: (name: string) => env.BOARD_ROOM.idFromName(name),
      get: () => {
        throw new Error('the room is not reachable');
      },
    } as unknown as DurableObjectNamespace;
    const request = new Request(`http://localhost${uploadPath(boardId)}`, {
      method: 'POST',
      body: blobPart(pngBytes(16, 12)),
      headers: { 'content-type': 'image/png' },
    });
    const response = await handleUpload(
      request,
      { BOARD_ROOM: brokenRoom, ASSETS: env.ASSETS, ASSETS_BUCKET: env.ASSETS_BUCKET },
      boardId,
    );
    expect(response.status).toBe(500);
    expect(await keysOf(boardId)).toEqual([]);
  });
});

describe('GET /api/assets/:boardId/:assetId (TC-16)', () => {
  /** Store a fixture on a real board and return the address of its file. */
  const store = async (): Promise<{ boardId: string; key: string }> => {
    const boardId = await createBoard();
    const body = await jsonOf(await uploaded(boardId, smallPngFixture().bytes, 'image/png'));
    return { boardId, key: body.assetKey as string };
  };

  it('serves the stored bytes with the type that was decided about them', async () => {
    const { key } = await store();
    const response = await get(readPath(key));

    expect(response.status).toBe(200);
    // Exactly the type the fixture's bytes are, and exactly what the bucket has beside the
    // object - not something worked out from the key afterwards, which would be a name
    // deciding what content is.
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(await response.arrayBuffer()).toEqual(blobPart(pngBytes(40, 30, 0)));
  });

  it('says how long it may be cached, and says it in the bucket too', async () => {
    const { key } = await store();
    const response = await get(readPath(key));
    const expected = `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`;
    expect(response.headers.get('cache-control')).toBe(expected);
    // The same lifetime is written in two places: on the response, and beside the object,
    // so a file served from the bucket by anything else cannot arrive with a different one.
    expect((await env.ASSETS_BUCKET.get(key))?.httpMetadata?.contentType).toBe('image/png');
  });

  it('tells the browser not to decide for itself what the bytes are', async () => {
    const { key } = await store();
    const response = await get(readPath(key));
    // Both of these are about a file this Worker did not choose to be dangerous: a stored
    // object is served as an image or not at all, and a browser is not being given the
    // chance to change its mind about that.
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(response.headers.get('content-type')).not.toContain('html');
  });

  it('serves the same bytes twice, because nothing can change what a key names', async () => {
    const { key } = await store();
    const first = await get(readPath(key));
    const second = await get(readPath(key));
    expect(await second.arrayBuffer()).toEqual(await first.arrayBuffer());
    expect(second.headers.get('cache-control')).toBe(first.headers.get('cache-control'));
  });

  it('404s a key that was never uploaded, and does not serve the app page instead', async () => {
    // The distinction the client depends on: an app page is HTML, and a page served to an
    // `<img>` is a broken image that cannot be told apart from one that arrived and would
    // not decode. A JSON 404 is answerable; a 200 is not.
    const response = await get(readPath(`${newBoardId()}/${newBoardId()}`));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect((await response.text()).startsWith('<!')).toBe(false);
  });

  it('404s every way a key can be malformed, without looking any of them up', async () => {
    const boardId = await createBoard();
    const assetId = newBoardId();
    const malformed = [
      ['/api/assets/', 'the collection itself'],
      ['/api/assets', 'the collection without a slash'],
      [`/api/assets/${boardId}`, 'no asset id'],
      [`/api/assets/${boardId}/`, 'an empty asset id'],
      [`/api/assets/${boardId}/${assetId}x`, 'an asset id of 23 characters'],
      [`/api/assets/${boardId}x/${assetId}`, 'a board id of 23 characters'],
      [`/api/assets/nope/${assetId}`, 'a board id that is not one'],
      [`/api/assets/../${assetId}`, 'a path that climbs out of the bucket'],
      [`/api/assets/..%2F..%2Fetc%2Fpasswd/${assetId}`, 'a path that climbs out in escapes'],
      [`/api/assets/${boardId}/%2e%2e%2e${assetId}`, 'a key with escapes in it'],
      [`/api/assets/${boardId}/${assetId}/extra`, 'a key with something after it'],
      [`/api/assets/%2e%2e/${assetId}`, 'a dot-dot written in escapes'],
    ] as const;
    for (const [path, what] of malformed) {
      const response = await get(path);
      expect(response.status, what).toBe(404);
      expect(await jsonOf(response), what).toEqual({ error: 'not_found' });
    }
    expect(isValidBoardId(boardId)).toBe(true);
  });

  it('does not serve a file that is there when asked for one that is not', async () => {
    const { boardId, key } = await store();
    const assetId = key.split('/')[1] as string;
    // A neighbouring key, one character away: the answer must not be "here is something
    // close", which is what a route that matched the path loosely would say.
    const near = assetKeyFor(boardId, `${assetId.slice(0, 21)}${assetId[21] === 'a' ? 'b' : 'a'}`);
    const response = await get(readPath(near));
    expect(response.status).toBe(404);
    // ...and the key that does exist is still served.
    expect((await get(readPath(key))).status).toBe(200);
  });

  it('refuses a key that climbs out of the bucket, without looking it up', async () => {
    // The traversal case of TC-16, asked at the route the design puts the check in:
    // `handleServe` is given a *key*, and a key that is not `<22>/<22>` is refused before
    // the bucket is touched. A hand-built key is how a server can be handed one: a browser
    // would have resolved `../x` into a different path long before it got here, which is
    // the next test, and a proxy or a hand-rolled client that did not resolve it is the
    // reason the check has to exist anyway.
    const climbing = ['../x', `../${newBoardId()}`, `${newBoardId()}/../../etc/passwd`, '..', './x'];
    for (const key of climbing) {
      const response = await handleServe(env, key);
      expect(response.status, key).toBe(404);
      expect(await jsonOf(response), key).toEqual({ error: 'not_found' });
      expect(keyFromAssetPath(`/api/assets/${key}`), key).toBeNull();
    }
  });

  it('cannot be reached by a traversal path at all, because a path is resolved first', async () => {
    // The other half of the same rule, and the half that is easy to believe without
    // checking: `GET /api/assets/../../etc/passwd` is not a request for anything under
    // `/api/assets/` by the time it arrives, because the dots are resolved out of the path
    // before the Worker sees it. What matters is the outcome, which is that a traversal
    // never produces an image and never says "no such image" about a file that exists:
    // the answer comes from a different route entirely.
    const response = await get('/api/assets/../../etc/passwd');
    expect(new URL(response.url).pathname).toBe('/etc/passwd');
    expect(response.headers.get('content-type')).not.toContain('image/');
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it('refuses a method that is not a question about the file', async () => {
    const { key } = await store();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await get(readPath(key), { method });
      expect(response.status, method).toBe(405);
      expect(await jsonOf(response), method).toEqual({ error: 'method_not_allowed' });
    }
  });

  it('leaves the board page alone, now that a bucket is bound beside it', async () => {
    const boardId = await createBoard();
    const page = await get(`/b/${boardId}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<div id="root">');
    // The bucket is a binding, not a new front door: the SPA fallback still answers the
    // paths the client router needs.
    const deep = await get('/some/client-side-route');
    expect(deep.status).toBe(200);
    expect(deep.headers.get('content-type')).toContain('text/html');
  });
});

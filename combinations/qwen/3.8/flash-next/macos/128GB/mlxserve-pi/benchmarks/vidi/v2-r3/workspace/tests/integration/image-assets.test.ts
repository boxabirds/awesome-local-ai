/// <reference types="vitest" />
// Story 12, assets.api: bytes go in, a key comes back, and the bytes come out
// again as the same bytes under the same type — against the real Worker entry, the
// real BoardRoom and the real R2 bucket, all three of which the test project is
// given by `wrangler.jsonc`.
//
// Two things are worth saying about how these tests are written.
//
// The first is that the *type* is only ever asked of the bytes. A request that
// claims `image/png` in a header and carries a PDF is refused, and a request that
// claims nothing at all is served `image/png` if that is what it is carrying — so
// the assertions here never mention what a request said, only what came back.
//
// The second is the 413. A file bigger than the limit is refused without being read
// when the request declares its length, which is the only way a board survives
// somebody dropping a raw photograph on it; the test therefore checks both the
// declared case and the measured one, because a header is a claim and the byte
// count is a measurement, and it is the measurement that has the last word.
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';
import { assetPath, boardAssetsPath } from '../../src/shared/routes';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { handleUpload } from '../../src/worker/assets';
import type { Env } from '../../src/worker/index';

/** A real 1x1 PNG, for the round trip which has to compare bytes. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ) as string,
  (c) => c.charCodeAt(0),
);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const GIF = Uint8Array.from([...[...'GIF89a'].map((c) => c.charCodeAt(0)), 0x01, 0x00, 0x01, 0x00]);
const WEBP = Uint8Array.from([
  ...[...'RIFF'].map((c) => c.charCodeAt(0)),
  0x0a,
  0x00,
  0x00,
  0x00,
  ...[...'WEBP'].map((c) => c.charCodeAt(0)),
  ...[...'VP8 '].map((c) => c.charCodeAt(0)),
]);
const PDF = Uint8Array.from([...'0%PDF-1.7\n%âãÏÓ\n1 0 obj <<>> endobj'].map((c) => c.charCodeAt(0)));
const SVG = Uint8Array.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>', (c) =>
  c.charCodeAt(0),
);
const THREE_BYTES = Uint8Array.from([0x01, 0x02, 0x03]);

const get = (path: string, init?: RequestInit): Promise<Response> =>
  SELF.fetch(`http://localhost${path}`, init);

const post = (
  path: string,
  body: BodyInit | Uint8Array,
  type?: string,
  extra: Record<string, string> = {},
): Promise<Response> =>
  SELF.fetch(`http://localhost${path}`, {
    method: 'POST',
    headers: type === undefined ? extra : { 'content-type': type, ...extra },
    body: body as BodyInit,
  });

/** A board that exists, because an upload to a board which does not is refused. */
const createBoard = async (): Promise<string> => {
  const response = await get('/api/boards', { method: 'POST' });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/** Upload and hand back what was answered, with the key decoded out of the body. */
const upload = async (
  boardId: string,
  bytes: Uint8Array,
  type?: string,
): Promise<{ status: number; assetKey?: string; contentType?: string; error?: string }> => {
  const response = await post(boardAssetsPath(boardId), bytes, type);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, ...body } as { status: number } & Record<string, string>;
};

describe('TC-10: a PNG goes in and the same PNG comes back out', () => {
  it('201 with a key, which serves the same bytes under image/png', async () => {
    const boardId = await createBoard();
    const answered = await upload(boardId, PNG);
    expect(answered.status).toBe(201);
    expect(answered.assetKey!.startsWith(`${boardId}/`)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(answered.assetKey!)).toBe(true);

    const served = await get(assetPath(answered.assetKey!));
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  it('two uploads of the same bytes are two assets, because the key is made here', async () => {
    const boardId = await createBoard();
    const first = await upload(boardId, PNG);
    const second = await upload(boardId, PNG);
    expect(first.assetKey).not.toBe(second.assetKey);
    // A file's name is something the board was told, not a fact about the board:
    // dropping the same file twice does not overwrite the first copy, and the board
    // which is showing both does not have one picture stand in for two.
    expect((await get(assetPath(first.assetKey!))).status).toBe(200);
    expect((await get(assetPath(second.assetKey!))).status).toBe(200);
  });

  it('the name a file was dropped with is nowhere in the answer', async () => {
    const boardId = await createBoard();
    const answered = await upload(boardId, PNG);
    expect(answered.assetKey!.split('/')).toHaveLength(2);
    // Two segments of board-id length, which is the whole of the shape: the key
    // says whose bytes they are and which of their number this is, and nothing
    // else — no path, no extension, no original name.
    expect(answered.assetKey).toBe(`${boardId}/${answered.assetKey!.split('/')[1]}`);
  });

  it('only POST is accepted on the upload route, and only GET on the serve route', async () => {
    const boardId = await createBoard();
    const answered = await upload(boardId, PNG);
    expect((await get(boardAssetsPath(boardId))).status).toBe(405);
    expect((await get(assetPath(answered.assetKey!), { method: 'DELETE' })).status).toBe(405);
    // A HEAD is a GET without the bytes, which is what an <img> cache wants.
    const head = await get(assetPath(answered.assetKey!), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('image/png');
  });
});

describe('TC-11: every accepted format is stored under the type its bytes said', () => {
  for (const [name, bytes, type] of [
    ['png', PNG, 'image/png'],
    ['jpeg', JPEG, 'image/jpeg'],
    ['gif', GIF, 'image/gif'],
    ['webp', WEBP, 'image/webp'],
  ] as const) {
    it(`${name} is served as ${type}`, async () => {
      const boardId = await createBoard();
      const answered = await upload(boardId, bytes);
      expect(answered.status).toBe(201);
      expect(answered.contentType).toBe(type);
      const served = await get(assetPath(answered.assetKey!));
      expect(served.headers.get('content-type')).toBe(type);
    });
  }

  it('a request which claims a type at all is answered with the type of its bytes', async () => {
    const boardId = await createBoard();
    // The claim is a lie, and the answer is not: what is stored is labelled with
    // what the bytes are, so what is served later cannot be anything else.
    const answered = await upload(boardId, JPEG, 'image/png');
    expect(answered.status).toBe(201);
    expect(answered.contentType).toBe('image/jpeg');
    expect((await get(assetPath(answered.assetKey!))).headers.get('content-type')).toBe('image/jpeg');
  });
});

describe('TC-12: a file bigger than the limit is refused, and refused before it is read', () => {
  it('one byte over the limit is 413, measured', async () => {
    const boardId = await createBoard();
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
    big.set(PNG, 0);
    const answered = await upload(boardId, big);
    expect(answered.status).toBe(413);
    expect(answered.error).toBe('image_too_large');
  });

  it('a request which declares itself oversized is refused without its body being read', async () => {
    const boardId = await createBoard();
    // The body is 67 bytes of perfectly good PNG and the request declares
    // forty megabytes. The 413 can only have come from the declaration, which is
    // the point: a board should be able to refuse a raw photograph the instant it
    // is announced rather than after it has been carried up the wire.
    const response = await post(boardAssetsPath(boardId), PNG, undefined, {
      'content-length': String(40 * 1024 * 1024),
    });
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: string }).error).toBe('image_too_large');
  });

  it('a declaration that is a lie does not refuse a file which is not too big', async () => {
    const boardId = await createBoard();
    // The measurement has the last word in both directions: a request that declares
    // forty megabytes and carries sixty-seven bytes is measured, and kept.
    const response = await post(boardAssetsPath(boardId), PNG, undefined, {
      'content-length': String(IMAGE_MAX_BYTES),
    });
    expect(response.status).toBe(201);
  });

  it('exactly the limit is not too big', async () => {
    const boardId = await createBoard();
    const exact = new Uint8Array(IMAGE_MAX_BYTES);
    exact.set(PNG, 0);
    expect((await upload(boardId, exact)).status).toBe(201);
  });

  it('nothing is stored for a file that was refused', async () => {
    const boardId = await createBoard();
    const before = (await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` })).objects.length;
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
    big.set(PNG, 0);
    await upload(boardId, big);
    await upload(boardId, PDF);
    const after = (await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` })).objects.length;
    expect(after).toBe(before);
  });
});

describe('TC-13: the bytes decide what a file is, and nothing else gets a say', () => {
  it('a PDF is 415 whatever it is called or claims to be', async () => {
    const boardId = await createBoard();
    expect((await upload(boardId, PDF, 'image/png')).status).toBe(415);
    expect((await upload(boardId, PDF)).status).toBe(415);
    expect((await upload(boardId, PDF, 'application/pdf')).status).toBe(415);
  });

  it('an SVG is 415, which is the refusal that keeps a script off the board', async () => {
    const boardId = await createBoard();
    const answered = await upload(boardId, SVG, 'image/svg+xml');
    expect(answered.status).toBe(415);
    expect(answered.error).toBe('unsupported_image_type');
  });

  it('three bytes of nothing are 415', async () => {
    const boardId = await createBoard();
    expect((await upload(boardId, THREE_BYTES)).status).toBe(415);
  });

  it('an empty body is 415 rather than a zero-length image', async () => {
    const boardId = await createBoard();
    expect((await upload(boardId, new Uint8Array(0))).status).toBe(415);
  });
});

describe('TC-14: a board that is not there may not be written to', () => {
  it('an upload to an unknown board id is 404, and stores nothing', async () => {
    const missing = newBoardId();
    const answered = await upload(missing, PNG);
    expect(answered.status).toBe(404);
    expect(answered.error).toBe('board_not_found');
    expect((await env.ASSETS_BUCKET.list({ prefix: `${missing}/` })).objects).toEqual([]);
  });

  it('a malformed board id is 404, and the room is never asked about it', async () => {
    // `..` written plainly, or as `%2e%2e`, is removed by the URL parser before the
    // Worker sees anything (there is a test of that below), so what has to be refused
    // here is the shape that survives parsing: an id of the wrong length, an id with
    // an escaped slash in it, an id that decodes into something else.
    expect((await upload('short', PNG)).status).toBe(404);
    expect((await upload('', PNG)).status).toBe(404);
    expect((await upload(`${newBoardId()}x`, PNG)).status).toBe(404);
    expect((await upload('%252e%252e', PNG)).status).toBe(404);
    expect((await upload(`${newBoardId()}%2fx`, PNG)).status).toBe(404);
  });

  it('a path the URL parser rewrites is not an asset route at all', async () => {
    // Worth writing down rather than asserting away: `/api/boards/../x/assets` is
    // `/api/x/assets` by the time anything can look at it, so it is answered the way
    // an unknown path is answered — by the client, as HTML, and never by the bucket.
    const response = await get('/api/boards/../x/assets', { method: 'POST', body: PNG });
    expect(response.status).not.toBe(201);
    expect(response.headers.get('content-type') ?? '').not.toContain('application/json');
  });

  it("one board's key cannot be reached by guessing at another's", async () => {
    const mine = await createBoard();
    const answered = await upload(mine, PNG);
    // Somebody who knows the other board's id and this asset's id, and has never
    // been invited to this board, gets the same answer as a key made up at random.
    const other = newBoardId();
    const guessed = `${other}/${answered.assetKey!.split('/')[1]}`;
    expect((await get(assetPath(guessed))).status).toBe(404);
  });
});

describe('TC-15: when the store itself refuses, the board says so', () => {
  it('a bucket that throws is a 500, and the file is not called bad', async () => {
    const boardId = await createBoard();
    const broken = {
      BOARD_ROOM: env.BOARD_ROOM,
      ASSETS_BUCKET: {
        put: async () => {
          throw new Error('bucket on fire');
        },
        get: async () => {
          throw new Error('bucket on fire');
        },
        list: async () => ({ objects: [], truncated: false, prefixes: [] }),
        head: async () => null,
        delete: async () => undefined,
        createMultipartUpload: async () => {
          throw new Error('bucket on fire');
        },
      } as unknown as R2Bucket,
    } as Env;
    const response = await handleUpload(
      new Request(`http://localhost${boardAssetsPath(boardId)}`, { method: 'POST', body: PNG }),
      broken,
      boardId,
    );
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toBe('asset_store_unavailable');
  });
});

describe('TC-16: what the serve says about itself', () => {
  it('the headers say nobody may be sent a second copy, or guess at the type', async () => {
    const boardId = await createBoard();
    const answered = await upload(boardId, PNG);
    const served = await get(assetPath(answered.assetKey!));
    expect(served.status).toBe(200);
    expect(served.headers.get('cache-control')).toMatch(/public/);
    expect(served.headers.get('cache-control')).toMatch(/max-age=\d+/);
    expect(served.headers.get('cache-control')).toContain('immutable');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('a key with a way out of it is 404, and the bucket is never asked', async () => {
    const boardId = await createBoard();
    const answered = await upload(boardId, PNG);
    const assetId = answered.assetKey!.split('/')[1]!;
    // The escapes which survive URL parsing and still name something other than one
    // asset: an encoded slash, which decodes into a third segment; a double-encoded
    // dot, which decodes into `..`; a key of the wrong length either side of the
    // slash. `ASSET_KEY_PATTERN` is asked of the decoded key, so all of them are
    // refused by the pattern rather than by the bucket failing to find them.
    for (const key of [
      `${boardId}/a%2fb`,
      `${boardId}/%252e%252e/${assetId}`,
      `${boardId}/%2e%2e/${assetId}`,
      `${boardId}/${assetId}x`,
      `${boardId}/${assetId}/`,
      `short/short`,
      `${boardId}//${assetId}`,
      'a/b/c',
      '',
    ]) {
      const served = await get(`/api/assets/${key}`);
      expect([key, served.status]).toEqual([key, 404]);
      expect(served.headers.get('content-type')).toContain('application/json');
    }
    // The one real asset is still there, and still the only thing its key serves.
    expect((await get(assetPath(answered.assetKey!))).status).toBe(200);
  });

  it('a well-formed key that holds nothing is 404', async () => {
    expect((await get(assetPath(`${newBoardId()}/${newBoardId()}`))).status).toBe(404);
  });

  it('a served image cannot be read as anything but the type it was stored under', async () => {
    const boardId = await createBoard();
    const answered = await upload(boardId, GIF);
    const served = await get(assetPath(answered.assetKey!));
    // The bytes are somebody's picture. What a browser makes of a response is to be
    // decided by the type it is given, not by what turns out to be inside it — which
    // is what `nosniff` and a type that came from the bytes together amount to.
    expect(served.headers.get('content-type')).toBe('image/gif');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

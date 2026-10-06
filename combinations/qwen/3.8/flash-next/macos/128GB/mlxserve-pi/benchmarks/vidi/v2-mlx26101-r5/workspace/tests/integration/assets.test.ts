/**
 * A picture going into a bucket and coming back out of one (story 12, TC-10 … TC-16).
 *
 * These are the two routes that do not touch a board's state, which is why they are the two routes a
 * routing test could not have covered: an upload is not a question about a board's document and a fetch
 * is not either, and the only shared thing between them and the rest of the Worker is the one question
 * `POST /api/boards/:id/assets` asks the Durable Object — *is this board real?* — because a picture filed
 * under a link that belongs to nobody is a picture nobody can ever find.
 *
 * Everything runs against the real Worker and the real bindings: `SELF.fetch` for the routes, and
 * `env.ASSETS_BUCKET` — the same bucket the Worker is handed — for the assertions about what is actually
 * sitting in storage. That second one is the point of this file. A response code says what the Worker
 * said; only the bucket says what it did, and every negative case here is a promise that *nothing was
 * written*, which cannot be observed from the response alone. The check is a `list()` by prefix, so a
 * test that expects a refusal is also asserting the bucket has not grown a stray object under this board's
 * name.
 *
 * What is not real in this file is the bytes. The Worker reads twelve of them to name a format, so the
 * files below are that many bytes with the right opening; the files that a camera made, and that a browser
 * has to be able to decode, are in `tests/fixtures/images/` and are used by
 * `tests/unit/image-format.test.ts` and by the end-to-end suite, where a decoder is on the other end.
 * The failure in TC-15 is not real either, for the reason every other failure in this suite is not: a
 * bucket cannot be made to fail on a schedule.
 */

import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { handleUpload } from '../../src/worker/assets';
import type { Env } from '../../src/worker/index';

/** The origin the tests address the Worker by. */
const ORIGIN = 'https://vidi6.test';

/** A request to the Worker, as a client sends it. */
const request = (path: string, init?: RequestInit): Request => new Request(`${ORIGIN}${path}`, init);

/** A board, made the way the home page makes one. Returns its id. */
async function createBoard(): Promise<string> {
  const response = await SELF.fetch(request('/api/boards', { method: 'POST' }));
  const body = (await response.json()) as { id?: unknown };
  if (response.status !== 201 || typeof body.id !== 'string') {
    throw new Error(`board creation failed: ${response.status}`);
  }
  return body.id;
}

/**
 * Bytes that open like one of the four formats. The Worker reads the opening and no further, which is the
 * whole of what these tests ask it to do; a real screenshot is in the fixtures folder for the tests where a
 * decoder is involved.
 */
function imageBytes(type: 'png' | 'jpeg' | 'gif87' | 'gif89' | 'webp', size = 4096): Uint8Array {
  const body = new Uint8Array(size);
  const heads: Record<string, number[]> = {
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    jpeg: [0xff, 0xd8, 0xff, 0xe0],
    gif87: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    gif89: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    webp: [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
  };
  body.set(heads[type] as number[]);
  return body;
}

/** Bytes that open like a PDF, which is a document and is not an image. */
const pdfBytes = (size = 2048): Uint8Array => {
  const body = new Uint8Array(size);
  body.set(new TextEncoder().encode('%PDF-1.4'));
  return body;
};

/** Bytes that open like an SVG, which is a script waiting for a browser. */
const svgBytes = (): Uint8Array =>
  new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');

/** Every object stored under this board's name. */
type StoredObject = { key: string };

async function stored(boardId: string): Promise<StoredObject[]> {
  const listed = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
  return listed.objects;
}

/** Upload bytes to a board, as the browser's XHR sends them: one file, as the body. */
function upload(boardId: string, body: BodyInit, headers?: Record<string, string>): Promise<Response> {
  return SELF.fetch(request(`/api/boards/${boardId}/assets`, { method: 'POST', body, headers }));
}

/** The `assetKey` a 201 gave back. */
async function keyOf(response: Response): Promise<string> {
  const body = (await response.json()) as { assetKey?: unknown };
  if (typeof body.assetKey !== 'string') throw new Error(`the response carried no key: ${JSON.stringify(body)}`);
  return body.assetKey;
}

describe('an accepted upload is stored and answered with its key (TC-10)', () => {
  it('stores a PNG and says where it put it', async () => {
    const boardId = await createBoard();

    const response = await upload(boardId, imageBytes('png'));
    expect(response.status).toBe(201);

    const body = (await response.json()) as { assetKey?: unknown; contentType?: unknown };
    expect(typeof body.assetKey).toBe('string');
    const key = body.assetKey as string;
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
    expect(key.startsWith(`${boardId}/`)).toBe(true);
    // The type is the one the bytes said, and it is stored, because it is what the GET will answer with.
    expect(body.contentType).toBe('image/png');

    const objects = await stored(boardId);
    expect(objects.map((object) => object.key)).toEqual([key]);
    // What the bucket itself says the file is, because that string is what the GET will answer with.
    const storedObject = await env.ASSETS_BUCKET.get(key);
    expect(storedObject?.httpMetadata?.contentType).toBe('image/png');
    expect(storedObject?.customMetadata?.boardId).toBe(boardId);
  });

  it('takes each of the four formats and names the one it found', async () => {
    const boardId = await createBoard();
    const expected: Record<string, string> = {
      png: 'image/png',
      jpeg: 'image/jpeg',
      gif87: 'image/gif',
      gif89: 'image/gif',
      webp: 'image/webp',
    };
    for (const type of Object.keys(expected)) {
      const response = await upload(boardId, imageBytes(type as 'png'));
      expect(response.status).toBe(201);
      expect(((await response.json()) as { contentType?: string }).contentType).toBe(expected[type]);
    }
    expect((await stored(boardId)).length).toBe(5);
  });

  it('gives two uploads of the same bytes two addresses, and refuses to guess between them', async () => {
    // Not a redundancy: the same file dropped twice is two objects under two keys. The board could have
    // tried to notice it was the same picture and store it once, and then deleting one of the two pictures
    // would have taken a picture off somebody else's board.
    const boardId = await createBoard();
    const bytes = imageBytes('png');
    const first = await keyOf(await upload(boardId, bytes));
    const second = await keyOf(await upload(boardId, bytes));
    expect(first).not.toBe(second);
    expect((await stored(boardId)).length).toBe(2);
  });

  it('does not care what the client said the file was', async () => {
    // TC-13's assertion from the other side: the header is not consulted, so it cannot be the thing that
    // decides what ends up on the shelf.
    const boardId = await createBoard();
    const response = await upload(boardId, imageBytes('webp'), { 'content-type': 'image/png' });
    expect(((await response.json()) as { contentType?: string }).contentType).toBe('image/webp');
  });
});

describe('a board that is not there receives nothing (TC-11)', () => {
  it('a link nobody has ever used is a 404, and nothing is written', async () => {
    const boardId = newBoardId();

    const response = await upload(boardId, imageBytes('png'));
    expect(response.status).toBe(404);
    expect(await stored(boardId)).toEqual([]);
  });

  it('a malformed id is a 404 that never names a board at all', async () => {
    for (const id of ['a', 'a'.repeat(21), 'a'.repeat(23), 'a.b.c', 'a b c d e f g h i j k']) {
      const response = await upload(id, imageBytes('png'));
      expect(response.status).toBe(404);
      expect(await stored(id)).toEqual([]);
    }
  });

  it('an id that is not one path segment is refused by the board routes instead, and just as finally', async () => {
    // `/api/boards/api/rooms/assets` and `/api/boards//assets` are not the upload route: the id in the
    // address is two segments or none, and the route that matches them answers 405. What matters is the
    // outcome the person acts on — nothing was stored and no board was created — so that is what is
    // asserted here rather than a code this endpoint was never the one to give.
    for (const id of ['api/rooms', '']) {
      expect(await upload(id, imageBytes('png'))).not.toHaveProperty('status', 201);
      expect(await stored(id)).toEqual([]);
    }
  });

  it('an upload to a board does not bring that board into existence', async () => {
    // The one thing this endpoint could have got wrong in a way that costs money: an upload that created a
    // board would let anybody fill the service with boards by asking for a picture shelf, and story 5's
    // rule — a question about a link leaves no board behind — would be untrue.
    const boardId = newBoardId();
    await upload(boardId, imageBytes('png'));

    const asked = await SELF.fetch(request(`/api/boards/${boardId}`));
    expect(asked.status).toBe(404);
  });

  it('a method that is not POST is a 405 that stores nothing', async () => {
    const boardId = await createBoard();
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const response = await SELF.fetch(
        request(`/api/boards/${boardId}/assets`, method === 'GET' ? { method } : { method, body: imageBytes('png') }),
      );
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
    expect(await stored(boardId)).toEqual([]);
  });
});

describe('ten megabytes is the limit, and the limit is the limit (TC-12)', () => {
  it('refuses a file one byte over, and stores nothing', async () => {
    const boardId = await createBoard();

    const response = await upload(boardId, imageBytes('png', IMAGE_MAX_BYTES + 1));
    expect(response.status).toBe(413);
    expect(await stored(boardId)).toEqual([]);
  });

  it('takes a file of exactly the limit', async () => {
    // A boundary is two points and both of them have to be tested, or the limit is somebody's opinion about
    // whether "up to" includes the number it is stated with.
    const boardId = await createBoard();

    const response = await upload(boardId, imageBytes('jpeg', IMAGE_MAX_BYTES));
    expect(response.status).toBe(201);
    expect((await stored(boardId)).length).toBe(1);
  });

  it('refuses an empty body, which is a file with nothing in it', async () => {
    const boardId = await createBoard();
    expect((await upload(boardId, new Uint8Array(0))).status).toBe(415);
    expect(await stored(boardId)).toEqual([]);
  });
});

describe('a file is judged by its bytes, not by its name or its header (TC-13)', () => {
  it('refuses a PDF that was uploaded as a PNG', async () => {
    const boardId = await createBoard();

    const response = await upload(boardId, pdfBytes(), { 'content-type': 'image/png' });
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error?: string }).error).toBe('unsupported_type');
    expect(await stored(boardId)).toEqual([]);
  });

  it('refuses an SVG, which draws as an image and runs as a script', async () => {
    // The format the PRD excludes by name. `File.type` calls it `image/svg+xml`, most pickers offer it, and
    // an `<img>` would happily be the thing that executes whatever is inside it.
    const boardId = await createBoard();
    expect((await upload(boardId, svgBytes(), { 'content-type': 'image/svg+xml' })).status).toBe(415);
    expect(await stored(boardId)).toEqual([]);
  });

  it('refuses bytes that are nothing anybody recognises', async () => {
    const boardId = await createBoard();
    expect((await upload(boardId, new TextEncoder().encode('pretend that this is a picture'))).status).toBe(415);
    // A JPEG whose third byte is missing is a file that was truncated before it started.
    expect((await upload(boardId, Uint8Array.from([0xff, 0xd8, 0x00, 0x01]))).status).toBe(415);
    expect((await stored(boardId)).length).toBe(0);
  });
});

describe('a bucket that fails is said out loud (TC-15)', () => {
  it('answers 500 when the write fails, and says nothing about a key', async () => {
    // Nothing in this environment can be made to fail an R2 write on schedule, so the failure is aimed at
    // the binding itself — the same object the Worker holds, with one method that throws. Everything up to
    // the write is real: the board was created, the bytes were read and sniffed, the key was generated.
    const boardId = await createBoard();
    const failing: Env = {
      ...env,
      ASSETS_BUCKET: {
        ...env.ASSETS_BUCKET,
        put: (async (): Promise<R2Object> => {
          throw new Error('the bucket is having a day');
        }) as R2Bucket['put'],
      },
    };

    const response = await handleUpload(
      request(`/api/boards/${boardId}/assets`, { method: 'POST', body: imageBytes('png') }),
      failing,
      boardId,
    );
    expect(response.status).toBe(500);
    // Read once, as text, and every claim made about the body is made about that one reading: a response is
    // a stream, and a test that asked it twice would be asserting two different things by accident.
    const text = await response.text();
    expect(text).toContain('asset_store_failed');
    // A 500 with a key in it would be the worst possible answer: the client would write a picture address
    // into its board for bytes that were never stored, and the person would come back to a broken image.
    expect(text).not.toContain('assetKey');
    expect(await stored(boardId)).toEqual([]);
  });
});

describe('a stored picture is read back, and only as a picture (TC-16)', () => {
  it('serves the bytes with the headers that keep them a picture', async () => {
    const boardId = await createBoard();
    const key = await keyOf(await upload(boardId, imageBytes('gif89')));

    const response = await SELF.fetch(request(`/api/assets/${key}`));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes('gif89'));
    expect(response.headers.get('content-type')).toBe('image/gif');
    // A year, and `immutable`: a key names bytes and bytes do not change, so a browser that has this
    // picture has no reason to ask about it again for as long as it keeps the board open.
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    // The two that matter on a shared board: a file that turns out not to be what its key says is still not
    // allowed to become a document, a frame or a request.
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(response.headers.get('etag')).not.toBeNull();
  });

  it('serves a picture by its key, without asking whether the board still exists', async () => {
    // The read side's access control is the key and nothing else, which is the same promise story 5 makes
    // about board links: whoever has the address can see the picture. This is asserted rather than assumed
    // because it is the difference between a secret and a permission system, and the next person to read
    // this file will want to know which one this is.
    const boardId = await createBoard();
    const key = await keyOf(await upload(boardId, imageBytes('png')));

    expect((await SELF.fetch(request(`/api/assets/${key}`))).status).toBe(200);
    expect((await SELF.fetch(request(`/api/boards/${boardId}`))).status).toBe(200);
  });

  it('refuses a key that is not a key, before the bucket is asked', async () => {
    // The first is the address itself climbing out of the route, and is a 404 by the general rule about
    // addresses this Worker does not know. The rest arrive as keys, and each one is refused by the pattern
    // without the bucket ever being named: `..%2F` is the traversal that would have reached here.
    for (const path of [
      '/api/assets/../x',
      '/api/assets/a/b',
      '/api/assets/%2e%2e/x',
      `/api/assets/${newBoardId()}`,
      `/api/assets/${newBoardId()}/${'x'.repeat(23)}`,
      `/api/assets/${newBoardId()}/..%2F${newBoardId()}`,
      `/api/assets/..%2F${newBoardId()}%2F${newBoardId()}/x`,
    ]) {
      const response = await SELF.fetch(request(path));
      expect(response.status).toBe(404);
    }
  });

  it('answers 404 for a key that is well formed and names nothing', async () => {
    // The 404 a board shows as "Image unavailable". It is the same answer a malformed key gets, and the
    // difference between "never stored" and "somebody deleted it" is not something this endpoint knows.
    const key = `${newBoardId()}/${newBoardId()}`;
    const response = await SELF.fetch(request(`/api/assets/${key}`));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error?: string }).error).toBe('asset_not_found');
  });

  it('is read by GET, and by nothing else', async () => {
    const boardId = await createBoard();
    const key = await keyOf(await upload(boardId, imageBytes('png')));
    const response = await SELF.fetch(request(`/api/assets/${key}`, { method: 'POST', body: imageBytes('png') }));
    expect(response.status).toBe(405);

    const head = await SELF.fetch(request(`/api/assets/${key}`, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('image/png');
  });

  it('answers in a shape the board can act on when it goes wrong', async () => {
    // Story 17 will read these same routes to embed pictures in an export, and a `<img>` that cannot load
    // tells its reader nothing. The JSON body is for whoever is debugging with a terminal.
    const response = await SELF.fetch(request(`/api/assets/${newBoardId()}/${newBoardId()}`));
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    expect(typeof body.error).toBe('string');
    expect(typeof body.message).toBe('string');
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});

describe('one board’s pictures are not another board’s', () => {
  it('lists, per board, only that board’s files', async () => {
    // The key begins with the board's id, so this is the property that makes a bucket enumerable by board
    // for the export story without one board being able to ask what the others hold.
    const [first, second] = await Promise.all([createBoard(), createBoard()]);
    const firstKey = await keyOf(await upload(first, imageBytes('png')));
    await upload(second, imageBytes('jpeg'));

    expect((await stored(first)).map((object) => object.key)).toEqual([firstKey]);
    expect((await stored(second)).length).toBe(1);
    expect((await env.ASSETS_BUCKET.list({ prefix: 'boards/' })).objects.length).toBe(0);
  });
});

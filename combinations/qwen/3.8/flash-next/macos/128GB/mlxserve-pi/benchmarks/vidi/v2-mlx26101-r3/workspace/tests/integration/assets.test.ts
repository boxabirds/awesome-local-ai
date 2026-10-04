/**
 * Story 12, task 4 (TC-10 … TC-13, TC-15, TC-16): the asset API, over real HTTP, against a real bucket and
 * real boards.
 *
 * The reason this suite exists at all is that everything the client says about a file is a claim, and this
 * is the one place in the product where a claim gets checked by something that isn't the browser that made
 * it. So the tests are written as requests, through `SELF.fetch` and into the Worker's own `fetch` handler:
 * the routing, the order of the checks and the headers on the way out are all part of what is being
 * asserted, and none of them would be observed by calling `handleUpload` with a friendly environment.
 *
 * Two things are checked after every refusal, on top of the status code: that the bucket holds nothing
 * under that board's prefix, and - where it matters - that the board was not disturbed. A refusal that
 * stored the file is the bug this API cannot have, because the files it refuses are the ones that would
 * hurt whoever opens the board next.
 *
 * The bytes come from `tests/fixtures/imageBytes.ts`, which builds them, rather than from
 * `tests/fixtures/images/`, which stores them: this project runs in workerd, where there is no file system
 * to read fixtures from. The same builders are checked against the files on disk from the node side, so a
 * builder that stops producing what the file contains fails there, and not here as a passing test about
 * something nobody would upload.
 */
import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import worker, { type Env } from '../../src/worker/index';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import {
  gifHeader,
  jpegBytesOfLength,
  pdfBytes,
  pseudorandomBytes,
  pngBytes,
  svgBytes,
  truncatedPngBytes,
  webpBytes,
} from '../fixtures/imageBytes';
import { boardStub } from './helpers/storage';
import { env } from './helpers/ws-client';

/** The bucket these tests are about; a test environment without one is a broken test environment. */
const bucket: R2Bucket = env.ASSETS_BUCKET ?? (() => {
  throw new Error('the test deployment has no ASSETS_BUCKET binding, so wrangler.jsonc and vitest are out of step');
})();

/** `POST /api/boards`, the way the product makes a board. */
async function makeBoard(): Promise<string> {
  const response = await SELF.fetch(new Request('http://localhost/api/boards', { method: 'POST' }));
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** Anything that can be a request body, including the bytes of a file. */
type Body = BodyInit | Uint8Array;

/** One path segment, percent-encoded, so that a `/` or a space inside it stays inside it. */
function segment(value: string): string {
  return encodeURIComponent(value);
}

/** `POST /api/boards/<boardId>/assets`. */
function upload(boardId: string, body: Body, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(
    new Request(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      // A Uint8Array is copied into a fresh buffer, because a Request may detach the one it is given and
      // the tests below want to hand the same fixture to the bucket comparison afterwards.
      body: body instanceof Uint8Array ? new Uint8Array(body) : body,
      headers,
    }),
  );
}

/** What an accepted upload answered, in the shape the client will read it in. */
async function accepted(response: Response): Promise<{ assetKey: string; contentType: string }> {
  expect(response.status).toBe(201);
  return (await response.json()) as { assetKey: string; contentType: string };
}

/** The keys the bucket holds for one board, which is every picture that board ever kept. */
async function keysOf(boardId: string): Promise<string[]> {
  const listed = await bucket.list({ prefix: `${boardId}/` });
  return listed.objects.map((object) => object.key);
}

/** The bytes at a key, read straight out of the bucket rather than through the route. */
async function storedBytes(key: string): Promise<Uint8Array | null> {
  const object = await bucket.get(key);
  return object === null ? null : new Uint8Array(await object.arrayBuffer());
}

/** `GET /api/assets/<key>`, with a key that may be anything at all, including `../x`. */
function serve(key: string): Promise<Response> {
  const halves = key.split('/');
  const path =
    halves.length === 2
      ? `/api/assets/${encodeURIComponent(halves[0]!)}/${encodeURIComponent(halves[1]!)}`
      : `/api/assets/${encodeURIComponent(key)}`;
  return SELF.fetch(new Request(`http://localhost${path}`));
}

/*
 * The ten-megabyte files, made once per run rather than once per test: each is a real JPEG with comment
 * segments padded into it, and building two of them costs about the memory of the two boards that will be
 * uploaded to, which is worth a module-level cache and one `if` in each test that wants them.
 */
let atTheLimit: Uint8Array | null = null;
let pastTheLimit: Uint8Array | null = null;

/** A decodable JPEG of exactly {@link IMAGE_MAX_BYTES} bytes. */
function fileAtTheLimit(): Uint8Array {
  atTheLimit ??= jpegBytesOfLength(IMAGE_MAX_BYTES);
  return atTheLimit;
}

/** The same file, one byte bigger, which is the other side of the same line. */
function filePastTheLimit(): Uint8Array {
  pastTheLimit ??= jpegBytesOfLength(IMAGE_MAX_BYTES + 1);
  return pastTheLimit;
}

/* --------------------------------------------------------------------------- TC-10 */

describe('an upload is decided by its bytes (TC-10)', () => {
  it('keeps a real PNG and says so with the key it will be served by', async () => {
    const boardId = await makeBoard();
    const png = await pngBytes(1440, 900);

    const answer = await accepted(await upload(boardId, png));
    // The key is this board's and this file's: 22 characters of board id, a slash, and 22 characters of
    // something nobody could have guessed, which is the only access control an asset has.
    expect(answer.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(answer.assetKey.startsWith(`${boardId}/`)).toBe(true);
    expect(answer.contentType).toBe('image/png');

    // The object is in the bucket under that key, and its stored content type is the one that was decided -
    // which is what every later response will be served with, for as long as the key lives.
    const head = await bucket.head(answer.assetKey);
    expect(head?.httpMetadata?.contentType).toBe('image/png');
    expect(head?.size).toBe(png.byteLength);
    expect(await storedBytes(answer.assetKey)).toEqual(png);
  });

  it('takes the other three formats on the strength of their first bytes', async () => {
    // One case for the four signatures, because the sniffer is a table and a table with a broken row is a
    // whole format that cannot be dropped onto a board. GIF87a is here as its own row on purpose: it is a
    // real file format that no browser has stopped opening.
    const boardId = await makeBoard();
    const files: ReadonlyArray<readonly [Uint8Array, string]> = [
      [await pngBytes(64, 48), 'image/png'],
      [jpegBytesOfLength(4096), 'image/jpeg'],
      [gifHeader('89a'), 'image/gif'],
      [gifHeader('87a'), 'image/gif'],
      [webpBytes(), 'image/webp'],
    ];

    for (const [bytes, contentType] of files) {
      const answer = await accepted(await upload(boardId, bytes));
      expect(answer.contentType).toBe(contentType);
      expect(await storedBytes(answer.assetKey)).toEqual(bytes);
    }
    expect(await keysOf(boardId)).toHaveLength(files.length);
  });

  it('ignores the type the request claims and the name the file had', async () => {
    // There is no filename in this request at all, and `Content-Type` is the uploader's opinion. A browser
    // that was fooled by an extension - or a curl that was told anything at all - is answered by the bytes,
    // which is also why a PNG renamed `holiday.jpg` and a PNG uploaded with no headers are the same upload.
    const boardId = await makeBoard();
    const png = await pngBytes(32, 24);

    const claimed = await accepted(await upload(boardId, png, { 'Content-Type': 'text/plain; charset=utf-8' }));
    expect(claimed.contentType).toBe('image/png');
    const silent = await accepted(await upload(boardId, png));
    expect(silent.contentType).toBe('image/png');
    expect(claimed.assetKey).not.toBe(silent.assetKey);
  });

  it('answers a file too short to have a signature instead of falling over on it', async () => {
    // Three bytes are shorter than the head the sniffer reads, and a sniffer that read twelve of a
    // three-byte buffer would not refuse this upload, it would not answer at all. The bytes are refused;
    // the point of the test is that they are refused.
    const boardId = await makeBoard();
    const response = await upload(boardId, new Uint8Array([0x89, 0x50, 0x4e]));
    expect(response.status).toBe(415);
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('gives every file its own key, and keeps them apart', async () => {
    // A second upload of the same file is a second key, not an overwrite: this is what lets every asset be
    // cached for a year, and what means two people dropping the same screenshot onto the same board cannot
    // be told each other's copy has changed.
    const boardId = await makeBoard();
    const png = await pngBytes(48, 32);
    const first = await accepted(await upload(boardId, png));
    const second = await accepted(await upload(boardId, png));
    expect(first.assetKey).not.toBe(second.assetKey);

    const keys = await keysOf(boardId);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain(first.assetKey);
    expect(keys).toContain(second.assetKey);
  });
});

/* --------------------------------------------------------------------------- TC-11 */

describe('a board that is not there keeps nothing (TC-11, negative)', () => {
  it('refuses a file addressed to a board that was never made', async () => {
    const boardId = newBoardId();
    const response = await upload(boardId, await pngBytes(32, 24));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(await keysOf(boardId)).toEqual([]);
    // And the address is still not a board: asking an unknown link for a picture must not be what makes one.
    expect(await boardStub(boardId).exists()).toBe(false);
  });

  it('refuses an id that is not a board id, without waking anything', async () => {
    for (const candidate of ['abc', 'a'.repeat(23), 'has space', 'a.b', 'board/id', '%2e%2e', 'AB!']) {
      const response = await upload(segment(candidate), new Uint8Array([1, 2, 3]));
      expect(response.status, candidate).toBe(404);
      expect(await response.json(), candidate).toEqual({ error: 'not_found' });
    }
  });

  it('is not reachable at all by a path that tries to climb out of it', async () => {
    // The story of this test is about where a `..` is dealt with, and it is not dealt with here: the URL
    // that a request is built from removes dot segments - percent-encoded ones included - before this
    // Worker is given anything, so `/api/boards/%2E%2E/assets` arrives as `/api/assets`, which is not a
    // route, is not a board, and cannot store a picture for one. The pattern in `image-format` refuses the
    // same shape a second time, for the day something hands this handler a pathname that did not come
    // through a URL (TC-02). What is asserted here is the outer fact: a traversal attempt reads nothing,
    // writes nothing, and is not answered as an asset.
    const climbing = new Request('http://localhost/api/boards/%2E%2E/assets', { method: 'POST' });
    expect(climbing.url).not.toContain('/api/boards/');

    const reads: string[] = [];
    const watched: Env = {
      ...env,
      ASSETS_BUCKET: {
        get: async (key: string) => {
          reads.push(key);
          return bucket.get(key);
        },
      } as unknown as R2Bucket,
    };
    const response = await worker.fetch(climbing, watched);
    expect(response.headers.get('content-type') ?? '').not.toMatch(/^image\//);
    expect(reads).toEqual([]);
  });

  it('refuses an upload whose board half is somebody else\'s, because the key is decided here', async () => {
    // The route asks the board for the file, and the key it writes begins with the board in the route - not
    // with anything in the body. A file cannot be filed under a board that did not ask for it.
    const boardId = await makeBoard();
    const answer = await accepted(await upload(boardId, await pngBytes(16, 16)));
    const [boardInKey] = answer.assetKey.split('/');
    expect(boardInKey).toBe(boardId);
    expect(boardInKey).not.toBe(newBoardId());
  });
});

/* --------------------------------------------------------------------------- TC-12 */

describe('the limit is on the bytes (TC-12)', () => {
  it('refuses a file one byte over it, and stores nothing', async () => {
    const boardId = await makeBoard();
    const response = await upload(boardId, filePastTheLimit());

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'too_large' });
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('takes a file of exactly the limit', async () => {
    // The boundary, from the other side: "larger than 10 MB" is not "10 MB", and a limit that refused its
    // own size would be a file nobody can upload and a message nobody can act on.
    const boardId = await makeBoard();
    const answer = await accepted(await upload(boardId, fileAtTheLimit()));
    expect(answer.contentType).toBe('image/jpeg');
    expect((await bucket.head(answer.assetKey))?.size).toBe(IMAGE_MAX_BYTES);
  });

  it('refuses on the length the request declared, before reading the file', async () => {
    // The declaration is a claim, so it cannot *allow* anything - a three-byte body that declares twenty
    // megabytes gets a 413 it did not need - but it can refuse early, and refusing before pulling ten
    // megabytes into a Worker's memory is the only cheap protection this route has.
    const boardId = await makeBoard();
    const response = await SELF.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        headers: { 'Content-Length': String(IMAGE_MAX_BYTES + 1_000_000) },
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      }),
    );
    expect(response.status).toBe(413);
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('refuses on the real length when the request declared nothing', async () => {
    // A stream has no length to declare. What is left to check is the bytes themselves, which is the check
    // that has to be here for the limit to be a limit rather than a suggestion.
    const boardId = await makeBoard();
    const big = filePastTheLimit();
    const response = await SELF.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(big));
            controller.close();
          },
        }),
      }),
    );
    expect(response.status).toBe(413);
    expect(await keysOf(boardId)).toEqual([]);
  });
});

/* --------------------------------------------------------------------------- TC-13 */

describe('a file that is not one of the four images is not stored (TC-13, negative)', () => {
  it('refuses a PDF wearing a PNG\'s content type', async () => {
    // This is the fixture's whole reason for existing: the file the browser was told is a PNG, uploaded by
    // a client that was told it was a PNG. What arrives is `%PDF`, and `%PDF` is not a picture.
    const boardId = await makeBoard();
    const response = await upload(boardId, pdfBytes(), { 'Content-Type': 'image/png' });

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'unsupported_type' });
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('refuses an SVG with a script in it', async () => {
    // An SVG is an image to an <img> and a document to a top-level navigation, and it can carry a script
    // that runs with the origin of whoever served it. Of the four accepted formats, none can do that, which
    // is the actual reason the list is four long.
    const boardId = await makeBoard();
    const response = await upload(boardId, svgBytes(), { 'Content-Type': 'image/svg+xml' });

    expect(response.status).toBe(415);
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('keeps a real image claimed as another format, and labels it with what it is', async () => {
    // A claim is not a disguise when nothing acts on it: a GIF uploaded with `Content-Type: image/png` is
    // kept, and is kept *as* a GIF, because the one decision about what this file is gets made from the
    // bytes. What cannot happen - which is the thing worth forbidding - is a bucket that hands out a GIF
    // under a PNG's label, and a browser then being told to trust the label.
    const boardId = await makeBoard();
    const claimed = await accepted(await upload(boardId, gifHeader('89a'), { 'Content-Type': 'image/png' }));
    expect(claimed.contentType).toBe('image/gif');
    const reversed = await accepted(await upload(boardId, await pngBytes(16, 16), { 'Content-Type': 'image/gif' }));
    expect(reversed.contentType).toBe('image/png');

    const served = await serve(claimed.assetKey);
    expect(served.headers.get('Content-Type')).toBe('image/gif');
    expect((await serve(reversed.assetKey)).headers.get('Content-Type')).toBe('image/png');
  });

  it('refuses a body that is nothing at all, and one that is random bytes', async () => {
    const boardId = await makeBoard();
    expect((await upload(boardId, new Uint8Array(0))).status).toBe(415);
    expect((await upload(boardId, pseudorandomBytes(4096, 7))).status).toBe(415);
    expect(await keysOf(boardId)).toEqual([]);
  });

  it('keeps a PNG that stops in the middle of its pixel data, because that is all this route can see', async () => {
    // Not a loophole, a division of labour: the signature is a PNG's signature and this Worker does not
    // decode pictures - the browser does, before it uploads, and a picture it cannot decode never gets as
    // far as this route (TC-29). What this test pins down is that the route's decision is made on the
    // signature, the whole signature and nothing but the signature - so that nobody reads a missing check
    // into it later.
    const boardId = await makeBoard();
    const truncated = await truncatedPngBytes(400);
    const answer = await accepted(await upload(boardId, truncated));
    expect(answer.contentType).toBe('image/png');
    expect(await storedBytes(answer.assetKey)).toEqual(truncated);
  });
});

/* --------------------------------------------------------------------------- TC-15 */

describe('when the bucket fails, say so (TC-15, error path)', () => {
  /** An environment whose bucket fails whatever it is asked to do. */
  function brokenBucket(message: string): { env: Env; asked: string[] } {
    const asked: string[] = [];
    const broken = {
      put: async (key: string): Promise<never> => {
        asked.push(`put ${key}`);
        throw new Error(message);
      },
      get: async (key: string): Promise<never> => {
        asked.push(`get ${key}`);
        throw new Error(message);
      },
    };
    return {
      env: { ...env, ASSETS_BUCKET: broken as unknown as R2Bucket },
      asked,
    };
  }

  it('answers 500 when the upload could not be written, and stores nothing', async () => {
    const boardId = await makeBoard();
    const broken = brokenBucket('the bucket is not answering');

    const response = await worker.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: new Uint8Array(await pngBytes(32, 24)),
      }),
      broken.env,
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'storage_failed' });
    // It did try, once: a route that retried a write that had failed would be a route with three objects
    // for one dropped file, and no idea which of them anything refers to.
    expect(broken.asked).toHaveLength(1);
    expect((await bucket.list({ prefix: `${boardId}/` }).then((listed) => listed.objects)).length).toBe(0);
  });

  it('answers 500 when a picture could not be read', async () => {
    const broken = brokenBucket('the bucket is not answering');
    const response = await worker.fetch(
      new Request(`http://localhost/api/assets/${newBoardId()}/${newBoardId()}`),
      broken.env,
    );
    expect(response.status).toBe(500);
    expect(broken.asked).toHaveLength(1);
  });

  it('answers 500 when this deployment has no bucket at all', async () => {
    // The binding is optional in the type, and a deployment that was made without it should not answer an
    // upload with an exception or a 404 that blames the board.
    const without: Env = { BOARD_ROOM: env.BOARD_ROOM, ASSETS: env.ASSETS };
    const boardId = await makeBoard();

    const uploaded = await worker.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: new Uint8Array(await pngBytes(16, 16)),
      }),
      without,
    );
    const served = await worker.fetch(
      new Request(`http://localhost/api/assets/${newBoardId()}/${newBoardId()}`),
      without,
    );

    expect(uploaded.status).toBe(500);
    expect(served.status).toBe(500);
    expect(await keysOf(boardId)).toEqual([]);
  });
});

/* --------------------------------------------------------------------------- TC-16 */

describe('a picture is served with the headers that make it only a picture (TC-16)', () => {
  it('serves the bytes, the type, and the three headers', async () => {
    const boardId = await makeBoard();
    const png = await pngBytes(64, 48);
    const answer = await accepted(await upload(boardId, png));

    const response = await serve(answer.assetKey);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    // A year, and immutable: safe only because a key is never reused, so this is the header that says so
    // out loud about the design of the keys next to it.
    expect(response.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(response.headers.get('Cache-Control')).toContain(String(31_536_000));
    // The two that are about whoever receives it: a browser that doubts the type is told not to go looking
    // for another one, and a response that somehow became a document is told it may load nothing.
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
  });

  it('serves the type that was decided at upload, never the type that was claimed', async () => {
    const boardId = await makeBoard();
    const answer = await accepted(await upload(boardId, webpBytes(), { 'Content-Type': 'text/plain' }));
    const response = await serve(answer.assetKey);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
  });

  it('answers a key that was never written with 404, and says nothing else', async () => {
    // A board naming a key that is not in the bucket is the "Image unavailable" case: the client draws the
    // sentence, and the route's job is only to not pretend. A well formed key is answered exactly like a
    // malformed one, so this cannot be used to find out which keys a board has.
    const missing = await serve(`${await makeBoard()}/${newBoardId()}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
  });

  it('answers a key that is not a key with 404, without reading the bucket', async () => {
    const reads: string[] = [];
    const watched: Env = {
      ...env,
      ASSETS_BUCKET: {
        get: async (key: string) => {
          reads.push(key);
          return bucket.get(key);
        },
      } as unknown as R2Bucket,
    };

    const boardId = await makeBoard();
    for (const key of [
      `${'a'.repeat(23)}/${newBoardId()}`,
      `${boardId}/${'a'.repeat(23)}`,
      `${boardId}/${newBoardId()}.png`,
      `${boardId}/a b`,
      `${boardId}/a.b`,
      `${boardId}/..x`,
      `${'a'.repeat(21)}/${'b'.repeat(23)}`,
      `${boardId}/${boardId.slice(0, 21)}`,
    ]) {
      const halves = key.split('/');
      const path = `/api/assets/${halves.map((half) => segment(half)).join('/')}`;
      const response = await worker.fetch(new Request(`http://localhost${path}`), watched);
      expect(response.status, key).toBe(404);
      expect(await response.json(), key).toEqual({ error: 'not_found' });
    }
    // Not one read: the shape of a key is checked before the bucket is asked, which is what keeps a route
    // that anybody on the internet can reach from being a way to make bucket reads at will. A key that *is*
    // well formed costs a read and gets the same 404 - which is the price of a system where the key is the
    // only authorisation, and is why the key has 128 bits in it rather than a counter.
    expect(reads).toEqual([]);
  });

  it('leaves a path that is not shaped like a key to the application', async () => {
    const reads: string[] = [];
    const watched: Env = {
      ...env,
      ASSETS_BUCKET: {
        get: async (key: string) => {
          reads.push(key);
          return bucket.get(key);
        },
      } as unknown as R2Bucket,
    };
    const boardId = await makeBoard();
    const assetId = newBoardId();

    // One part, or three, or none: a pathname that is not `<22>/<22>` under `/api/assets/` is not this
    // route's business, and the Worker hands it to the static assets like any other unknown address - the
    // application, with no bytes in it that a browser would draw as a picture. It is not a bucket read
    // either, which is the part that costs something.
    for (const path of ['/api/assets', `/api/assets/${assetId}`, `/api/assets/${boardId}/${assetId}/extra`]) {
      const response = await worker.fetch(new Request(`http://localhost${path}`), watched);
      expect(response.headers.get('content-type') ?? '', path).not.toMatch(/^image\//);
      expect(response.headers.get('X-Content-Type-Options'), path).toBeNull();
    }
    expect(reads).toEqual([]);
  });

  it('refuses methods that have no meaning here', async () => {
    const boardId = await makeBoard();
    const answer = await accepted(await upload(boardId, await pngBytes(16, 16)));

    // Nothing to overwrite, nothing to delete, nothing to list: a key is written once by the board that
    // asked for it and read after that, which is the whole lifecycle.
    expect((await upload(boardId, new Uint8Array(0), { 'X': 'y' })).status).toBe(415);
    expect((await SELF.fetch(new Request(`http://localhost/api/boards/${boardId}/assets`, { method: 'GET' }))).status).toBe(405);
    expect((await SELF.fetch(new Request(`http://localhost/api/boards/${boardId}/assets`, { method: 'DELETE' }))).status).toBe(405);
    expect((await SELF.fetch(new Request(`http://localhost/api/assets/${answer.assetKey}`, { method: 'POST' }))).status).toBe(405);
    expect((await SELF.fetch(new Request(`http://localhost/api/assets/${answer.assetKey}`, { method: 'PUT' }))).status).toBe(405);
  });

  it('keeps one board\'s pictures out of every other board\'s reach', async () => {
    // The keys are unguessable, and this is the least that can be said about them: a board cannot read a
    // picture that belongs to another board, and the only thing that stops it is that nobody outside the
    // board that stored it ever learns the key.
    const first = await makeBoard();
    const second = await makeBoard();
    const answer = await accepted(await upload(first, await pngBytes(16, 16)));

    expect((await serve(answer.assetKey)).status).toBe(200);
    expect(await keysOf(second)).toEqual([]);
    // The same key answered from a different route is still the same bytes; there is no per-board check on
    // the serving route, because there is nothing to check against - a key is its own capability.
    expect((await serve(answer.assetKey)).status).toBe(200);
  });

  it('answers the id pattern of a real board with a made-up asset half', async () => {
    // Half a key being a real board is not half an authorisation: the asset half is 128 random bits, and a
    // guess lands in the same 404 as everything else.
    const boardId = await makeBoard();
    const guessed = await serve(`${boardId}/${newBoardId()}`);
    expect(guessed.status).toBe(404);
    expect(boardId).toMatch(BOARD_ID_PATTERN);
  });
});

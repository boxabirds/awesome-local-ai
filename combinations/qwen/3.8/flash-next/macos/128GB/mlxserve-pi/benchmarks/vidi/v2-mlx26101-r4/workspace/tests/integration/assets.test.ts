/**
 * The picture store, over a real wire (story 12, TC-10 to TC-16).
 *
 * These run inside workerd against the Worker that ships: the real front door does the routing, a real
 * `BoardRoom` answers whether a board exists, and a real (local) R2 bucket holds the bytes. Nothing is mocked
 * except in two tests, where a bucket that throws is the only honest way to ask what a storage failure sounds
 * like.
 *
 * What only this layer can show:
 *
 *   - TC-10 — a picture that was accepted is *in the bucket*, under a key of the board's own shape, with the
 *     type it was sniffed as written into the object. The client cannot store anything, so this is the only
 *     place "it is stored" can be checked.
 *   - TC-11 — an upload does not create a board, and a picture is never stored against an address that has no
 *     board behind it.
 *   - TC-12 — the limit is enforced on the way in, on the byte count, and a file exactly at the limit still
 *     gets through.
 *   - TC-13 — the type is decided by the bytes. A PDF that claims to be a PNG, and an SVG, are both refused
 *     with nothing stored; the four kinds the board draws are all accepted on their headers alone.
 *   - TC-15 — a storage failure is a 500, and it is written down.
 *   - TC-16 — a stored picture comes back with the headers that keep it from being executed or
 *     re-interpreted, and a key that is not a key is refused.
 *
 * About the bytes: this route decides from the first `IMAGE_SNIFF_BYTES` and never decodes a picture, so the
 * fixtures here are real headers with filler behind them — which is precisely what the route looks at. The
 * pictures a browser has to *draw* are the e2e fixtures (TC-25 to TC-28), and those are real encoded images.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';
import { handleServe, handleUpload } from '../../src/worker/assets';
import type { Env } from '../../src/worker/board-room';
import { checkBoard, createBoard, fetchPath, request } from './helpers/ws-client';

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

/** A file body of a given total size: a real header, and filler. The route reads the header and nothing else. */
function body(header: readonly number[], totalLength: number): Uint8Array {
  const bytes = new Uint8Array(totalLength);
  bytes.set(header, 0);
  return bytes;
}

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const PNG = body(PNG_HEADER, 4096);
const JPEG = body(JPEG_HEADER, 4096);
/** A PDF, in the bytes a PDF actually begins with. */
const PDF = body([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], 512);
/** A real, tiny SVG text document: an image to a browser, a document to this board. */
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
);

/** Upload a body to a board, and hand back the answer unread. */
function upload(boardId: string, bytes: Uint8Array, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(
    request(`/api/boards/${boardId}/assets`, { method: 'POST', body: bytes as unknown as BodyInit, headers }),
  );
}

/** Ask for the key the route would answer for, and hand back the status. */
function serve(key: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(request(`/api/assets/${key}`, init));
}

/** Every key in the bucket, which is how "nothing was stored" is shown. */
async function keys(): Promise<string[]> {
  const found: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.ASSETS_BUCKET.list(cursor === undefined ? {} : { cursor });
    for (const object of page.objects) found.push(object.key);
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return found.sort();
}

/**
 * Run something that is expected to log an error, and hand back what was logged.
 *
 * A 500 that says nothing and a 500 that says "the bucket is not answering" are the same answer to the person
 * waiting and a different product to whoever has to fix it — so the tests that expect a 500 check that it was
 * written down. Restored in a `finally`, because `console.error` belongs to the run and not to this test.
 */
async function withLoggedErrors(run: () => Promise<void>): Promise<string> {
  const original = console.error;
  let seen = '';
  console.error = (...args: unknown[]): void => {
    seen += `${args.map((arg) => String(arg)).join(' ')}\n`;
  };
  try {
    await run();
  } finally {
    console.error = original;
  }
  return seen;
}

/** An environment whose bucket throws at one call, and is the real one at every other. */
function bucketThatThrowsAt(method: 'put' | 'get'): Env {
  const broken = {
    [method]: async (): Promise<never> => {
      throw new Error('the bucket is not answering');
    },
  };
  return new Proxy(env, {
    get: (target, key) => (key === 'ASSETS_BUCKET' ? broken : Reflect.get(target, key)),
  }) as unknown as Env;
}

describe('storing a picture', () => {
  it('keeps a real PNG for a board that exists, and says where it went (TC-10)', async () => {
    const boardId = await createBoard();

    const response = await upload(boardId, PNG);
    expect(response.status).toBe(201);
    const stored = (await response.json()) as Record<string, unknown>;

    // The key the board writes into its document is the bucket's key, and nothing else.
    expect(typeof stored.assetKey).toBe('string');
    const assetKey = String(stored.assetKey);
    expect(ASSET_KEY_PATTERN.test(assetKey)).toBe(true);
    expect(assetKey.startsWith(`${boardId}/`)).toBe(true);
    expect(stored.contentType).toBe('image/png');

    const object = await env.ASSETS_BUCKET.get(assetKey);
    expect(object).not.toBeNull();
    expect(object!.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(PNG);
  });

  it('gives every upload its own key, even the same file twice (TC-10)', async () => {
    const boardId = await createBoard();

    const first = String(((await (await upload(boardId, PNG)).json()) as { assetKey: string }).assetKey);
    const second = String(((await (await upload(boardId, PNG)).json()) as { assetKey: string }).assetKey);

    // Two files that are byte for byte the same are still two pictures: a person who drops the same
    // screenshot twice has made two objects, and one key behind both would draw one picture in two boxes —
    // and deleting one would take the other's bytes with it.
    expect(first).not.toBe(second);
    const inBucket = await keys();
    expect(inBucket).toContain(first);
    expect(inBucket).toContain(second);
  });

  it('accepts all four kinds on their headers alone (TC-13, the half that is yes)', async () => {
    const boardId = await createBoard();
    const accepted: ReadonlyArray<readonly [string, Uint8Array]> = [
      ['image/png', PNG],
      ['image/jpeg', JPEG],
      ['image/gif', body([0x47, 0x49, 0x46, 0x38, 0x37, 0x61], 256)],
      ['image/gif', body([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 256)],
      // `RIFF`, a length, then `WEBP`: the signature is split by a length field, which is why the sniff reads
      // twelve bytes and not eight.
      ['image/webp', body([0x52, 0x49, 0x46, 0x46, 0x2e, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], 256)],
    ];

    for (const [contentType, bytes] of accepted) {
      const response = await upload(boardId, bytes);
      expect(`${contentType}: ${response.status}`).toBe(`${contentType}: 201`);
      const result = (await response.json()) as { contentType: string; assetKey: string };
      expect(result.contentType).toBe(contentType);
      // The type in the response is the type written into the object, because that is the type every later
      // reader is handed.
      const object = await env.ASSETS_BUCKET.get(result.assetKey);
      expect(object?.httpMetadata?.contentType).toBe(contentType);
    }
  });

  it('refuses a board nobody made, and an address that is not one, and stores nothing (TC-11)', async () => {
    const before = await keys();

    // A well-formed address with no board behind it. A picture uploaded here would have no board to belong
    // to and no room that could ever tell anybody it existed.
    const never = newBoardId();
    const unknown = await upload(never, PNG);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'not_found' });
    // Asking about a board does not make it one.
    expect((await checkBoard(never)).status).toBe(404);

    // Addresses that are not addresses. `..` is not in this list because a URL parser resolves it away before
    // the Worker is asked; the escaped forms are here because those do reach it, and are the ones the route
    // has to refuse for itself.
    for (const bad of ['bad!id', 'short', 'x'.repeat(21), 'x'.repeat(23), 'x'.repeat(22).slice(0, 21)]) {
      const response = await upload(encodeURIComponent(bad), PNG);
      expect(`${bad}: ${response.status}`).toBe(`${bad}: 404`);
      await response.text();
    }
    const empty = await upload('', PNG);
    expect(empty.status).toBe(404);
    await empty.text();

    // Nothing after `/assets` either: `<id>/assets/extra` names no board, and it is not an upload address.
    const trailing = await SELF.fetch(
      request(`/api/boards/${newBoardId()}/assets/extra`, { method: 'POST', body: PNG as unknown as BodyInit }),
    );
    expect(trailing.status).toBe(404);
    await trailing.text();

    expect(await keys()).toEqual(before);
  });

  it('refuses a body over the limit and takes one exactly at it (TC-12)', async () => {
    const boardId = await createBoard();
    const before = await keys();

    const over = await upload(boardId, body(JPEG_HEADER, IMAGE_MAX_BYTES + 1));
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: 'too_large' });
    expect(await keys()).toEqual(before);

    // The limit is inclusive: "10 MB or smaller" is what the message promises, so a file of exactly the
    // limit is a file the board has to take.
    const exactly = await upload(boardId, body(JPEG_HEADER, IMAGE_MAX_BYTES));
    expect(exactly.status).toBe(201);
    await exactly.json();
  });

  it('refuses a file whose bytes are not one of the four, whatever it claims (TC-13)', async () => {
    const boardId = await createBoard();
    const before = await keys();

    // The claim is what a browser puts in `Content-Type` from the file name; the bytes are what the route
    // reads. This is the renamed PDF from the PRD.
    const disguised = await upload(boardId, PDF, { 'Content-Type': 'image/png' });
    expect(disguised.status).toBe(415);
    expect(await disguised.json()).toEqual({ error: 'unsupported_type' });

    // An SVG is an image to a browser and an XML document to a board that draws pictures.
    const vector = await upload(boardId, SVG, { 'Content-Type': 'image/svg+xml' });
    expect(vector.status).toBe(415);
    await vector.text();

    // Nothing at all, and a header too short to read.
    for (const short of [new Uint8Array(0), new Uint8Array([0x89, 0x50, 0x4e])]) {
      const response = await upload(boardId, short);
      expect(response.status).toBe(415);
      await response.text();
    }

    expect(await keys()).toEqual(before);
  });

  it('answers a storage failure with 500 and says so in the log (TC-15)', async () => {
    const boardId = await createBoard();
    const before = await keys();

    // The one thing that cannot be made to happen on purpose. The request is real, the board is real, and the
    // bucket is the real one for everything except taking these bytes.
    const logged = await withLoggedErrors(async () => {
      const response = await handleUpload(
        request(`/api/boards/${boardId}/assets`, { method: 'POST', body: PNG as unknown as BodyInit }),
        bucketThatThrowsAt('put'),
        boardId,
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'storage_failed' });
    });
    expect(logged).toContain('the bucket is not answering');
    expect(await keys()).toEqual(before);
  });

  it('only takes a POST, for a board that does exist', async () => {
    const boardId = await createBoard();
    const get = await SELF.fetch(request(`/api/boards/${boardId}/assets`));
    expect(get.status).toBe(405);
    expect(await get.json()).toEqual({ error: 'method_not_allowed' });
  });
});

describe('handing a picture back', () => {
  it('serves a stored picture with the headers that keep it a picture (TC-16)', async () => {
    const boardId = await createBoard();
    const assetKey = String(((await (await upload(boardId, PNG)).json()) as { assetKey: string }).assetKey);

    const response = await serve(assetKey);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);

    // A HEAD is the same answer without the bytes.
    const head = await serve(assetKey, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Type')).toBe('image/png');
    expect(await head.text()).toBe('');
  });

  it('refuses a picture nobody stored, and a key that is not a key (TC-16)', async () => {
    const boardId = await createBoard();

    const gone = await serve(`${boardId}/${newBoardId()}`);
    expect(gone.status).toBe(404);
    await gone.text();

    // Three kinds of "not a key", and where each one is actually stopped.
    //
    // A `..` — written plainly or as `%2e%2e`, which the URL parser treats as a double-dot segment — is
    // resolved away before the Worker is asked, so it never reaches the asset route at all: the answer is the
    // app, and what matters is that no picture's bytes are in it. An escaped slash survives as text inside one
    // segment and reaches the route, which is where it is refused. And an empty key is refused for the same
    // reason as a key that was never stored.
    for (const resolved of ['..', '%2e%2e/x', '../../assets/x']) {
      const response = await serve(resolved);
      const type = response.headers.get('Content-Type') ?? '';
      // The defence here is the URL parser, and the assertion says so rather than claiming the route did it.
      expect(`${resolved}: ${response.status} ${type.includes('image/')}`).toBe(`${resolved}: 200 false`);
      await response.text();
    }
    for (const escaped of [`${boardId}%2F${newBoardId()}`, '%2E%2E%2F%2E%2E%2Fsecret', '']) {
      const response = await serve(escaped);
      expect(`${escaped}: ${response.status}`).toBe(`${escaped}: 404`);
      await response.text();
    }
    // The route's own answer for the traversals the URL parser would otherwise perform.
    for (const traversal of ['../../x', '../etc/passwd', '%2e%2e%2f%2e%2e%2fsecret', '..%2F..%2Fassets']) {
      const response = await handleServe(env, traversal);
      expect(`${traversal}: ${response.status}`).toBe(`${traversal}: 404`);
      await response.text();
    }

    // The right shape and the wrong lengths: a key is two ids of exactly 22 characters.
    for (const bad of [`${'x'.repeat(21)}/${newBoardId()}`, `${boardId}/${'x'.repeat(23)}`, `${boardId}/`]) {
      const response = await handleServe(env, bad);
      expect(`${bad}: ${response.status}`).toBe(`${bad}: 404`);
      await response.text();
    }
  });

  it('refuses a stored object whose type is not one of ours, rather than serve it wearing one', async () => {
    const boardId = await createBoard();
    const assetKey = String(((await (await upload(boardId, PNG)).json()) as { assetKey: string }).assetKey);

    // Something wrote a picture into the bucket behind this Worker's back, wearing a type it was never
    // sniffed as. The answer is that there is nothing here, not a byte stream wearing a lie.
    await env.ASSETS_BUCKET.put(assetKey, PNG, { httpMetadata: { contentType: 'text/html' } });
    const logged = await withLoggedErrors(async () => {
      const response = await handleServe(env, assetKey);
      expect(response.status).toBe(404);
      await response.text();
    });
    expect(logged).toContain(assetKey);
  });

  it('answers a storage failure while serving with 500, not with a missing picture', async () => {
    const boardId = await createBoard();
    const assetKey = String(((await (await upload(boardId, PNG)).json()) as { assetKey: string }).assetKey);

    // "Could not look it up" and "is not there" are different facts, and a board told the second one will tell
    // everybody the picture is gone.
    const logged = await withLoggedErrors(async () => {
      const response = await handleServe(bucketThatThrowsAt('get'), assetKey);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'storage_failed' });
    });
    expect(logged).toContain('the bucket is not answering');
  });

  it('leaves an address that is not a picture to the app', async () => {
    // `/api/assets` on its own names no picture, and is not an upload address either. It belongs to the
    // client, which is what the app is served from — the difference between a route that refuses and a route
    // that swallows the site.
    const response = await fetchPath('/api/assets');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
  });
});

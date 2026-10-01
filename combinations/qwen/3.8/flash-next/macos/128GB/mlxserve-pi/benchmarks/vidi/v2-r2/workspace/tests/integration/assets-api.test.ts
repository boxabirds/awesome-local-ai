// Task 4, cases 10 to 13 and 15 to 16: the asset API against a real Worker `fetch`, a real
// Durable Object and a real bucket - nothing mocked anywhere in the path.
//
// What these cases are really about is what is *not* in the bucket. A `413`, a `415` and a
// `404` are only worth anything if the object was never written, so almost every test here
// reads the bucket afterwards and finds it the size it was before.

import { describe, expect, it } from 'vitest';
import { SELF, env, listDurableObjectIds } from 'cloudflare:test';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  gif87aBytes,
  gif89aBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
  shortBytes,
  svgBytes,
  webpBytes,
} from '../fixtures/image-bytes';
import { createdBoardId } from './helpers/room';

const UPLOAD = (boardId: string) => `http://localhost/api/boards/${boardId}/assets`;
const ASSET = (key: string) => `http://localhost/api/assets/${key}`;

function body(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A file of a given size that starts with the given signature. */
function fileOf(size: number, signature: Uint8Array): Uint8Array {
  return body(signature, new Uint8Array(Math.max(0, size - signature.length)));
}

function upload(boardId: string, bytes: Uint8Array, headers: Record<string, string> = {}) {
  return SELF.fetch(UPLOAD(boardId), { method: 'POST', body: bytes, headers });
}

/**
 * The keys of one board's pictures.
 *
 * Prefix-scoped on purpose: the bucket is one bucket for every board and every test in this
 * file, so "nothing was stored" is only ever a statement about the board under discussion.
 */
async function bucketKeys(boardId: string): Promise<string[]> {
  const listed = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
  return listed.objects.map((object) => object.key);
}

describe('TC-10 uploads an image to a board that exists', () => {
  it('answers 201 with a key, and the bytes are in the bucket under it', async () => {
    const boardId = await createdBoardId();
    const response = await upload(boardId, pngBytes());
    expect(response.status).toBe(201);

    const stored = (await response.json()) as { assetKey: string; contentType: string };
    expect(isValid(stored.assetKey, boardId)).toBe(true);
    expect(stored.contentType).toBe('image/png');

    const object = await env.ASSETS_BUCKET.get(stored.assetKey);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0)).byteLength).toBe(
      pngBytes().length,
    );
  });

  it('the key is this board\'s own: board first, a fresh id second', async () => {
    const boardId = await createdBoardId();
    const { assetKey } = (await (await upload(boardId, pngBytes())).json()) as { assetKey: string };
    const [keyBoard, keyAsset] = assetKey.split('/');
    expect(keyBoard).toBe(boardId);
    expect(keyAsset).not.toBe(boardId);
    expect(keyAsset).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('two uploads to one board are two objects', async () => {
    const boardId = await createdBoardId();
    const first = (await (await upload(boardId, pngBytes())).json()) as { assetKey: string };
    const second = (await (await upload(boardId, pngBytes())).json()) as { assetKey: string };
    expect(first.assetKey).not.toBe(second.assetKey);
    expect(await bucketKeys(boardId)).toHaveLength(2);
  });
});

describe('TC-11 the type comes from the bytes, not from the header', () => {
  const cases: [string, Uint8Array, string][] = [
    ['PNG', pngBytes(), 'image/png'],
    ['JPEG', jpegBytes(), 'image/jpeg'],
    ['GIF87a', gif87aBytes(), 'image/gif'],
    ['GIF89a', gif89aBytes(), 'image/gif'],
    ['WebP', webpBytes(), 'image/webp'],
  ];

  for (const [name, bytes, contentType] of cases) {
    it(`stores a ${name} under the Content-Type its own bytes state`, async () => {
      const boardId = await createdBoardId();
      // the header says something else entirely, and the header is what a stranger chose
      const response = await upload(boardId, bytes, { 'Content-Type': 'application/octet-stream' });
      expect(response.status).toBe(201);
      const stored = (await response.json()) as { assetKey: string; contentType: string };
      expect(stored.contentType).toBe(contentType);
      const object = await env.ASSETS_BUCKET.get(stored.assetKey);
      expect(object?.httpMetadata?.contentType).toBe(contentType);
    });
  }

  it('refuses an SVG and stores nothing', async () => {
    const boardId = await createdBoardId();
    const response = await upload(boardId, svgBytes(), { 'Content-Type': 'image/svg+xml' });
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error: string }).error).toBe('unsupported_image_type');
    expect(await bucketKeys(boardId)).toEqual([]);
  });

  it('refuses a PDF renamed to .png, which is the case the check exists for', async () => {
    const boardId = await createdBoardId();
    const response = await upload(boardId, pdfBytes(), { 'Content-Type': 'image/png' });
    expect(response.status).toBe(415);
    expect(await bucketKeys(boardId)).toEqual([]);
  });

  it('refuses an empty body and three random bytes', async () => {
    const boardId = await createdBoardId();
    expect((await upload(boardId, new Uint8Array(0))).status).toBe(415);
    expect((await upload(boardId, shortBytes())).status).toBe(415);
    expect((await upload(boardId, new Uint8Array(12))).status).toBe(415);
    expect(await bucketKeys(boardId)).toEqual([]);
  });
});

describe('TC-12 the size limit, and a lying Content-Length', () => {
  it('takes a file exactly at the limit', async () => {
    const boardId = await createdBoardId();
    const bytes = fileOf(IMAGE_MAX_BYTES, pngBytes());
    const response = await upload(boardId, bytes);
    expect(response.status).toBe(201);
    expect(await bucketKeys(boardId)).toHaveLength(1);
  });

  it('refuses one byte over it and stores nothing', async () => {
    const boardId = await createdBoardId();
    const bytes = fileOf(IMAGE_MAX_BYTES + 1, pngBytes());
    const response = await upload(boardId, bytes);
    expect(response.status).toBe(413);
    const said = (await response.json()) as { error: string; maxBytes: number };
    expect(said.error).toBe('image_too_large');
    expect(said.maxBytes).toBe(IMAGE_MAX_BYTES);
    expect(await bucketKeys(boardId)).toEqual([]);
  });

  it('refuses a body whose declared length is over, whatever it then sends', async () => {
    const boardId = await createdBoardId();
    const response = await SELF.fetch(UPLOAD(boardId), {
      method: 'POST',
      body: pngBytes(),
      headers: { 'Content-Length': String(IMAGE_MAX_BYTES + 1000) },
    });
    expect(response.status).toBe(413);
    expect(await bucketKeys(boardId)).toEqual([]);
  });

  it('refuses a body that is over the limit while claiming to be ten bytes', async () => {
    const boardId = await createdBoardId();
    // the declared length is a promise; the byte count is the fact, and the fact is what
    // the bucket is billed for
    const response = await SELF.fetch(UPLOAD(boardId), {
      method: 'POST',
      body: fileOf(IMAGE_MAX_BYTES + 1, pngBytes()),
      headers: { 'Content-Length': '10' },
    });
    expect(response.status).toBe(413);
    expect(await bucketKeys(boardId)).toEqual([]);
  });
});

describe('TC-13 an upload to a board that is not there', () => {
  it('answers 404 and stores nothing', async () => {
    const missing = newBoardId();
    const response = await upload(missing, pngBytes());
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('not_found');
    expect(await bucketKeys(missing)).toEqual([]);
    // and the room was only ever asked, never told to be
    expect(await SELF.fetch(`http://localhost/api/boards/${missing}`)).toMatchObject({
      status: 404,
    });
  });

  it('refuses a malformed board id without addressing an object at all', async () => {
    const before = await listDurableObjectIds(env.BOARD_ROOM);
    const response = await upload('bad!id', pngBytes());
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('not_found');
    // no name lookup, no object instance, nothing written: a malformed id is refused the
    // same way the board routes refuse one, before the namespace is touched
    const after = await listDurableObjectIds(env.BOARD_ROOM);
    expect(after.length).toBe(before.length);
  });

  it('an id that is a well-formed board id nobody ever made is the same 404', async () => {
    // a link shared before, a board that was never made, a board that is gone: the upload
    // answers all three the way the existence probe does, and writes nothing for any of them
    const never = newBoardId();
    expect((await upload(never, pngBytes())).status).toBe(404);
    expect(await SELF.fetch(`http://localhost/api/boards/${never}`)).toMatchObject({ status: 404 });
    expect(await bucketKeys(never)).toEqual([]);
  });
});

describe('TC-15 serving bytes back', () => {
  it('answers 200 with the stored type and a year of immutable cache', async () => {
    const boardId = await createdBoardId();
    const { assetKey } = (await (await upload(boardId, jpegBytes())).json()) as {
      assetKey: string;
    };

    const response = await SELF.fetch(ASSET(assetKey));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array((await response.arrayBuffer()) ?? new ArrayBuffer(0)).byteLength).toBe(
      jpegBytes().length,
    );
  });

  it('a HEAD carries the same headers and no body', async () => {
    const boardId = await createdBoardId();
    const { assetKey } = (await (await upload(boardId, gif89aBytes())).json()) as {
      assetKey: string;
    };
    const response = await SELF.fetch(ASSET(assetKey), { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/gif');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    expect(await response.text()).toBe('');
  });

  it('a key that was never written is 404 and never the SPA', async () => {
    const boardId = await createdBoardId();
    const response = await SELF.fetch(ASSET(`${boardId}/${newBoardId()}`));
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.text()).not.toContain('<div id="root">');
  });

  it('refuses an id with something on the end, and a traversal inside a segment', async () => {
    const boardId = await createdBoardId();
    const { assetKey } = (await (await upload(boardId, pngBytes())).json()) as { assetKey: string };
    const assetId = assetKey.split('/')[1]!;
    // every one of these is a path the URL parser hands on unchanged, so the asset route is
    // the one that answers it - and every one of them is refused for the same reason: it is
    // not two ids
    const refused = [
      `${boardId}/.${assetId}`,
      `${boardId}/-${assetId}`,
      `${boardId}/${assetId}.png`,
      `${boardId}/${assetId}!`,
      `${boardId.slice(0, 21)}/${assetId}`,
      `${boardId}/${assetId.slice(0, 21)}`,
      // percent-encoded traversal, which is the form that survives an URL normaliser: the
      // segment decodes to `../../etc`, and a key is two ids or nothing
      `${boardId}/%2e%2e%2f%2e%2e%2fetc`,
      `%2e%2e%2f${boardId}/${assetId}`,
      `${boardId}/..%2f..%2fetc`,
    ];
    for (const key of refused) {
      const response = await SELF.fetch(ASSET(key));
      expect(response.status, key).toBe(404);
      // never the index page: a picture is not a page
      expect(await response.text(), key).not.toContain('<div id="root">');
    }    // the object that does exist is still readable, so nothing above was a bucket problem
    expect((await SELF.fetch(ASSET(assetKey))).status).toBe(200);
  });

  it('a picture address that is not two ids is a missing picture, not the app', async () => {
    const boardId = await createdBoardId();
    const { assetKey } = (await (await upload(boardId, pngBytes())).json()) as { assetKey: string };
    const assetId = assetKey.split('/')[1]!;
    // None of these reach the bucket: the namespace is keyed by two ids and these are not two.
    // And none of them get the index page either, because an <img> that decoded HTML would be
    // a broken image with no reason given - `/api/assets` belongs to pictures, end of story.
    for (const key of [`${boardId}`, `${boardId}/`, `${boardId}/${assetId}/extra`, '']) {
      const response = await SELF.fetch(ASSET(key));
      expect(response.status, key).toBe(404);
      expect(((await response.json()) as { error: string }).error, key).toBe('not_found');
    }
    // a plain `..` is taken out by the URL parser before anyone could act on it, which is why
    // the traversal worth testing is the percent-encoded one above
    expect(new URL(ASSET(`${boardId}/..`)).pathname).toBe('/api/assets/');
    expect(
      await SELF.fetch('http://localhost/some/route/of/the/app').then((response) => response.status),
    ).toBe(200);
  });

  it('a wrong method says which one the address answers', async () => {
    const boardId = await createdBoardId();
    const { assetKey } = (await (await upload(boardId, pngBytes())).json()) as { assetKey: string };

    const read = await SELF.fetch(ASSET(assetKey), { method: 'POST', body: 'x' });
    expect(read.status).toBe(405);
    expect(read.headers.get('Allow')).toBe('GET, HEAD');

    const write = await SELF.fetch(UPLOAD(boardId), { method: 'PUT', body: pngBytes() });
    expect(write.status).toBe(405);
    expect(write.headers.get('Allow')).toBe('POST');
    expect(await bucketKeys(boardId)).toHaveLength(1);
  });

  it('the asset route does not disturb the board routes', async () => {
    const boardId = await createdBoardId();
    expect(await SELF.fetch(`http://localhost/api/boards/${boardId}`)).toMatchObject({ status: 200 });
    const response = await SELF.fetch(`http://localhost/b/${boardId}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });
});

describe('TC-16 two boards keep their pictures apart', () => {
  it('each board reads its own, and another board\'s prefix reads nothing', async () => {
    const boardA = await createdBoardId();
    const boardB = await createdBoardId();

    const keyA = (await (await upload(boardA, pngBytes())).json()) as { assetKey: string };
    const keyB = (await (await upload(boardB, jpegBytes())).json()) as { assetKey: string };

    expect((await SELF.fetch(ASSET(keyA.assetKey))).status).toBe(200);
    expect((await SELF.fetch(ASSET(keyB.assetKey))).status).toBe(200);

    // the same asset id under the other board's prefix is an object that was never written
    const crossKey = `${boardB}/${keyA.assetKey.split('/')[1]}`;
    expect(crossKey).not.toBe(keyA.assetKey);
    expect((await SELF.fetch(ASSET(crossKey))).status).toBe(404);

    // and one board's listing holds only that board's pictures
    const listedA = await env.ASSETS_BUCKET.list({ prefix: `${boardA}/` });
    const listedB = await env.ASSETS_BUCKET.list({ prefix: `${boardB}/` });
    expect(listedA.objects.map((object) => object.key)).toEqual([keyA.assetKey]);
    expect(listedB.objects.map((object) => object.key)).toEqual([keyB.assetKey]);
  });
});

function isValid(key: string, boardId: string): boolean {
  const parts = key.split('/');
  return parts.length === 2 && parts[0] === boardId && /^[A-Za-z0-9_-]{22}$/.test(parts[1] ?? '');
}

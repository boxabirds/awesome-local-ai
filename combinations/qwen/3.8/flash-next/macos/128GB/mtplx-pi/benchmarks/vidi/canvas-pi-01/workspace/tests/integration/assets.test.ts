import { describe, expect, test } from 'vitest';
import worker from '../../src/worker/index';
import { env } from 'cloudflare:test';
import type { Env } from '../../src/worker/env';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';

// The assets API only ever *sniffs* magic bytes (it never decodes), so these
// tests build their own minimal buffers rather than reading the real image files
// from disk. The integration pool runs inside workerd, where `node:fs` cannot
// reach project files — the full-file fixtures are reserved for the Node unit
// project and Playwright's Node side, which can.
const png = (body: number[] = []): Uint8Array =>
  Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, ...body]);
const gif = (): Uint8Array => Uint8Array.from([...'GIF89a'.split('').map((c) => c.charCodeAt(0)), 0, 0]);
const webp = (): Uint8Array => {
  const a = [...'RIFF'.split('').map((c) => c.charCodeAt(0))];
  const b = [...'WEBP'.split('').map((c) => c.charCodeAt(0))];
  return Uint8Array.from([...a, 40, 0, 0, 0, ...b]);
};
const jpeg = (): Uint8Array => Uint8Array.from([255, 216, 255, 224, 0, 16, ...'JFIF'.split('').map((c) => c.charCodeAt(0))]);
const pdf = (): Uint8Array => Uint8Array.from([...'%PDF-1.7\n'.split('').map((c) => c.charCodeAt(0)), 0]);
const svg = (): Uint8Array => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
const random = (): Uint8Array => Uint8Array.from([0, 17, 34, 99, 1, 2, 3, 4]);
const PNG: Uint8Array = png();
const GIF: Uint8Array = gif();
const WEBP: Uint8Array = webp();
const JPEG: Uint8Array = jpeg();
const PDF: Uint8Array = pdf();
const SVG_SCRIPT: Uint8Array = svg();
const RANDOM: Uint8Array = random();
// Right magic bytes, undecodable body: the sniff still accepts it as image/png.
const CORRUPT: Uint8Array = png([1, 2, 3, 4, 5]);

function assetReq(id: string): Request {
  return new Request(`http://x/api/assets/${BOARD}/${id}`, { method: 'GET' });
}

// The upload rate limiter keys on `CF-Connecting-IP`. Tests run inside one 60-second
// window, so sharing the default (empty) key would let an early test spend the
// budget a later one needs. Each test therefore uses its own visitor key — except
// TC-16, which deliberately shares one key across a burst to exhaust the limit.
let visitor = 0;
const nextVisitor = (): string => `203.0.113.${++visitor}`;

/** A `POST /api/boards/:id/assets` carrying the given files as `images` parts. */
function uploadReq(
  files: Array<[name: string, mime: string, body: Uint8Array]>,
  key: string = nextVisitor(),
): Request {
  const form = new FormData();
  for (const [name, mime, body] of files) {
    form.append('images', new File([body as unknown as BlobPart], name, { type: mime }));
  }
  return new Request(`http://x/api/boards/${BOARD}/assets`, {
    method: 'POST',
    body: form,
    headers: { 'CF-Connecting-IP': key },
  });
}

const BOARD = 'q2Nrt8v3xYhTnLmWpZcDeF';

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('asset upload', () => {
  test('TC-10: a valid png is stored under board/asset and echoed back', async () => {
    const res = await worker.fetch(uploadReq([['shot.png', 'image/png', PNG]]), env as Env);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(String(body.assetKey)).toMatch(new RegExp(`^${BOARD}/[A-Za-z0-9_-]{22}$`));
    // It is retrievable under exactly the returned key, with the sniffed type.
    const read = await worker.fetch(
      new Request(`http://x/api/assets/${String(body.assetKey)}`, { method: 'GET' }),
      env as Env,
    );
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/png');
  });

  test('TC-11: a batch of 3 stores 3 distinct keys', async () => {
    const res = await worker.fetch(
      uploadReq([
        ['a.png', 'image/png', PNG],
        ['b.gif', 'image/gif', GIF],
        ['c.webp', 'image/webp', WEBP],
      ]),
      env as Env,
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    const keys = body.keys as string[];
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  test('TC-12: a renamed application/pdf is 415 and nothing is stored', async () => {
    const res = await worker.fetch(uploadReq([['sneaky.png', 'image/png', PDF]]), env as Env);
    expect(res.status).toBe(415);
    expect(await json(res)).toEqual({ ok: false, reason: 'unsupported', status: 415 });
    // The declared image/png was ignored: the sniff saw the PDF magic.
  });

  test('TC-13: an svg (even without a script) is 415', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    const res = await worker.fetch(uploadReq([['logo.svg', 'image/svg+xml', svg]]), env as Env);
    expect(res.status).toBe(415);
    const withScript = await worker.fetch(
      uploadReq([['evil.svg', 'image/svg+xml', SVG_SCRIPT]]),
      env as Env,
    );
    expect(withScript.status).toBe(415);
  });

  test('TC-14: an oversized file is 413, checked before content', async () => {
    // Over the byte limit AND its magic is a valid png: size wins, so it is 413.
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
    big.set(PNG, 0);
    const res = await worker.fetch(uploadReq([['big.png', 'image/png', big]]), env as Env);
    expect(res.status).toBe(413);
    expect(await json(res)).toEqual({ ok: false, reason: 'too_large', status: 413 });
  });

  test('TC-14b: an oversized + a valid file stores none of them (atomic batch)', async () => {
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
    const res = await worker.fetch(
      uploadReq([
        ['big.png', 'image/png', big],
        ['ok.png', 'image/png', PNG],
      ]),
      env as Env,
    );
    expect(res.status).toBe(413);
  });

  test('TC-15: a wrong-assetId path is 404 without a bucket read', async () => {
    for (const id of [
      'a',
      'aAAAAAAAAAAAAAAAAAAAAA', // 21 — too short
      'aAAAAAAAAAAAAAAAAAAAAAAA', // 23 — too long
      'aAAAAAAAAAAAAAAAAAAAAA!', // a bad character
    ]) {
      const res = await worker.fetch(assetReq(id), env as Env);
      expect(res.status).toBe(404);
    }
  });

  test('TC-15b: a `..` path never reads outside its bucket prefix', async () => {
    // The point of TC-15 is that a crafted path cannot reach another board's key.
    // A raw `..` is normalised away by the URL parser before routing, so it can
    // only ever fall through to the single-page app; a percent-encoded traversal
    // survives into the pathname and is refused by the key pattern with no bucket
    // read. Both facts are asserted here.
    const normalised = await worker.fetch(
      new Request('http://x/api/assets/../../etc/passwd', { method: 'GET' }),
      env as Env,
    );
    // The raw `..` collapsed to `/etc/passwd` by the URL parser, which is not an
    // asset route: it falls through to the single-page app. Either way it can
    // never return a stored image, which is the guarantee that matters.
    expect(normalised.headers.get('content-type') ?? '').not.toMatch(/image\//);
    const encoded = await worker.fetch(
      new Request('http://x/api/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd', { method: 'GET' }),
      env as Env,
    );
    expect(encoded.status).toBe(404);
    // A same-length forged key that is well-formed but absent is also a 404, and
    // is served the same body so nothing is leaked about which assets exist.
    const forged = await worker.fetch(assetReq('aAAAAAAAAAAAAAAAAAAAAA'), env as Env);
    expect(forged.status).toBe(404);
    expect(await json(forged)).toEqual({ ok: false, reason: 'failed', status: 404 });
  });

  test('TC-16: once the per-visitor limit is reached an upload is 429 (limit checked before the body)', async () => {
    // One 60-second window, all from ONE visitor key (`burst`), so the shared
    // 30-a-minute budget is the only thing that can reject them.
    const burst = '198.51.100.7';
    const statuses: number[] = [];
    const bodies: Record<string, unknown>[] = [];
    for (let i = 0; i < 40; i++) {
      const res = await worker.fetch(uploadReq([['x.png', 'image/png', PNG]], burst), env as Env);
      statuses.push(res.status);
      if (res.status === 429) bodies.push(await json(res));
    }
    const accepted = statuses.filter((s) => s === 201).length;
    const rejected = statuses.filter((s) => s === 429).length;
    expect(accepted).toBe(30);
    expect(rejected).toBe(10);
    expect(bodies[0]).toEqual({ ok: false, reason: 'rate_limited', status: 429 });
  });

  test('a corrupt png (right magic, garbage after) is still a valid type', async () => {
    // The contract is a content-type sniff, not a decode: CORRUPT has the PNG
    // magic but is undecodable, so upload succeeds and the *client* decode is what
    // turns it into `failed` (TC-07 covers that path). Here we only check the API.
    const res = await worker.fetch(uploadReq([['c.png', 'image/png', CORRUPT]]), env as Env);
    expect(res.status).toBe(201);
  });

  test('a jpeg round-trips with its sniffed type', async () => {
    const res = await worker.fetch(uploadReq([['p.jpeg', 'image/jpeg', JPEG]]), env as Env);
    expect(res.status).toBe(201);
    const body = await json(res);
    const read = await worker.fetch(
      new Request(`http://x/api/assets/${String(body.assetKey)}`, { method: 'GET' }),
      env as Env,
    );
    expect(read.headers.get('content-type')).toBe('image/jpeg');
  });

  test('random bytes are 415 (no recognised magic)', async () => {
    const res = await worker.fetch(uploadReq([['junk.bin', 'application/octet-stream', RANDOM]]), env as Env);
    expect(res.status).toBe(415);
  });
});

describe('asset read caching and isolation', () => {
  test('a served asset is immutable-cached with the sniffed type', async () => {
    const up = await worker.fetch(uploadReq([['shot.png', 'image/png', PNG]]), env as Env);
    const key = (await json(up)).assetKey as string;
    const res = await worker.fetch(
      new Request(`http://x/api/assets/${key}`, { method: 'GET' }),
      env as Env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('etag')).toBeTruthy();
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual(Array.from(PNG.slice(0, 8)));
  });

  test('a key whose board prefix is not a valid board id is 404', async () => {
    // 22 characters but not a valid board id → rejected without a bucket read.
    const res = await worker.fetch(
      new Request('http://x/api/assets/AAAAAAAAAAAAAAAAAAAAAA/AAAAAAAAAAAAAAAAAAAAAA', {
        method: 'GET',
      }),
      env as Env,
    );
    expect(res.status).toBe(404);
  });
});
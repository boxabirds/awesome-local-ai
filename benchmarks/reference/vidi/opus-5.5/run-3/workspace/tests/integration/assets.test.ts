// assets.api against the real Worker, real R2 (Miniflare) and the real story 5 BoardRoom `exists()` RPC.
//
// Rate limiting (TC-14) uses the real `ratelimits` binding ASSET_UPLOAD_LIMITER from wrangler.jsonc: the pinned
// local runtime (miniflare) simulates it with fixed windows aligned to the wall clock, so the test starts well
// inside a window. TC-15 wraps the real bucket so that `put` throws.
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handleRequest, type Env } from '../../src/worker/index';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_UPLOAD_LIMIT, IMAGE_UPLOAD_PERIOD_SECONDS } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { PDF_BYTES, SMALL_PNG, SVG_WITH_SCRIPT, jpegOfSize } from '../fixtures/images';
import { sleep } from './ws-client';

const BASE = 'http://vidi6.test';

/** A distinct visitor per call, so tests never share a rate-limit bucket. */
function visitor(): string {
  return `198.51.100.${Math.floor(Math.random() * 250) + 1}-${crypto.randomUUID()}`;
}

async function createBoard(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': visitor() } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function upload(boardId: string, body: Uint8Array, opts: { ip?: string; type?: string } = {}): Promise<Response> {
  return SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': opts.ip ?? visitor(), 'Content-Type': opts.type ?? 'application/octet-stream' },
    body,
  });
}

async function storedKeys(boardId: string): Promise<string[]> {
  const listed = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
  return listed.objects.map((o) => o.key);
}

describe('assets.api: upload', () => {
  it('TC-10 a real PNG to an existing board: 201, stored with contentType image/png under an unguessable key', async () => {
    const boardId = await createBoard();
    const res = await upload(boardId, SMALL_PNG, { type: 'image/png' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    const obj = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(obj).not.toBeNull();
    expect(obj!.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(SMALL_PNG);
  });

  it('TC-11 a never-created board and a malformed id: 404, nothing stored', async () => {
    const unknown = newBoardId();
    const res = await upload(unknown, SMALL_PNG);
    expect(res.status).toBe(404);
    expect(await storedKeys(unknown)).toEqual([]);
    expect((await upload('not-a-board', SMALL_PNG)).status).toBe(404);
    expect((await upload('..%2F..%2Fx', SMALL_PNG)).status).toBe(404);
    const everything = await env.ASSETS_BUCKET.list();
    expect(everything.objects.some((o) => !ASSET_KEY_PATTERN.test(o.key))).toBe(false);
  });

  it('TC-12 IMAGE_MAX_BYTES + 1 bytes: 413, nothing stored; a valid JPEG of exactly IMAGE_MAX_BYTES: 201', async () => {
    const boardId = await createBoard();
    const over = await upload(boardId, jpegOfSize(IMAGE_MAX_BYTES + 1), { type: 'image/jpeg' });
    expect(over.status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);
    const at = await upload(boardId, jpegOfSize(IMAGE_MAX_BYTES), { type: 'image/jpeg' });
    expect(at.status).toBe(201);
    const { assetKey, contentType } = (await at.json()) as { assetKey: string; contentType: string };
    expect(contentType).toBe('image/jpeg');
    expect((await env.ASSETS_BUCKET.head(assetKey))?.size).toBe(IMAGE_MAX_BYTES);
  });

  it('TC-13 a PDF sent as image/png and an SVG with a script: 415 both, nothing stored', async () => {
    const boardId = await createBoard();
    const pdf = await upload(boardId, PDF_BYTES, { type: 'image/png' });
    expect(pdf.status).toBe(415);
    const svg = await upload(boardId, SVG_WITH_SCRIPT, { type: 'image/svg+xml' });
    expect(svg.status).toBe(415);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it(
    'TC-14 IMAGE_UPLOAD_LIMIT uploads per visitor per period; the next is 429; another visitor is unaffected',
    async () => {
      // Fixed windows: start with at least 20 s of the current one left.
      const period = IMAGE_UPLOAD_PERIOD_SECONDS * 1000;
      const into = Date.now() % period;
      if (period - into < 20_000) await sleep(period - into + 250);

      const boardId = await createBoard();
      const ip = visitor();
      for (let i = 0; i < IMAGE_UPLOAD_LIMIT; i++) expect((await upload(boardId, SMALL_PNG, { ip })).status, `upload ${i + 1}`).toBe(201);
      const limited = await upload(boardId, SMALL_PNG, { ip });
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ error: 'rate_limited' });
      expect(await storedKeys(boardId)).toHaveLength(IMAGE_UPLOAD_LIMIT);
      expect((await upload(boardId, SMALL_PNG)).status).toBe(201);
    },
    60_000,
  );

  it('TC-15 a storage failure is 500', async () => {
    const boardId = await createBoard();
    const failing = {
      ...env,
      ASSETS_BUCKET: {
        put: () => Promise.reject(new Error('R2 unavailable')),
        get: env.ASSETS_BUCKET.get.bind(env.ASSETS_BUCKET),
      },
    } as unknown as Env;
    const req = new Request(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': visitor() },
      body: SMALL_PNG,
    });
    const res = await handleRequest(req, failing);
    expect(res.status).toBe(500);
    expect(await storedKeys(boardId)).toEqual([]);
  });
});

describe('assets.api: serve', () => {
  it('TC-16 a stored image is served immutable, nosniff and with a no-content CSP; missing and malformed keys are 404', async () => {
    const boardId = await createBoard();
    const { assetKey } = (await (await upload(boardId, SMALL_PNG)).json()) as { assetKey: string };
    const res = await SELF.fetch(`${BASE}/api/assets/${assetKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(SMALL_PNG);

    const missing = await SELF.fetch(`${BASE}/api/assets/${boardId}/${newBoardId()}`);
    expect(missing.status).toBe(404);
    await missing.arrayBuffer();
    for (const path of ['..%2Fx', `${boardId}/..%2Fx`, `${boardId}%2F..%2F..%2F${newBoardId()}`, boardId]) {
      const bad = await SELF.fetch(`${BASE}/api/assets/${path}`);
      expect(bad.status, path).toBe(404);
      await bad.arrayBuffer();
    }
  });
});

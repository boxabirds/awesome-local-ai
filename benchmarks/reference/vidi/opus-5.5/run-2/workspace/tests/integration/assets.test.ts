/**
 * Story 12 assets.api integration tests (TC-10 to TC-16): the real Worker, real Miniflare R2
 * (ASSETS_BUCKET) and the real story 5 BoardRoom `exists()` RPC.
 *
 * Rate limiter: the pinned local runtime implements the `ratelimits` binding, so TC-14 uses
 * the real ASSET_UPLOAD_LIMITER from wrangler.jsonc. Every other test uses its own random
 * CF-Connecting-IP so limiter counts never leak between tests.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handleServe, handleUpload } from '../../src/worker/assets';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_UPLOAD_LIMIT } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { bytesOfSize, jpegOfSize, PDF_RENAMED, PNG_400x300, SVG_WITH_SCRIPT, WEBP_640x480 } from '../fixtures/image-bytes';

const ORIGIN = 'http://vidi6.test';

function randomIp(): string {
  const [a, b, c] = crypto.getRandomValues(new Uint8Array(3));
  return `10.${a}.${b}.${c}`;
}

async function createBoard(): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': randomIp() } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function upload(boardId: string, body: Uint8Array, opts: { ip?: string; contentType?: string } = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/boards/${boardId}/assets`, {
    method: 'POST',
    body,
    headers: { 'CF-Connecting-IP': opts.ip ?? randomIp(), 'Content-Type': opts.contentType ?? 'application/octet-stream' },
  });
}

async function stored(boardId: string): Promise<string[]> {
  const listed = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
  return listed.objects.map((o) => o.key);
}

describe('POST /api/boards/:id/assets and GET /api/assets/:key (assets.api)', () => {
  it('TC-10 a real PNG to an existing board: 201, stored as image/png under a key matching ASSET_KEY_PATTERN', async () => {
    const boardId = await createBoard();
    const res = await upload(boardId, PNG_400x300, { contentType: 'text/plain' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    const object = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(object).not.toBeNull();
    expect(object!.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(PNG_400x300);

    // Two uploads of the same bytes get different keys.
    const again = (await (await upload(boardId, PNG_400x300)).json()) as { assetKey: string };
    expect(again.assetKey).not.toBe(body.assetKey);
    const webp = (await (await upload(boardId, WEBP_640x480)).json()) as { contentType: string };
    expect(webp.contentType).toBe('image/webp');
  });

  it('TC-11 a never-created board and a malformed id: 404, nothing stored (negative)', async () => {
    const unknown = newBoardId();
    const res = await upload(unknown, PNG_400x300);
    expect(res.status).toBe(404);
    expect(await stored(unknown)).toEqual([]);
    for (const bad of ['abc', 'AbCdEfGhIjKlMnOpQr_-091', 'a.b']) {
      expect((await upload(bad, PNG_400x300)).status).toBe(404);
    }
    const before = (await env.ASSETS_BUCKET.list()).objects.length;
    expect((await upload('abc', PNG_400x300)).status).toBe(404);
    expect((await env.ASSETS_BUCKET.list()).objects.length).toBe(before);
    // Only POST uploads.
    expect((await SELF.fetch(`${ORIGIN}/api/boards/${unknown}/assets`)).status).toBe(405);
  });

  it('TC-12 IMAGE_MAX_BYTES + 1 bytes: 413, nothing stored; a valid JPEG of exactly IMAGE_MAX_BYTES: 201 (boundary)', async () => {
    const boardId = await createBoard();
    const over = await upload(boardId, bytesOfSize(IMAGE_MAX_BYTES + 1));
    expect(over.status).toBe(413);
    expect(await stored(boardId)).toEqual([]);
    const atLimit = await upload(boardId, jpegOfSize(IMAGE_MAX_BYTES));
    expect(atLimit.status).toBe(201);
    const { assetKey } = (await atLimit.json()) as { assetKey: string };
    expect((await env.ASSETS_BUCKET.head(assetKey))?.size).toBe(IMAGE_MAX_BYTES);
  });

  it('TC-12 a body larger than its Content-Length claims is still refused by its actual length', async () => {
    const boardId = await createBoard();
    const req = new Request(`${ORIGIN}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: bytesOfSize(IMAGE_MAX_BYTES + 1),
      headers: { 'CF-Connecting-IP': randomIp() },
    });
    // Called directly so no Content-Length check can happen first.
    const headers = new Headers(req.headers);
    headers.delete('Content-Length');
    const res = await handleUpload(new Request(req, { headers }), env, boardId);
    expect(res.status).toBe(413);
    expect(await stored(boardId)).toEqual([]);
  });

  it('TC-13 a PDF sent as image/png and an SVG with a script: 415 both, nothing stored (negative, security)', async () => {
    const boardId = await createBoard();
    expect((await upload(boardId, PDF_RENAMED, { contentType: 'image/png' })).status).toBe(415);
    expect((await upload(boardId, SVG_WITH_SCRIPT, { contentType: 'image/svg+xml' })).status).toBe(415);
    expect((await upload(boardId, new Uint8Array())).status).toBe(415);
    expect(await stored(boardId)).toEqual([]);
  });

  it('TC-14 IMAGE_UPLOAD_LIMIT + 1 uploads from one address: the last is 429; another address still 201', async () => {
    const boardId = await createBoard();
    const ip = randomIp();
    for (let i = 0; i < IMAGE_UPLOAD_LIMIT; i += 1) {
      expect((await upload(boardId, PNG_400x300, { ip })).status).toBe(201);
    }
    const limited = await upload(boardId, PNG_400x300, { ip });
    expect(limited.status).toBe(429);
    expect(await stored(boardId)).toHaveLength(IMAGE_UPLOAD_LIMIT);
    expect((await upload(boardId, PNG_400x300, { ip: randomIp() })).status).toBe(201);
  });

  it('TC-15 R2 put throws: 500 (error path)', async () => {
    const boardId = await createBoard();
    const failing = {
      put: () => Promise.reject(new Error('r2 unavailable')),
    } as unknown as R2Bucket;
    const req = new Request(`${ORIGIN}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_400x300,
      headers: { 'CF-Connecting-IP': randomIp() },
    });
    const res = await handleUpload(req, { ...env, ASSETS_BUCKET: failing }, boardId);
    expect(res.status).toBe(500);
    expect(await stored(boardId)).toEqual([]);
  });

  it('TC-16 GET a stored key: 200 with its type, immutable caching, nosniff and CSP; missing and ../ keys 404', async () => {
    const boardId = await createBoard();
    const { assetKey } = (await (await upload(boardId, PNG_400x300)).json()) as { assetKey: string };
    const res = await SELF.fetch(`${ORIGIN}/api/assets/${assetKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_400x300);

    const missing = await SELF.fetch(`${ORIGIN}/api/assets/${boardId}/${newBoardId()}`);
    expect(missing.status).toBe(404);
    await missing.arrayBuffer();
    for (const bad of [`${boardId}/..%2Fx`, `..%2F${assetKey}`, boardId, `${boardId}/${newBoardId()}/x`]) {
      const r = await SELF.fetch(`${ORIGIN}/api/assets/${bad}`);
      expect(r.status, bad).toBe(404);
      await r.arrayBuffer();
    }
    // A literal `../x` is resolved by URL parsing before it reaches the Worker, so the
    // handler is also called with it directly.
    expect((await handleServe(env, '../x')).status).toBe(404);
    expect((await handleServe(env, `../${assetKey}`)).status).toBe(404);
  });
});

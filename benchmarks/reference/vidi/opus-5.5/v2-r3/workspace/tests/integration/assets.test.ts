// Story 12 — asset upload and serving (assets.api) through the real Worker,
// real Miniflare R2 and the real BoardRoom exists() RPC (TC-10 → TC-13, TC-15, TC-16).
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { handleUpload } from '../../src/worker/assets';
import { PDF_BYTES, SCRIPT_SVG, SMALL_PNG, jpegOfSize } from '../fixtures/image-bytes';
import { createBoardId } from './ws-client';

const BASE = 'http://vidi6.test';

function upload(boardId: string, body: Uint8Array, contentType = 'application/octet-stream'): Promise<Response> {
  return SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
}

async function storedKeys(boardId: string): Promise<string[]> {
  const list = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
  return list.objects.map((o) => o.key);
}

describe('POST /api/boards/:id/assets', () => {
  it('TC-10: a real PNG to an existing board → 201; stored as image/png under a well-formed key', async () => {
    const boardId = await createBoardId();
    const res = await upload(boardId, SMALL_PNG, 'text/plain'); // the declared type is ignored
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    const obj = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(obj).not.toBeNull();
    expect(obj!.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(SMALL_PNG);
    // Two uploads of the same bytes get different keys.
    const again = (await (await upload(boardId, SMALL_PNG)).json()) as { assetKey: string };
    expect(again.assetKey).not.toBe(body.assetKey);
  });

  it('TC-11: never-created board and malformed id → 404; nothing stored', async () => {
    const unknown = newBoardId();
    const res = await upload(unknown, SMALL_PNG, 'image/png');
    expect(res.status).toBe(404);
    expect(await storedKeys(unknown)).toEqual([]);
    const malformed = await upload('not-a-board', SMALL_PNG, 'image/png');
    expect(malformed.status).toBe(404);
    expect((await env.ASSETS_BUCKET.list({ prefix: 'not-a-board' })).objects).toEqual([]);
  });

  it('TC-12: IMAGE_MAX_BYTES + 1 → 413 nothing stored; exactly IMAGE_MAX_BYTES → 201', async () => {
    const boardId = await createBoardId();
    const over = await upload(boardId, jpegOfSize(IMAGE_MAX_BYTES + 1), 'image/jpeg');
    expect(over.status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);
    const at = await upload(boardId, jpegOfSize(IMAGE_MAX_BYTES), 'image/jpeg');
    expect(at.status).toBe(201);
    const { assetKey, contentType } = (await at.json()) as { assetKey: string; contentType: string };
    expect(contentType).toBe('image/jpeg');
    expect((await env.ASSETS_BUCKET.head(assetKey))?.size).toBe(IMAGE_MAX_BYTES);
  });

  it('TC-12: a body larger than its declared Content-Length allows is still refused', async () => {
    const boardId = await createBoardId();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(jpegOfSize(IMAGE_MAX_BYTES));
        c.enqueue(new Uint8Array(1));
        c.close();
      },
    });
    const res = await handleUpload(
      new Request(`${BASE}/api/boards/${boardId}/assets`, { method: 'POST', body, duplex: 'half' } as RequestInit),
      env,
      boardId,
    );
    expect(res.status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('TC-13: renamed PDF declared image/png and an SVG with script → 415 both; nothing stored', async () => {
    const boardId = await createBoardId();
    expect((await upload(boardId, PDF_BYTES, 'image/png')).status).toBe(415);
    expect((await upload(boardId, SCRIPT_SVG, 'image/svg+xml')).status).toBe(415);
    expect((await upload(boardId, new Uint8Array(0), 'image/png')).status).toBe(415);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('TC-15: storage failure → 500', async () => {
    const boardId = await createBoardId();
    const failing = new Proxy(env.ASSETS_BUCKET, {
      get(target, prop) {
        if (prop === 'put') return () => Promise.reject(new Error('injected R2 failure'));
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const req = new Request(`${BASE}/api/boards/${boardId}/assets`, { method: 'POST', body: SMALL_PNG });
    const res = await handleUpload(req, { ...env, ASSETS_BUCKET: failing }, boardId);
    expect(res.status).toBe(500);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('other methods → 405', async () => {
    const boardId = await createBoardId();
    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });
});

describe('GET /api/assets/:boardId/:assetId', () => {
  it('TC-16: stored key → 200 with type, immutable caching, nosniff and CSP; missing → 404; ../x → 404', async () => {
    const boardId = await createBoardId();
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

    for (const path of ['..%2Fx', `${boardId}/..%2Fx`, `${boardId}%2F..%2F..%2Fx`, `${boardId}`, '']) {
      const bad = await SELF.fetch(`${BASE}/api/assets/${path}`);
      expect(bad.status, path).toBe(404);
      expect(bad.headers.get('Content-Type')).not.toContain('text/html');
      await bad.arrayBuffer();
    }
  });
});

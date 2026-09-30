// assets.api (TC-10 to TC-13, TC-15, TC-16): the real Worker with real R2 (Miniflare) and the
// real BoardRoom exists() RPC.
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import worker from '../../src/worker/index';
import pdfUrl from '../fixtures/images/document-renamed.png?inline';
import jpegUrl from '../fixtures/images/photo.jpg?inline';
import pngUrl from '../fixtures/images/screenshot.png?inline';
import svgUrl from '../fixtures/images/script.svg?inline';
import { createBoardId } from './ws-client';

const BASE = 'http://example.com';

/** Bytes of an inlined fixture (`data:<type>;base64,...` or URL-encoded text). */
function bytesOf(dataUrl: string): Uint8Array {
  const [head, body] = dataUrl.split(',', 2);
  if (head.endsWith(';base64')) return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new TextEncoder().encode(decodeURIComponent(body));
}

const PNG = bytesOf(pngUrl);
const JPEG = bytesOf(jpegUrl);

function upload(boardId: string, body: Uint8Array, contentType = 'image/png') {
  return SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
}

async function storedKeys(prefix: string): Promise<string[]> {
  const list = await env.ASSETS_BUCKET.list({ prefix });
  return list.objects.map((o) => o.key);
}

describe('assets.api upload', () => {
  it('TC-10 a real PNG to an existing board: 201, stored as image/png under a valid key', async () => {
    const boardId = await createBoardId();
    const res = await upload(boardId, PNG, 'application/octet-stream');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    const stored = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(stored).not.toBeNull();
    expect(stored!.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(PNG);
  });

  it('TC-11 a never-created board and a malformed id: 404, nothing stored', async () => {
    const unknown = newBoardId();
    expect((await upload(unknown, PNG)).status).toBe(404);
    expect(await storedKeys(unknown)).toEqual([]);
    const malformed = await upload('not-a-board', PNG);
    expect(malformed.status).toBe(404);
    expect(await storedKeys('not-a-board')).toEqual([]);
  });

  it('TC-12 IMAGE_MAX_BYTES + 1 is 413 with nothing stored; exactly IMAGE_MAX_BYTES is 201', async () => {
    const boardId = await createBoardId();
    const over = new Uint8Array(IMAGE_MAX_BYTES + 1);
    over.set(JPEG);
    expect((await upload(boardId, over, 'image/jpeg')).status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);

    // A valid JPEG padded after its end marker to exactly the limit.
    const atLimit = new Uint8Array(IMAGE_MAX_BYTES);
    atLimit.set(JPEG);
    const res = await upload(boardId, atLimit, 'image/jpeg');
    expect(res.status).toBe(201);
    expect(((await res.json()) as { contentType: string }).contentType).toBe('image/jpeg');
    expect(await storedKeys(boardId)).toHaveLength(1);
  });

  it('TC-12 a declared Content-Length over the limit is refused before reading the body', async () => {
    const boardId = await createBoardId();
    const res = await worker.fetch(
      new Request(`${BASE}/api/boards/${boardId}/assets`, {
        method: 'POST',
        headers: { 'Content-Length': String(IMAGE_MAX_BYTES + 1) },
        body: PNG,
      }),
      env,
    );
    expect(res.status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('TC-13 a renamed PDF sent as image/png and an SVG with a script: 415, nothing stored', async () => {
    const boardId = await createBoardId();
    expect((await upload(boardId, bytesOf(pdfUrl), 'image/png')).status).toBe(415);
    expect((await upload(boardId, bytesOf(svgUrl), 'image/svg+xml')).status).toBe(415);
    expect((await upload(boardId, bytesOf(svgUrl), 'image/png')).status).toBe(415);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('TC-15 a storage failure is 500', async () => {
    const boardId = await createBoardId();
    const failing = new Proxy(env.ASSETS_BUCKET, {
      get(target, prop, receiver) {
        if (prop === 'put') return () => Promise.reject(new Error('R2 unavailable'));
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const res = await worker.fetch(
      new Request(`${BASE}/api/boards/${boardId}/assets`, { method: 'POST', body: PNG }),
      { ...env, ASSETS_BUCKET: failing },
    );
    expect(res.status).toBe(500);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('only POST uploads', async () => {
    const boardId = await createBoardId();
    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`);
    expect(res.status).toBe(405);
  });
});

describe('assets.api serve', () => {
  it('TC-16 stored key: 200 with type, immutable caching, nosniff and CSP; missing and ../ are 404', async () => {
    const boardId = await createBoardId();
    const { assetKey } = (await (await upload(boardId, PNG)).json()) as { assetKey: string };
    const res = await SELF.fetch(`${BASE}/api/assets/${assetKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);

    const missing = await SELF.fetch(`${BASE}/api/assets/${boardId}/${newBoardId()}`);
    expect(missing.status).toBe(404);
    await missing.arrayBuffer();
    for (const bad of ['..%2Fx', `${boardId}%2F..%2Fx`, `${boardId}/../x`, '../x', boardId]) {
      const r = await SELF.fetch(`${BASE}/api/assets/${bad}`);
      expect(r.status, bad).toBe(404);
      await r.arrayBuffer();
    }
  });
});
